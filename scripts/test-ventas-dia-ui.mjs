#!/usr/bin/env node
/**
 * Smoke de UI — "Ventas del día" (hoja de Logística para Administración) contra STAGING.
 *
 * Qué verifica, entrando por la interfaz real (login → operador Logística con PIN → Reportes → Ventas del día):
 *  - Aparecen las notas creadas ese día (incluida la pendiente), cada pago en su columna, Bs con la tasa
 *    escrita o con el monto real en Bs cuando el pago lo trae, referencias, subtotales y resumen.
 *  - Avisos: nota sin pago y nota pendiente. Notas que faltan: la anulada y la de otro día.
 *  - "Descargar PDF" baja la hoja (1 página) y "Enviar por WhatsApp" (PC) descarga y abre wa.me.
 *  - Seguridad: un vendedor y administración reciben 403; sin sesión 401; filtros extra 400.
 *
 * Seguridad de entornos: solo staging (guardia de ref `spup…`); crea una cuenta E2E temporal con
 * datos propios y TODO se elimina al final. Los secretos se leen de `construacero-staging/` y no se imprimen.
 *
 * Uso:  node scripts/test-ventas-dia-ui.mjs
 * Requiere staging levantado (vite 5174 + worker 8789).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { hashPinPBKDF2, generateSalt } from '../construacero-staging/api/lib/crypto.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stagingRoot = path.join(repoRoot, 'construacero-staging')
const FRONTEND = process.env.VD_UI_FRONTEND || 'http://localhost:5174'
const WORKER = process.env.VD_UI_WORKER || 'http://127.0.0.1:8789'
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const SHOT_DIR = path.join(repoRoot, 'tmp', 'ventas-dia-ui')
const PIN6 = '424242' // Logística y administración usan PIN de 6 dígitos
const PIN4 = '4242'   // vendedores, 4
const SABADO = '2026-10-31'
const VIERNES = '2026-10-30'
const TASA = '1012'

function parseEnvFile(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

const config = { ...parseEnvFile(path.join(stagingRoot, '.env')), ...parseEnvFile(path.join(stagingRoot, '.dev.vars')) }
const supabaseUrl = config.SUPABASE_URL || config.VITE_SUPABASE_URL
const anonKey = config.SUPABASE_ANON_KEY || config.VITE_SUPABASE_ANON_KEY
const serviceKey = config.SUPABASE_SERVICE_KEY
if (!supabaseUrl || !supabaseUrl.includes(STAGING_REF)) throw new Error(`Guardia de entorno: se esperaba staging (${STAGING_REF})`)
if (!serviceKey || !anonKey) throw new Error('Faltan llaves de staging en construacero-staging/.env o .dev.vars')

const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
const adminFetch = (p, o = {}) => fetch(`${supabaseUrl}${p}`, { ...o, headers: { ...adminHeaders, ...(o.headers || {}) } })
async function assertOk(response, label) {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} — ${(await response.text()).slice(0, 600)}`)
  const t = await response.text()
  return t ? JSON.parse(t) : null
}
// Montos en pantalla con formato venezolano (150.600,00); se comparan sin separadores de miles.
const limpio = t => t.replace(/ /g, ' ').replace(/\.(?=\d{3}(\D|$))/g, '')
function assert(cond, msg) {
  if (!cond) throw new Error(`Falló: ${msg}`)
  console.log(`  ✓ ${msg}`)
}
const insertar = async (tabla, filas, label) => assertOk(await adminFetch(`/rest/v1/${tabla}`, {
  method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(filas),
}), label)

const EMAIL = `test-ventas-dia-${Date.now()}@construacero.test`
const PASSWORD = `VentasDia-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 10000}`
const LOGISTICA = 'TEST VD LOGISTICA'
const estado = { userId: null, configId: null, usuarioIds: [], operadores: {}, clienteIds: [], cotizacionIds: [], despachoIds: [], numeros: {} }

async function provisionar() {
  const user = await assertOk(await adminFetch('/auth/v1/admin/users', {
    method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  }), 'Crear cuenta E2E temporal')
  estado.userId = user.id
  estado.configId = 900000 + Math.floor(Math.random() * 90000)
  await insertar('configuracion_negocio?select=id', { id: estado.configId, cuenta_id: estado.userId, nombre_negocio: 'TEST VENTAS DEL DIA' }, 'Configuración E2E')

  const salt = generateSalt()
  const hash6 = await hashPinPBKDF2(PIN6, salt)
  const hash4 = await hashPinPBKDF2(PIN4, salt)
  const [logi] = await insertar('usuarios?select=id', { id: estado.userId, nombre: LOGISTICA, rol: 'logistica', activo: true, cuenta_id: estado.userId, pin_hash: hash6, pin_salt: salt }, 'Operador logística')
  const [vend] = await insertar('usuarios?select=id', { nombre: 'TEST VD VENDEDOR', rol: 'vendedor', activo: true, cuenta_id: estado.userId, pin_hash: hash4, pin_salt: salt }, 'Operador vendedor')
  const [adm] = await insertar('usuarios?select=id', { nombre: 'TEST VD ADMIN', rol: 'administracion', activo: true, cuenta_id: estado.userId, pin_hash: hash6, pin_salt: salt }, 'Operador administración')
  estado.usuarioIds = [logi.id, vend.id, adm.id]
  estado.operadores = { logistica: [logi.id, PIN6], vendedor: [vend.id, PIN4], administracion: [adm.id, PIN6] }

  const clientes = await insertar('clientes?select=id,nombre', [
    { nombre: 'TEST VD FERRETERIA SOL', rif_cedula: 'J-11111111', telefono: '04140000001', saldo_pendiente: 0, activo: true, vendedor_id: vend.id, cuenta_id: estado.userId },
    { nombre: 'TEST VD CONSTRUCTORA LUNA', rif_cedula: 'J-22222222', telefono: '04140000002', saldo_pendiente: 0, activo: true, vendedor_id: vend.id, cuenta_id: estado.userId },
    { nombre: 'TEST VD ANA RIVERO', rif_cedula: 'V-33333333', telefono: '04140000003', saldo_pendiente: 0, activo: true, vendedor_id: vend.id, cuenta_id: estado.userId },
  ], 'Clientes de prueba')
  estado.clienteIds = clientes.map(c => c.id)
  const [sol, luna, ana] = clientes

  // Se insertan en orden: así los números salen seguidos y la anulada y la del viernes quedan "en medio".
  const ventas = [
    { k: 'A', cliente: sol.id, fecha: SABADO, total: 150, estado: 'despachada', pagos: [{ metodo: 'Efectivo $', monto: 100 }, { metodo: 'Transf. / Pago Móvil', monto: 50, referencia: '123456' }] },
    { k: 'ANULADA', cliente: luna.id, fecha: SABADO, total: 30, estado: 'anulada', pagos: [{ metodo: 'Zelle', monto: 30 }] },
    { k: 'VIERNES', cliente: luna.id, fecha: VIERNES, total: 40, estado: 'entregada', pagos: [{ metodo: 'Zelle', monto: 40 }] },
    { k: 'D', cliente: luna.id, fecha: SABADO, total: 118.81, estado: 'despachada', pagos: [{ metodo: 'Transf. / Pago Móvil', monto: 98.81, monto_bs: 100000, referencia: '777' }, { metodo: 'Cta por cobrar', monto: 20, diasVencimiento: 15 }] },
    { k: 'CERO', cliente: ana.id, fecha: SABADO, total: 25, estado: 'despachada', pagos: [{ metodo: 'Efectivo $', monto: 0 }] },
    { k: 'PEND', cliente: sol.id, fecha: SABADO, total: 13, estado: 'pendiente', pagos: [{ metodo: 'Efectivo $', monto: 13 }] },
  ]
  for (const v of ventas) {
    const [cot] = await insertar('cotizaciones?select=id,numero', {
      cuenta_id: estado.userId, cliente_id: v.cliente, vendedor_id: vend.id, estado: 'aceptada',
      subtotal_usd: v.total, total_usd: v.total, creado_en: `${v.fecha}T09:00:00-04:00`,
    }, `Cotización ${v.k}`)
    estado.cotizacionIds.push(cot.id)
    const [d] = await insertar('notas_despacho?select=id,numero', {
      cotizacion_id: cot.id, cuenta_id: estado.userId, vendedor_id: vend.id, cliente_id: v.cliente, estado: v.estado,
      creado_en: `${v.fecha}T10:00:00-04:00`, total_usd: v.total, flete_usd: 0, descuento_total_usd: 0,
      forma_pago: JSON.stringify(v.pagos), creado_por: vend.id,
    }, `Despacho ${v.k}`)
    estado.despachoIds.push(d.id)
    estado.numeros[v.k] = d.numero
  }
  console.log(`  · Datos listos: sábado ${SABADO} con 5 notas (1 anulada) y 1 nota del viernes. Números: ${JSON.stringify(estado.numeros)}`)
}

async function limpiar() {
  const del = p => adminFetch(p, { method: 'DELETE' }).catch(() => {})
  if (estado.despachoIds.length) {
    await del(`/rest/v1/notas_despacho_items?despacho_id=in.(${estado.despachoIds.join(',')})`)
    await del(`/rest/v1/notas_despacho?id=in.(${estado.despachoIds.join(',')})`)
  }
  if (estado.cotizacionIds.length) {
    await del(`/rest/v1/cotizacion_items?cotizacion_id=in.(${estado.cotizacionIds.join(',')})`)
    await del(`/rest/v1/cotizaciones?id=in.(${estado.cotizacionIds.join(',')})`)
  }
  if (estado.clienteIds.length) await del(`/rest/v1/clientes?id=in.(${estado.clienteIds.join(',')})`)
  if (estado.usuarioIds.length) await del(`/rest/v1/usuarios?id=in.(${estado.usuarioIds.join(',')})`)
  if (estado.configId) await del(`/rest/v1/configuracion_negocio?id=eq.${estado.configId}`)
  if (estado.userId) await del(`/auth/v1/admin/users/${estado.userId}`)
  const resto = await (await adminFetch(`/rest/v1/notas_despacho?select=id&cuenta_id=eq.${estado.userId}`)).json().catch(() => [])
  const restoCli = await (await adminFetch(`/rest/v1/clientes?select=id&cuenta_id=eq.${estado.userId}`)).json().catch(() => [])
  console.log(`· Limpieza completada (restos de la cuenta E2E: ${Array.isArray(resto) ? resto.length : '?'} despachos, ${Array.isArray(restoCli) ? restoCli.length : '?'} clientes)`)
}

async function sesionDe(rol) {
  const token = await assertOk(await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }), 'Login REST cuenta E2E')
  const [id, pin] = estado.operadores[rol]
  const sesion = await assertOk(await fetch(`${WORKER}/api/auth/switch-operator`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_id: id, pin }),
  }), `Sesión de operador ${rol}`)
  return { Authorization: `Bearer ${token.access_token}`, 'X-Operator-Id': id, 'X-Operator-Session': sesion.operatorSession?.token || sesion.token }
}

async function verificarServidor() {
  const url = `${WORKER}/api/reportes/ventas-dia?fecha=${SABADO}`
  const h = await sesionDe('logistica')
  const ok = await fetch(url, { headers: h })
  const body = await ok.json()
  assert(ok.status === 200, 'Servidor: Logística consulta la hoja (200)')
  assert(body.resumen.notas === 4, 'Servidor: 4 notas del sábado (sin la anulada ni la del viernes; con la pendiente)')
  assert(body.resumen.totalVendidoUsd === 306.81 && body.resumen.cobradoUsd === 261.81 && body.resumen.porCobrarUsd === 20, 'Servidor: total $306,81 = cobrado $261,81 + por cobrar $20')
  assert(body.resumen.efectivoUsdEsperado === 113, 'Servidor: efectivo $ esperado $113')
  const motivos = Object.fromEntries(body.faltantes.map(f => [f.numero, f.motivo]))
  assert(motivos[estado.numeros.ANULADA] === 'Anulada', 'Servidor: la nota anulada aparece en "faltantes" como Anulada')
  assert(motivos[estado.numeros.VIERNES] === 'Es de otro día (30/10/2026)', 'Servidor: la nota del viernes aparece como "Es de otro día"')

  for (const rol of ['vendedor', 'administracion']) {
    const r = await fetch(url, { headers: await sesionDe(rol) })
    assert(r.status === 403, `Servidor: ${rol} no tiene acceso (403)`)
  }
  assert((await fetch(url)).status === 401, 'Servidor: sin sesión → 401')
  assert((await fetch(`${url}&cuenta=otra`, { headers: h })).status === 400, 'Servidor: filtros extra → 400')
  assert((await fetch(`${WORKER}/api/reportes/ventas-dia?fecha=31-10-2026`, { headers: h })).status === 400, 'Servidor: fecha inválida → 400')
}

async function verificarUI() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })
  await context.route('https://wa.me/**', route => route.fulfill({ status: 200, body: 'wa.me (interceptado)' }))
  const page = await context.newPage()
  const errores = []
  page.on('pageerror', e => errores.push(e.message))
  try {
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[placeholder="correo@empresa.com"]', EMAIL)
    await page.fill('input[placeholder="••••••••"]', PASSWORD)
    await page.click('button:has-text("Acceder")')
    await page.waitForSelector('text=Selecciona tu usuario e ingresa tu PIN', { timeout: 20000 })
    await page.getByText(new RegExp(LOGISTICA.replace(/ /g, '\\s+'), 'i')).first().click()
    await page.waitForSelector('text=Ingresa tu PIN', { timeout: 10000 })
    for (const d of PIN6) await page.getByRole('button', { name: d, exact: true }).click()
    await page.waitForSelector('a[href="/reportes"]', { timeout: 20000 })

    await page.locator('a[href="/reportes"]').first().click()
    await page.getByRole('button', { name: /Ventas del día|Del día/ }).first().click()
    await page.waitForSelector('[data-testid="ventas-dia"]', { timeout: 30000 })
    assert(true, 'Reportes de Logística: aparece la pestaña "Ventas del día"')
    const pestanas = await page.locator('button:has-text("Comisiones"), button:has-text("Crédito")').count()
    assert(pestanas === 0, 'Reportes de Logística: no ve Comisiones ni Crédito')
    await page.fill('[data-testid="ventas-dia-fecha"]', SABADO)
    await page.fill('[data-testid="ventas-dia-tasa"]', TASA)
    await page.waitForSelector('[data-testid="ventas-dia-tabla"]', { timeout: 30000 })
    await page.waitForTimeout(800)
    const texto = limpio(await page.locator('[data-testid="ventas-dia"]').innerText())
    assert(texto.includes('Sábado 31/10/2026') && texto.includes('Tasa 1012,00'), 'Pantalla: muestra el día (Sábado 31/10/2026) y la tasa escrita')
    assert(texto.includes('TEST VD FERRETERIA SOL') && texto.includes('TEST VD ANA RIVERO'), 'Pantalla: aparecen los clientes del sábado')
    assert(texto.includes('50600,00') && texto.includes('100000,00') && texto.includes('150600,00'), 'Pantalla: pago móvil en Bs (con tasa y con monto real) y su subtotal 150.600,00')
    assert(texto.includes('Ref. 123456') && texto.includes('Ref. 777'), 'Pantalla: referencias de pago móvil')
    assert(texto.includes('Sin pago registrado') && texto.includes('Pendiente de aprobar'), 'Pantalla: avisos de nota sin pago y nota pendiente')
    assert(texto.includes('$306,81') && texto.includes('$261,81') && texto.includes('$20,00'), 'Pantalla: resumen total $306,81, cobrado $261,81, por cobrar $20')
    assert(texto.includes(`${String(estado.numeros.ANULADA).padStart(5, '0')} — Anulada`) && texto.includes('Es de otro día (30/10/2026)'), 'Pantalla: "Notas que no aparecen" con la anulada y la del viernes')

    assert(!texto.includes('Cuadre'), 'Pantalla: ya no hay recuadro de cuadre de efectivo')
    await page.screenshot({ path: path.join(SHOT_DIR, '01-ventas-del-dia.png'), fullPage: true })

    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('button:has-text("Descargar PDF")')])
    const pdfPath = path.join(SHOT_DIR, descarga.suggestedFilename())
    await descarga.saveAs(pdfPath)
    const pdf = fs.readFileSync(pdfPath)
    const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length
    assert(pdf.subarray(0, 4).toString() === '%PDF' && descarga.suggestedFilename() === `Ventas_del_dia_${SABADO}.pdf`, `PDF descargado: ${descarga.suggestedFilename()} (${Math.round(pdf.length / 1024)} KB, ${paginas} página/s)`)
    assert(paginas === 1, 'PDF: cabe en una sola hoja')

    const [descargaWa, popup] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      context.waitForEvent('page', { timeout: 30000 }),
      page.click('button:has-text("Enviar por WhatsApp")'),
    ])
    assert(descargaWa.suggestedFilename().endsWith('.pdf') && popup.url().startsWith('https://wa.me/'), 'WhatsApp (PC): descarga el PDF y abre wa.me con el mensaje')
    await popup.close()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const anchoPagina = await page.evaluate(() => document.documentElement.scrollWidth)
    assert(anchoPagina <= 400, `Teléfono: la página no se desborda a lo ancho (${anchoPagina}px; la tabla se desplaza dentro de su caja)`)
    await page.screenshot({ path: path.join(SHOT_DIR, '02-telefono.png'), fullPage: true })

    if (errores.length) throw new Error(`Errores de consola: ${errores.join(' | ')}`)
    console.log(`\nOK — "Ventas del día" verificado en staging. Evidencia en ${path.relative(repoRoot, SHOT_DIR)}/`)
  } catch (error) {
    try {
      await page.screenshot({ path: path.join(SHOT_DIR, 'fallo.png'), fullPage: true })
      console.error(`URL al fallar: ${page.url()}\nTexto (inicio):\n${(await page.locator('body').innerText()).slice(0, 1500)}`)
      if (errores.length) console.error(`Errores de consola: ${errores.join(' | ')}`)
    } catch { /* sin diagnóstico */ }
    throw error
  } finally {
    await browser.close()
  }
}

try {
  console.log(`Smoke UI "Ventas del día" → staging (${STAGING_REF}) vía ${FRONTEND}`)
  await provisionar()
  await verificarServidor()
  await verificarUI()
} catch (error) {
  console.error(`\nFALLO: ${error.message}`)
  process.exitCode = 1
} finally {
  await limpiar()
}
