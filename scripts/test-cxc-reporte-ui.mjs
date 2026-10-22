#!/usr/bin/env node
/**
 * Smoke de UI — Reporte Crédito/CxC (Lote ERP) contra STAGING.
 *
 * Qué verifica: que la pestaña Crédito de Reportes muestre cifras REALES
 * (saldo inicial, cargos, abonos, cuadre de movimientos y movimientos del
 * período) usando datos de prueba con montos conocidos, entrando por la
 * interfaz real (login → operador con PIN → Reportes → Crédito).
 *
 * Seguridad de entornos:
 *  - Solo corre contra el proyecto de staging (guardia de ref `spup…`).
 *  - Crea una cuenta E2E temporal y fixtures propios; TODO se elimina al final.
 *  - Los secretos viven en `construacero-staging/.env` y `.dev.vars`; este
 *    script los lee pero nunca los imprime.
 *
 * Uso:  node scripts/test-cxc-reporte-ui.mjs
 * Requiere el entorno de staging levantado (vite 5173 + worker 8787).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { hashPinPBKDF2, generateSalt } from '../api/lib/crypto.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stagingRoot = path.join(repoRoot, 'construacero-staging')
const FRONTEND = process.env.CXC_UI_FRONTEND || 'http://localhost:5173'
const WORKER = process.env.CXC_UI_WORKER || 'http://127.0.0.1:8787'
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const SHOT_DIR = path.join(repoRoot, 'tmp', 'cxc-reporte-ui')

// PIN de 6 dígitos del operador de prueba (rol jefe → PIN de 6).
const PIN = '424242'

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

const config = {
  ...parseEnvFile(path.join(stagingRoot, '.env')),
  ...parseEnvFile(path.join(stagingRoot, '.dev.vars')),
}
const supabaseUrl = config.SUPABASE_URL || config.VITE_SUPABASE_URL
const anonKey = config.SUPABASE_ANON_KEY || config.VITE_SUPABASE_ANON_KEY
const serviceKey = config.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseUrl.includes(STAGING_REF)) {
  throw new Error(`Guardia de entorno: se esperaba la URL de staging (${STAGING_REF}). Obtenida: ${supabaseUrl || '(vacía)'}`)
}
if (!serviceKey) throw new Error('Falta SUPABASE_SERVICE_KEY en construacero-staging/.dev.vars')
if (!anonKey) throw new Error('Falta VITE_SUPABASE_ANON_KEY en construacero-staging/.env')

// ─── Helpers de API (solo staging) ──────────────────────────────────────────
const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function adminFetch(pathname, options = {}) {
  return fetch(`${supabaseUrl}${pathname}`, { ...options, headers: { ...adminHeaders, ...(options.headers || {}) } })
}

async function assertOk(response, label) {
  if (!response.ok) {
    const body = await response.text()
    let detalle = body
    try {
      const parsed = JSON.parse(body)
      detalle = `${parsed.message || ''} ${parsed.details || ''} ${parsed.hint || ''}`.trim()
    } catch { /* cuerpo no-JSON */ }
    throw new Error(`${label}: HTTP ${response.status} — ${detalle.slice(0, 700)}`)
  }
  return response.json ? response.json() : null
}

function assert(condicion, mensaje) {
  if (!condicion) throw new Error(`ASSERTION FAILED: ${mensaje}`)
  console.log(`  ✓ ${mensaje}`)
}

// ─── Fixtures con montos conocidos ──────────────────────────────────────────
// Rango por defecto de la pestaña Crédito = mes en curso (2026-10-01 → hoy).
//   Saldo inicial (sep): cargo $40 − abono $10 ................ $30.00
//   Cargos octubre:      $100 + $50 .......................... $150.00
//   Abonos octubre:      $30 (efectivo $) .................... $30.00
//   Neto al cierre:      30 + 150 − 30 ....................... $150.00
const EMAIL = `test-cxc-ui-${Date.now()}@construacero.test`
const PASSWORD = `CxcUi-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 10000}`
const OPERADOR_NOMBRE = 'TEST CXC UI JEFE'

const MOVIMIENTOS = [
  { tipo: 'cargo', monto_usd: 40, creado_en: '2026-09-20T10:00:00-04:00', descripcion: 'TEST CXC UI cargo septiembre' },
  { tipo: 'abono', monto_usd: 10, creado_en: '2026-09-25T10:00:00-04:00', descripcion: 'TEST CXC UI abono septiembre', forma_pago_abono: '[{"metodo":"Efectivo $","monto":10}]' },
  { tipo: 'cargo', monto_usd: 100, creado_en: '2026-10-05T10:00:00-04:00', descripcion: 'TEST CXC UI cargo octubre 1' },
  { tipo: 'cargo', monto_usd: 50, creado_en: '2026-10-10T10:00:00-04:00', descripcion: 'TEST CXC UI cargo octubre 2' },
  { tipo: 'abono', monto_usd: 30, creado_en: '2026-10-12T10:00:00-04:00', descripcion: 'TEST CXC UI abono octubre', forma_pago_abono: '[{"metodo":"Efectivo $","monto":30}]' },
]

const estado = { userId: null, usuarioId: null, clienteId: null, movimientoIds: [], configId: null }

async function provisionar() {
  // 1) Cuenta E2E temporal (se elimina al final).
  const userResp = await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  })
  const user = await assertOk(userResp, 'Crear cuenta E2E temporal')
  estado.userId = user.id
  console.log(`  · Cuenta E2E creada (${EMAIL.split('@')[0]}…)`)

  // 2) Configuración de la cuenta E2E con id explícito: el trigger
  //    trg_crear_config_usuario inserta configuracion_negocio sin id y la
  //    secuencia de esa tabla está desincronizada en staging (id=1 ya existe).
  //    Con la fila ya creada, el ON CONFLICT (cuenta_id) del trigger la salta.
  estado.configId = 900000 + Math.floor(Math.random() * 90000)
  const configResp = await adminFetch('/rest/v1/configuracion_negocio?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: estado.configId, cuenta_id: estado.userId, nombre_negocio: 'TEST CXC UI' }),
  })
  await assertOk(configResp, 'Crear configuración de la cuenta E2E')

  // 3) Operador de prueba (rol jefe, con PIN) — el modelo real de acceso:
  //    login con cuenta → elegir operador → PIN.
  const pinSalt = generateSalt()
  const pinHash = await hashPinPBKDF2(PIN, pinSalt)
  const usuarioResp = await adminFetch('/rest/v1/usuarios?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: estado.userId,
      nombre: OPERADOR_NOMBRE,
      rol: 'jefe',
      activo: true,
      cuenta_id: estado.userId,
      pin_hash: pinHash,
      pin_salt: pinSalt,
    }),
  })
  const [usuario] = await assertOk(usuarioResp, 'Crear operador de prueba (jefe + PIN)')
  estado.usuarioId = usuario.id

  // 4) Cliente de prueba con saldo coherente ($150).
  const clienteResp = await adminFetch('/rest/v1/clientes?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      nombre: 'TEST CXC UI',
      rif_cedula: 'V-00000000',
      telefono: '',
      saldo_pendiente: 150,
      activo: true,
      vendedor_id: estado.usuarioId,
      cuenta_id: estado.userId,
    }),
  })
  const [cliente] = await assertOk(clienteResp, 'Crear cliente TEST CXC UI')
  estado.clienteId = cliente.id

  // 5) Movimientos del libro CxC (historial completo: sep + oct).
  const movResp = await adminFetch('/rest/v1/cuentas_por_cobrar?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(MOVIMIENTOS.map(m => ({
      cliente_id: estado.clienteId,
      registrado_por: estado.usuarioId,
      tipo: m.tipo,
      monto_usd: m.monto_usd,
      saldo_usd: m.monto_usd,
      creado_en: m.creado_en,
      descripcion: m.descripcion,
      forma_pago_abono: m.forma_pago_abono || null,
      metodo_pago: 'cxc',
    }))),
  })
  const movs = await assertOk(movResp, 'Crear movimientos CxC de prueba')
  estado.movimientoIds = movs.map(m => m.id)
  console.log(`  · Fixtures listos: 1 operador + 1 cliente + ${movs.length} movimientos`)
}

async function limpiar() {
  if (estado.movimientoIds.length) {
    await adminFetch(`/rest/v1/cuentas_por_cobrar?id=in.(${estado.movimientoIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  }
  if (estado.clienteId) {
    await adminFetch(`/rest/v1/clientes?id=eq.${estado.clienteId}`, { method: 'DELETE' }).catch(() => {})
  }
  if (estado.usuarioId) {
    await adminFetch(`/rest/v1/usuarios?id=eq.${estado.usuarioId}`, { method: 'DELETE' }).catch(() => {})
  }
  if (estado.configId) {
    await adminFetch(`/rest/v1/configuracion_negocio?id=eq.${estado.configId}`, { method: 'DELETE' }).catch(() => {})
  }
  if (estado.userId) {
    await adminFetch(`/auth/v1/admin/users/${estado.userId}`, { method: 'DELETE' }).catch(() => {})
  }
  console.log('· Limpieza completada (fixtures y cuenta E2E eliminados)')
}

// ─── Diagnóstico: ¿la cuenta E2E ve sus fixtures por REST? ─────────────────
async function verificarVisibilidadRest() {
  const tokenResp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token = await assertOk(tokenResp, 'Login REST como cuenta E2E')

  const contar = async (headers, etiqueta) => {
    for (const tabla of ['clientes', 'cuentas_por_cobrar']) {
      const resp = await fetch(`${supabaseUrl}/rest/v1/${tabla}?select=id`, { headers: { apikey: anonKey, Authorization: `Bearer ${token.access_token}`, ...headers } })
      const filas = await resp.json()
      console.log(`  · REST ${tabla} (${etiqueta}): HTTP ${resp.status}, ${Array.isArray(filas) ? filas.length : JSON.stringify(filas).slice(0, 160)} fila(s)`)
    }
  }

  await contar({}, 'sin operador')

  // Sesión de operador real vía el Worker (mismo camino que la interfaz).
  const sesionResp = await fetch(`${WORKER}/api/auth/switch-operator`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_id: estado.userId, pin: PIN }),
  })
  const sesion = await assertOk(sesionResp, 'Abrir sesión de operador (jefe) vía Worker')
  const sesionToken = sesion.operatorSession?.token || sesion.token
  if (sesionToken) {
    await contar({ 'X-Operator-Id': estado.userId, 'X-Operator-Session': sesionToken }, 'operador jefe')
  } else {
    console.log('  · Sesión de operador sin token reconocido; se omite esa variante del diagnóstico')
  }
}

// ─── Recorrido por la interfaz real ─────────────────────────────────────────
async function verificarUI() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  const errores = []
  page.on('pageerror', error => errores.push(error.message))

  try {
    // 1) Login con la cuenta E2E.
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[placeholder="correo@empresa.com"]', EMAIL)
    await page.fill('input[placeholder="••••••••"]', PASSWORD)
    await page.click('button:has-text("Acceder")')
    await page.waitForSelector('text=Selecciona tu usuario e ingresa tu PIN', { timeout: 20000 })

    // 2) Operador de prueba → PIN (el camino real de cualquier operador).
    // El nombre se muestra con CSS capitalize; comparar sin distinguir mayúsculas.
    await page.getByText(new RegExp(OPERADOR_NOMBRE.replace(/ /g, '\\s+'), 'i')).first().click()
    await page.waitForSelector('text=Ingresa tu PIN', { timeout: 10000 })
    // Teclado numérico del modal (el input real está oculto); al completar los
    // 6 dígitos el modal se envía solo.
    for (const digito of PIN) {
      await page.getByRole('button', { name: digito, exact: true }).click()
    }
    await page.waitForSelector('a[href="/reportes"]', { timeout: 20000 })

    // 3) Reportes → pestaña Crédito (rango por defecto: mes en curso).
    await page.click('a[href="/reportes"]')
    await page.waitForSelector('button:has-text("Crédito")', { timeout: 20000 })
    await page.click('button:has-text("Crédito")')
    await page.waitForSelector('text=Cuadre de movimientos', { timeout: 30000 })
    await page.waitForTimeout(800)

    const texto = (await page.locator('body').innerText()).replace(/\u00a0/g, ' ')

    // 4) Cifras esperadas de los fixtures (ver MOVIMIENTOS arriba).
    assert(texto.includes('Saldo inicial (deuda)'), 'KPI "Saldo inicial (deuda)" visible')
    assert(texto.includes('Neto: $30.00'), 'Saldo inicial neto = $30.00 (cargo sep $40 − abono sep $10)')
    assert(texto.includes('Cargos del período'), 'KPI "Cargos del período" visible')
    assert(texto.includes('Crédito generado en el rango'), 'Subtítulo de cargos visible')
    assert(texto.includes('Abonos aplicados'), 'KPI "Abonos aplicados" visible')
    assert(texto.includes('Neto inicial $30.00'), 'Cuadre: neto inicial $30.00')
    assert(texto.includes('cargos $150.00'), 'Cuadre: cargos $150.00 ($100 + $50 en octubre)')
    assert(texto.includes('abonos $30.00'), 'Cuadre: abonos $30.00')
    assert(texto.includes('neto al cierre $150.00'), 'Cuadre: neto al cierre $150.00')
    assert(texto.includes('Saldo actual coincide'), 'Cuadre contrastado con el saldo actual: "Saldo actual coincide"')
    assert(texto.includes('Movimientos (3)'), 'Pestaña Movimientos cuenta los 3 movimientos del período')
    assert(texto.includes('Clientes (1)'), 'Pestaña Clientes muestra 1 cliente')
    assert(!texto.includes('Cuadre matemático; ledger no validado'), 'Ya no aparece la etiqueta de "ledger no validado"')

    await page.screenshot({ path: path.join(SHOT_DIR, '01-reporte-cxc-resumen.png'), fullPage: true })

    // 5) Pestaña Movimientos: las 3 filas del período con montos reales.
    await page.click('button:has-text("Movimientos (3)")')
    await page.waitForSelector('text=Actividad CxC del período', { timeout: 10000 })
    const textoMov = (await page.locator('body').innerText()).replace(/\u00a0/g, ' ')
    assert(textoMov.includes('TEST CXC UI'), 'Movimientos: aparece el cliente de prueba')
    assert(textoMov.includes('+$100.00') && textoMov.includes('+$50.00') && textoMov.includes('−$30.00'), 'Movimientos: montos +$100.00 / +$50.00 / −$30.00')
    await page.screenshot({ path: path.join(SHOT_DIR, '02-reporte-cxc-movimientos.png'), fullPage: true })

    // 6) Pestaña Clientes: las columnas del período cierran (30 + 150 − 30 = 150).
    await page.click('button:has-text("Clientes (1)")')
    await page.waitForSelector('text=Clientes con saldo pendiente', { timeout: 10000 })
    const textoCli = (await page.locator('body').innerText()).replace(/\u00a0/g, ' ')
    assert(/saldo inicial/i.test(textoCli) && /abonos per[ií]odo/i.test(textoCli), 'Clientes: columnas "Saldo inicial" y "Abonos período" presentes')
    assert((textoCli.match(/\$150\.00/g) || []).length >= 2, 'Clientes: cargos $150.00 y saldo al cierre $150.00')
    assert((textoCli.match(/\$30\.00/g) || []).length >= 2, 'Clientes: saldo inicial $30.00 y abonos período $30.00')
    await page.screenshot({ path: path.join(SHOT_DIR, '03-reporte-cxc-clientes.png'), fullPage: true })

    if (errores.length) throw new Error(`Errores de consola en la página: ${errores.join(' | ')}`)
    console.log(`\nOK — verificación de UI del reporte Crédito/CxC superada. Evidencia en ${path.relative(repoRoot, SHOT_DIR)}/`)
  } catch (error) {
    // Diagnóstico para ver exactamente qué mostraba la pantalla al fallar.
    try {
      await page.screenshot({ path: path.join(SHOT_DIR, 'fallo.png'), fullPage: true })
      const textoFallo = (await page.locator('body').innerText()).replace(/\u00a0/g, ' ')
      console.error(`URL al fallar: ${page.url()}`)
      console.error(`Texto en pantalla (inicio):\n${textoFallo.slice(0, 1600)}`)
      if (errores.length) console.error(`Errores de consola: ${errores.join(' | ')}`)
    } catch { /* sin diagnóstico posible */ }
    throw error
  } finally {
    await browser.close()
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
try {
  console.log(`Smoke UI reporte Crédito/CxC → staging (${STAGING_REF}) vía ${FRONTEND}`)
  await provisionar()
  await verificarVisibilidadRest()
  await verificarUI()
} catch (error) {
  console.error(`\nFALLO: ${error.message}`)
  process.exitCode = 1
} finally {
  await limpiar()
}
