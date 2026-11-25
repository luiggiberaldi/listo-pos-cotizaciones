#!/usr/bin/env node
// construacero-staging/scripts/verify-op036-calendario-sabados-staging.mjs
// OP-2026-036 — Arnés de verificación de punta a punta (API + Navegador real) en STAGING.
// Guardia estricta: aborta si el proyecto de Supabase no es staging (spupqgkdsgohxxfoxydl).
// Al terminar restaura las designaciones previas y elimina los usuarios temporales creados.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'
const ORIGIN = 'http://localhost:5174'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseEnv(text = '') {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim()
    if (!s || s.startsWith('#')) continue
    const idx = s.indexOf('=')
    if (idx < 0) continue
    let v = s.slice(idx + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[s.slice(0, idx).trim()] = v
  }
  return out
}
const readEnv = async f => { try { return parseEnv(await readFile(path.join(root, f), 'utf8')) } catch { return {} } }

const cfg = { ...(await readEnv('.env')), ...(await readEnv('.dev.vars')), ...(await readEnv('.env.e2e.local')) }
const supabaseUrl = cfg.STAGING_E2E_SUPABASE_URL || cfg.VITE_SUPABASE_URL
const anonKey = cfg.STAGING_E2E_ANON_KEY || cfg.VITE_SUPABASE_ANON_KEY
const serviceKey = cfg.SUPABASE_SERVICE_KEY
const superCode = cfg.STAGING_E2E_SUPER_CODE || cfg.DEV_SUPER_CODE
const ref = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : ''
if (ref !== STAGING_PROJECT_REF) {
  throw new Error(`Guardia: la base no es staging (${ref || 'desconocida'}). Abortado.`)
}
if (!anonKey || !serviceKey || !superCode) {
  throw new Error('Faltan variables locales de staging')
}

const STAGING_EMAIL = 'supervisor@listo.sys'
const srv = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const { data: linkData, error: linkErr } = await srv.auth.admin.generateLink({
  type: 'magiclink',
  email: STAGING_EMAIL,
})
if (linkErr) throw new Error(`generateLink staging: ${linkErr.message}`)
const tokenHash = linkData?.properties?.hashed_token
if (!tokenHash) throw new Error('No se obtuvo hashed_token para sesión staging')

const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
const { data: authData, error: loginError } = await supabase.auth.verifyOtp({
  token_hash: tokenHash,
  type: 'magiclink',
})
if (loginError || !authData?.session) throw new Error(`verifyOtp staging: ${loginError?.message || 'sin sesión'}`)
const cuentaId = authData.user.id

let currentOperatorToken = null
async function api(pathname, method = 'GET', body = null, tokenOverride = undefined) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' }
  const opTok = tokenOverride !== undefined ? tokenOverride : currentOperatorToken
  if (opTok) headers['X-Operator-Session'] = opTok
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${ORIGIN}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: res.status, data }
}

let passed = 0
let failed = 0
function check(nombre, ok, detalle = '') {
  if (ok) {
    passed++
    console.log(`✅ ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  } else {
    failed++
    console.error(`❌ ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  }
}

// Respaldo de designaciones existentes en dic-2026 / ene-2027 para restaurar al final
const { data: respaldoPrevio } = await srv
  .from('comision_designacion_diaria')
  .select('*')
  .eq('cuenta_id', cuentaId)
  .gte('fecha', '2026-12-01')
  .lte('fecha', '2027-01-31')

const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
const PIN_JEFE = '654321'
const PIN_VEND = '4321'
const NOMBRE_JEFE = `OP036 Jefe ${sufijo}`
const NOMBRE_V1   = `OP036 VendA ${sufijo}`
const NOMBRE_V2   = `OP036 VendB ${sufijo}`
const usuariosCreados = []
const fechasTocadas = ['2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26', '2027-01-02']

try {
  // 0. Abrir sesión super-admin para preparar 1 jefe y 2 vendedores temporales de prueba
  const sa = await api('/api/auth/super-admin', 'POST', { code: superCode })
  const superToken = sa.data?.operatorSession?.token
  if (!superToken) throw new Error(`No se abrió sesión super-admin (HTTP ${sa.status})`)
  currentOperatorToken = superToken

  const uJefe = await api('/api/admin/users', 'POST', { nombre: NOMBRE_JEFE, rol: 'jefe', pin: PIN_JEFE })
  const uV1   = await api('/api/admin/users', 'POST', { nombre: NOMBRE_V1, rol: 'vendedor', pin: PIN_VEND })
  const uV2   = await api('/api/admin/users', 'POST', { nombre: NOMBRE_V2, rol: 'supervisor', pin: PIN_JEFE })
  for (const u of [uJefe, uV1, uV2]) {
    if (u.data?.id) usuariosCreados.push(u.data.id)
  }
  if (usuariosCreados.length !== 3) {
    throw new Error(`No se pudieron crear los 3 operadores temporales (${usuariosCreados.length}/3)`)
  }

  // 1. Iniciar sesión como Vendedor y verificar que NO puede usar el calendario (403)
  const loginVend = await api('/api/auth/switch-operator', 'POST', { operator_id: uV1.data.id, pin: PIN_VEND })
  const vendToken = loginVend.data?.operatorSession?.token
  const intentoVend = await api('/api/comisiones/designacion', 'POST', {
    cambios: [{ fecha: '2026-12-05', designado_id: uV1.data.id }],
  }, vendToken)
  check('Guardarraíl de rol: un vendedor recibe 403 al intentar programar sábados', intentoVend.status === 403, `HTTP ${intentoVend.status}`)

  // 2. Iniciar sesión como Jefe
  const loginJefe = await api('/api/auth/switch-operator', 'POST', { operator_id: uJefe.data.id, pin: PIN_JEFE })
  const jefeToken = loginJefe.data?.operatorSession?.token
  if (!jefeToken) throw new Error(`No se pudo iniciar sesión como Jefe temporal (HTTP ${loginJefe.status})`)
  currentOperatorToken = jefeToken

  // 3. Guardarraíl: rechaza día que no es sábado (martes 2026-12-08)
  const intentoMartes = await api('/api/comisiones/designacion', 'POST', {
    cambios: [{ fecha: '2026-12-08', designado_id: uV1.data.id }],
  })
  check('Guardarraíl de calendario: rechaza fecha que no es sábado (martes)', intentoMartes.status === 400, `${intentoMartes.data?.error || ''}`)

  // 4. Guardarraíl: rechaza sábado pasado (2026-11-07) tanto en POST lote como en DELETE individual
  const intentoPasado = await api('/api/comisiones/designacion', 'POST', {
    cambios: [{ fecha: '2026-11-07', designado_id: uV1.data.id }],
  })
  check('Guardarraíl de historial (lote): rechaza modificar un sábado pasado', intentoPasado.status === 400, `${intentoPasado.data?.error || ''}`)

  const intentoBorrarPasado = await api('/api/comisiones/designacion', 'DELETE', { fecha: '2026-11-07' })
  check('Guardarraíl de historial (DELETE): rechaza borrar un sábado pasado', intentoBorrarPasado.status === 400, `${intentoBorrarPasado.data?.error || ''}`)

  // 5. Programar los 4 sábados de diciembre 2026 de una sola vez (lote)
  const guardarDic = await api('/api/comisiones/designacion', 'POST', {
    cambios: [
      { fecha: '2026-12-05', designado_id: uV1.data.id },
      { fecha: '2026-12-12', designado_id: uV2.data.id },
      { fecha: '2026-12-19', designado_id: uV1.data.id },
      { fecha: '2026-12-26', designado_id: uV2.data.id },
    ],
  })
  check(
    'Guardar lote de los 4 sábados de diciembre 2026 en un solo paso',
    guardarDic.status === 200 && guardarDic.data?.actualizadas?.length === 4,
    `HTTP ${guardarDic.status} (${guardarDic.data?.actualizadas?.length || 0} sábados guardados)`,
  )

  // 6. Consultar el rango de diciembre 2026 y comprobar los 4 sábados
  const leerDic = await api('/api/comisiones/designacion?desde=2026-12-01&hasta=2026-12-31', 'GET')
  const filasDic = Array.isArray(leerDic.data) ? leerDic.data : []
  check(
    'Lectura del mes completo devuelve los 4 sábados asignados con nombre y rol',
    leerDic.status === 200 && filasDic.length === 4 && filasDic.every(r => r.designado?.nombre),
    `filas=${filasDic.length}`,
  )

  // 7. Quitar un sábado (2026-12-26 -> null) y cambiar otro (2026-12-19 -> uV2) en el mismo lote
  const editarDic = await api('/api/comisiones/designacion', 'POST', {
    cambios: [
      { fecha: '2026-12-19', designado_id: uV2.data.id },
      { fecha: '2026-12-26', designado_id: null },
    ],
  })
  const leerDic2 = await api('/api/comisiones/designacion?desde=2026-12-01&hasta=2026-12-31', 'GET')
  const mapDic2 = Object.fromEntries((leerDic2.data || []).map(r => [r.fecha, r.designado_id]))
  check(
    'Modificar un sábado y vaciar otro en el mismo lote actualiza y elimina correctamente',
    editarDic.status === 200 && mapDic2['2026-12-19'] === uV2.data.id && !mapDic2['2026-12-26'],
    `19-dic=${mapDic2['2026-12-19'] === uV2.data.id ? 'actualizado' : 'fallo'}, 26-dic=${!mapDic2['2026-12-26'] ? 'eliminado' : 'fallo'}`,
  )

  // 8. Prueba real en navegador (Chromium) con el usuario Jefe entrando a Comisiones
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    const storageKey = `sb-${STAGING_PROJECT_REF}-auth-token`
    await context.addInitScript(({ k, v }) => {
      window.localStorage.setItem(k, v)
    }, { k: storageKey, v: JSON.stringify(authData.session) })

    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', err => pageErrors.push(err.message))

    await page.goto(ORIGIN, { waitUntil: 'networkidle' })

    // Elegir al operador Jefe temporal en "¿Quién está operando?" y escribir su PIN de 6 dígitos
    const tarjetaJefe = page.getByText(new RegExp(NOMBRE_JEFE, 'i')).first()
    await tarjetaJefe.waitFor({ state: 'visible', timeout: 15000 })
    await tarjetaJefe.click()

    await page.waitForTimeout(350)
    await page.keyboard.type(PIN_JEFE, { delay: 70 })

    // Navegar a Comisiones por el menú lateral
    const linkComisiones = page.locator('a[href="/comisiones"], button:has-text("Comisiones")').first()
    await linkComisiones.waitFor({ state: 'visible', timeout: 15000 })
    await linkComisiones.click()

    // Verificar que aparece el nuevo panel "Calendario de designados (sábados)"
    const panel = page.getByTestId('calendario-sabados-panel')
    await panel.waitFor({ state: 'visible', timeout: 15000 })
    const tituloMesInicial = (await page.getByTestId('calendario-mes-titulo').innerText()).trim()
    check('UI Navegador: el Jefe ve el Calendario de designados (sábados)', tituloMesInicial === 'Noviembre 2026', `Mes inicial: ${tituloMesInicial}`)

    // Verificar que los sábados pasados de noviembre (07, 14, 21) aparecen con candado "Cerrado" y el 28 con "Próximo sábado"
    const card21 = await page.getByTestId('sabado-card-2026-11-21').innerText()
    const card28 = await page.getByTestId('sabado-card-2026-11-28').innerText()
    check(
      'UI Navegador: sábados pasados bloqueados ("Cerrado") y sábado 28 marcado como "Próximo sábado"',
      card21.includes('Cerrado') && card28.includes('Próximo sábado'),
      `21-nov="${card21.replace(/\s+/g, ' ')}" | 28-nov="${card28.replace(/\s+/g, ' ')}"`,
    )

    // Avanzar a Diciembre 2026 con el botón ▶ y esperar específicamente la carga de diciembre (hasta=2026-12-31)
    const respDicPromise = page.waitForResponse(
      r => r.url().includes('/api/comisiones/designacion') && r.url().includes('2026-12-31') && r.request().method() === 'GET',
      { timeout: 10000 },
    )
    await page.getByTestId('calendario-mes-next').click()
    await respDicPromise
    await page.waitForTimeout(300)
    const tituloDic = (await page.getByTestId('calendario-mes-titulo').innerText()).trim()
    const estadoDic = (await page.getByTestId('calendario-estado-mes').innerText()).trim()
    check(
      'UI Navegador: navegación a Diciembre 2026 muestra "3 de 4 asignados (falta 1)"',
      tituloDic === 'Diciembre 2026' && estadoDic.includes('3 de 4'),
      `${tituloDic} -> ${estadoDic}`,
    )

    // Asignar el 4to sábado (Sáb 26 dic) desde el navegador y guardar con ConfirmModal
    const card26Dic = page.getByTestId('sabado-card-2026-12-26')
    await card26Dic.locator('button').first().click()
    await page.waitForTimeout(200)
    await page.locator('button', { hasText: NOMBRE_V1 }).last().click()

    const btnGuardar = page.getByTestId('calendario-guardar-btn')
    const textoBoton = (await btnGuardar.innerText()).trim()
    check('UI Navegador: al elegir un sábado se activa "Guardar cambios (1)"', textoBoton.includes('Guardar cambios (1)'), textoBoton)

    // Verificar guardarraíl: con cambios sin guardar, las flechas de mes quedan bloqueadas y aparece aviso
    const nextDisabled = await page.getByTestId('calendario-mes-next').isDisabled()
    const avisoPendVisible = await page.getByTestId('calendario-aviso-pendientes').isVisible()
    check(
      'UI Navegador: con cambios sin guardar bloquea flechas de mes y muestra aviso claro',
      nextDisabled && avisoPendVisible,
      `nextDisabled=${nextDisabled}, aviso=${avisoPendVisible}`,
    )

    await btnGuardar.click()
    const btnConfirmarModal = page.getByRole('button', { name: 'Sí, guardar sábados' })
    await btnConfirmarModal.waitFor({ state: 'visible', timeout: 5000 })
    await btnConfirmarModal.click()

    await page.waitForTimeout(1000)
    const estadoDicCompleto = (await page.getByTestId('calendario-estado-mes').innerText()).trim()
    check(
      'UI Navegador: tras confirmar en el modal, diciembre queda completo ("4 de 4 sábados asignados")',
      estadoDicCompleto.includes('4 de 4 sábados asignados'),
      estadoDicCompleto,
    )

    // Prueba adicional en vista CELULAR (390×844): sin desborde horizontal y selector móvil usable
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(350)
    const mobileMetrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    const panelVisibleMobile = await page.getByTestId('calendario-sabados-panel').isVisible()
    check(
      'UI Celular (390×844): calendario visible y sin desborde horizontal',
      panelVisibleMobile && mobileMetrics.scrollWidth <= mobileMetrics.innerWidth + 1,
      `scrollWidth=${mobileMetrics.scrollWidth} / innerWidth=${mobileMetrics.innerWidth}`,
    )

    // Tocar un sábado futuro en celular y comprobar que abre el selector móvil a pantalla completa
    await page.getByTestId('sabado-card-2026-12-26').locator('button').first().click()
    await page.waitForTimeout(250)
    const opcionMovilVisible = await page.locator('button', { hasText: NOMBRE_V2 }).last().isVisible()
    check('UI Celular (390×844): selector táctil de vendedor abre y muestra opciones limpias', opcionMovilVisible)
    await page.keyboard.press('Escape').catch(() => {})

    check('UI Navegador: 0 errores de JavaScript en consola', pageErrors.length === 0, `errores=${pageErrors.length}`)
  } finally {
    await browser.close()
  }
} finally {
  // Limpieza garantizada: borrar fechas de prueba, restaurar respaldo previo y borrar operadores temporales
  await srv
    .from('comision_designacion_diaria')
    .delete()
    .eq('cuenta_id', cuentaId)
    .in('fecha', fechasTocadas)

  if (Array.isArray(respaldoPrevio) && respaldoPrevio.length > 0) {
    await srv.from('comision_designacion_diaria').upsert(respaldoPrevio, { onConflict: 'cuenta_id,fecha' })
  }

  for (const id of usuariosCreados) {
    await srv.from('usuarios').delete().eq('id', id).eq('cuenta_id', cuentaId)
  }
}

const { data: restosUsuarios } = await srv
  .from('usuarios')
  .select('id')
  .eq('cuenta_id', cuentaId)
  .ilike('nombre', `OP036 % ${sufijo}`)
check('Limpieza final: 0 usuarios de prueba quedaron en staging', (restosUsuarios || []).length === 0)

console.log(`\nRESUMEN OP-2026-036 STAGING: ${passed}/${passed + failed} comprobaciones en verde`)
process.exit(failed === 0 ? 0 : 1)
