#!/usr/bin/env node
/**
 * Smoke de UI — "Mis ventas" (reporte del vendedor) contra STAGING.
 *
 * Qué verifica, entrando por la interfaz real (login → operador con PIN → Mis ventas):
 *  - Con el corte viernes–jueves por defecto aparecen SOLO las ventas del vendedor de la sesión
 *    dentro del corte (no las de otro vendedor de la misma cuenta, ni las de fuera del rango).
 *  - Totales, artículos, cliente y comisión con montos conocidos.
 *  - "Descargar PDF" baja un PDF real; "Enviar por WhatsApp" (PC) descarga el PDF y abre wa.me.
 *  - El servidor rechaza pedir ventas de otro vendedor (400) y a un rol sin acceso (403 no aplica aquí).
 *
 * Seguridad de entornos: solo staging (guardia de ref `spup…`); crea una cuenta E2E temporal con
 * fixtures propios y TODO se elimina al final. Los secretos se leen de `construacero-staging/` y no se imprimen.
 *
 * Uso:  node scripts/test-mis-ventas-ui.mjs
 * Requiere staging levantado (vite 5174 + worker 8789).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { hashPinPBKDF2, generateSalt } from '../construacero-staging/api/lib/crypto.js'
import { getCorteSemanalRange } from '../construacero-staging/src/utils/dateHelpers.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stagingRoot = path.join(repoRoot, 'construacero-staging')
const FRONTEND = process.env.MV_UI_FRONTEND || 'http://localhost:5174'
const WORKER = process.env.MV_UI_WORKER || 'http://127.0.0.1:8789'
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const SHOT_DIR = path.join(repoRoot, 'tmp', 'mis-ventas-ui')
const PIN = '4242' // los vendedores usan PIN de 4 dígitos

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
// Monto en pantalla: acepta $255.50 o $195,50 (según el formato regional)
const tiene = (texto, monto) => new RegExp(`\\$${monto.replace('.', '[.,]')}(?!\\d)`).test(texto)
function assert(cond, msg) {
  if (!cond) throw new Error(`Falló: ${msg}`)
  console.log(`  ✓ ${msg}`)
}
const insertar = async (tabla, filas, label) => assertOk(await adminFetch(`/rest/v1/${tabla}`, {
  method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(filas),
}), label)

const EMAIL = `test-mis-ventas-${Date.now()}@construacero.test`
const PASSWORD = `MisVentas-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 10000}`
const VENDEDOR = 'TEST MV VENDEDOR'
const OTRO = 'TEST MV OTRO'
const corte = getCorteSemanalRange(0)
const dia = (ymd, delta) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10) }

const estado = { userId: null, configId: null, usuarioIds: [], clienteIds: [], cotizacionIds: [], despachoIds: [], comisionIds: [], numeros: {} }

async function provisionar() {
  const user = await assertOk(await adminFetch('/auth/v1/admin/users', {
    method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  }), 'Crear cuenta E2E temporal')
  estado.userId = user.id
  estado.configId = 900000 + Math.floor(Math.random() * 90000)
  await insertar('configuracion_negocio?select=id', { id: estado.configId, cuenta_id: estado.userId, nombre_negocio: 'TEST MIS VENTAS' }, 'Configuración E2E')

  const pinSalt = generateSalt()
  const pinHash = await hashPinPBKDF2(PIN, pinSalt)
  const [yo] = await insertar('usuarios?select=id', { id: estado.userId, nombre: VENDEDOR, rol: 'vendedor', activo: true, cuenta_id: estado.userId, pin_hash: pinHash, pin_salt: pinSalt }, 'Operador vendedor')
  const [otro] = await insertar('usuarios?select=id', { nombre: OTRO, rol: 'vendedor', activo: true, cuenta_id: estado.userId, pin_hash: pinHash, pin_salt: pinSalt }, 'Operador otro vendedor')
  estado.usuarioIds = [yo.id, otro.id]

  const clientes = await insertar('clientes?select=id,nombre', [
    { nombre: 'TEST MV FERRETERIA SOL', rif_cedula: 'J-11111111', telefono: '04140000001', saldo_pendiente: 0, activo: true, vendedor_id: yo.id, cuenta_id: estado.userId },
    { nombre: 'TEST MV CONSTRUCTORA LUNA', rif_cedula: 'J-22222222', telefono: '04140000002', saldo_pendiente: 0, activo: true, vendedor_id: yo.id, cuenta_id: estado.userId },
    { nombre: 'TEST MV CLIENTE AJENO', rif_cedula: 'J-33333333', telefono: '04140000003', saldo_pendiente: 0, activo: true, vendedor_id: otro.id, cuenta_id: estado.userId },
  ], 'Clientes de prueba')
  estado.clienteIds = clientes.map(c => c.id)
  const [sol, luna, ajeno] = clientes

  // Cada despacho nace de una cotización (staging lo exige); el despacho copia el número de la cotización.
  const ventas = [
    { n: 1, vendedor: yo.id, cliente: sol.id, fecha: dia(corte.from, 1), total: 120, estado: 'entregada', pago: 'Zelle' },        // en el corte
    { n: 2, vendedor: yo.id, cliente: luna.id, fecha: dia(corte.to, 0), total: 75.5, estado: 'despachada', pago: 'Efectivo $' },  // en el corte (último día)
    { n: 3, vendedor: yo.id, cliente: sol.id, fecha: dia(corte.to, 3), total: 999, estado: 'entregada', pago: 'Zelle' },          // fuera del corte
    { n: 4, vendedor: otro.id, cliente: ajeno.id, fecha: dia(corte.from, 2), total: 555, estado: 'entregada', pago: 'Zelle' },     // cliente de otro vendedor
    { n: 5, vendedor: yo.id, cliente: sol.id, fecha: dia(corte.from, 2), total: 444, estado: 'pendiente', pago: 'Zelle' },        // no aprobado
    { n: 6, vendedor: otro.id, cliente: sol.id, fecha: dia(corte.from, 3), total: 60, estado: 'entregada', pago: 'Zelle' },       // otro usuario le vendió a un cliente MÍO: sí cuenta
  ]
  const cotizaciones = await insertar('cotizaciones?select=id,numero', ventas.map(v => ({
    cuenta_id: estado.userId, cliente_id: v.cliente, vendedor_id: v.vendedor, estado: 'aceptada',
    subtotal_usd: v.total, total_usd: v.total, creado_en: `${v.fecha}T09:00:00-04:00`,
  })), 'Cotizaciones de prueba')
  estado.cotizacionIds = cotizaciones.map(c => c.id)
  const despachos = []
  for (const [i, v] of ventas.entries()) {
    const [d] = await insertar('notas_despacho?select=id,numero', {
      cotizacion_id: cotizaciones[i].id, cuenta_id: estado.userId, vendedor_id: v.vendedor, cliente_id: v.cliente, estado: v.estado,
      creado_en: `${v.fecha}T10:00:00-04:00`, total_usd: v.total, flete_usd: 0, descuento_total_usd: 0,
      forma_pago: JSON.stringify([{ metodo: v.pago, monto: v.total }]), creado_por: v.vendedor,
    }, `Despacho de prueba ${v.n}`)
    despachos.push(d)
    estado.despachoIds.push(d.id)
    estado.numeros[v.n] = d.numero
  }
  const id = n => despachos[n - 1].id

  const item = (despacho, orden, cod, nombre, und, cant, precio) => ({
    despacho_id: despacho, cuenta_id: estado.userId, codigo_snap: cod, nombre_snap: nombre, unidad_snap: und,
    cantidad: cant, cantidad_original: cant, precio_unit_usd: precio, precio_original: precio, descuento_pct: 0, total_linea_usd: cant * precio, orden,
  })
  await insertar('notas_despacho_items', [
    item(id(1), 1, 'TMV-CAB', 'TEST MV Cabilla 1/2', 'und', 10, 8),
    item(id(1), 2, 'TMV-ALA', 'TEST MV Alambre', 'kg', 8, 5),
    item(id(2), 1, 'TMV-CAB', 'TEST MV Cabilla 1/2', 'und', 5, 8),
    item(id(2), 2, 'TMV-CLA', 'TEST MV Clavos', 'kg', 7, 5.07),
    item(id(3), 1, 'TMV-FUERA', 'TEST MV Fuera de rango', 'und', 1, 999),
    item(id(6), 1, 'TMV-CAJA', 'TEST MV Venta hecha por otro usuario', 'und', 2, 30),
    item(id(4), 1, 'TMV-OTRO', 'TEST MV Venta de otro', 'und', 1, 555),
  ], 'Ítems de prueba')

  const comisiones = await insertar('comisiones?select=id', [
    { despachoid: id(1), cotizacionid: cotizaciones[0].id, vendedorid: yo.id, cuentaid: estado.userId, totalcomision: 3.6, estado: 'generada', calculo_version: '238b' },
    { despachoid: id(4), cotizacionid: cotizaciones[3].id, vendedorid: otro.id, cuentaid: estado.userId, totalcomision: 50, estado: 'generada', calculo_version: '238b' },
  ], 'Comisiones de prueba')
  estado.comisionIds = comisiones.map(c => c.id)
  console.log(`  · Fixtures listos (corte ${corte.from} → ${corte.to}): 2 vendedores, 2 clientes, 5 despachos`)
}

async function limpiar() {
  const del = p => adminFetch(p, { method: 'DELETE' }).catch(() => {})
  if (estado.comisionIds.length) await del(`/rest/v1/comisiones?id=in.(${estado.comisionIds.join(',')})`)
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
  // Comprobación: no queda nada de la cuenta E2E
  const resto = await (await adminFetch(`/rest/v1/notas_despacho?select=id&cuenta_id=eq.${estado.userId}`)).json().catch(() => [])
  console.log(`· Limpieza completada (despachos restantes de la cuenta E2E: ${Array.isArray(resto) ? resto.length : '?'})`)
}

async function verificarServidor() {
  const token = await assertOk(await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }), 'Login REST cuenta E2E')
  const sesion = await assertOk(await fetch(`${WORKER}/api/auth/switch-operator`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_id: estado.usuarioIds[0], pin: PIN }),
  }), 'Sesión de operador vendedor')
  const h = { Authorization: `Bearer ${token.access_token}`, 'X-Operator-Id': estado.usuarioIds[0], 'X-Operator-Session': sesion.operatorSession?.token || sesion.token }
  const q = `desde=${corte.from}&hasta=${corte.to}`
  const ok = await fetch(`${WORKER}/api/reportes/mis-ventas?${q}`, { headers: h })
  const body = await ok.json()
  assert(ok.status === 200, 'Servidor: el vendedor consulta su reporte (200)')
  assert(body.resumen.despachos === 3 && body.resumen.totalUsd === 255.5, 'Servidor: 3 despachos por $255.50 (los de sus clientes, aprobados y del corte, aunque otro usuario los haya hecho)')
  assert(body.resumen.comisionUsd === 3.6, 'Servidor: comisión $3.60 (no suma la del otro vendedor)')
  const ajeno = await fetch(`${WORKER}/api/reportes/mis-ventas?${q}&vendedorId=${estado.usuarioIds[1]}`, { headers: h })
  assert(ajeno.status === 400, 'Servidor: pedir ventas de otro vendedor se rechaza (400)')
  const sinSesion = await fetch(`${WORKER}/api/reportes/mis-ventas?${q}`)
  assert(sinSesion.status === 401, 'Servidor: sin sesión → 401')
}

async function verificarUI() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })
  // WhatsApp Web no se abre de verdad: se intercepta la pestaña.
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
    await page.getByText(new RegExp(VENDEDOR.replace(/ /g, '\\s+'), 'i')).first().click()
    await page.waitForSelector('text=Ingresa tu PIN', { timeout: 10000 })
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click()
    await page.waitForSelector('a[href="/mis-ventas"]', { timeout: 20000 })
    assert(true, 'Menú: aparece "Mis ventas" para el vendedor')

    await page.click('a[href="/mis-ventas"]')
    await page.waitForSelector('text=Detalle de ventas', { timeout: 30000 })
    await page.waitForTimeout(600)
    const texto = (await page.locator('body').innerText()).replace(/ /g, ' ')
    assert(tiene(texto, '255.50'), 'Pantalla: total vendido $255.50')
    assert(texto.includes('Detalle de ventas (3)'), 'Pantalla: 3 despachos (uno hecho por otro usuario a un cliente suyo) en el corte viernes–jueves')
    assert(texto.includes('TEST MV FERRETERIA SOL') && texto.includes('TEST MV CONSTRUCTORA LUNA'), 'Pantalla: aparecen los dos clientes')
    assert(tiene(texto, '3.60'), 'Pantalla: comisión $3.60')
    assert(texto.includes(`COT-${String(estado.numeros[1]).padStart(5, '0')}`), 'Pantalla: cada despacho muestra su número de cotización')
    assert(!tiene(texto, '555.00') && !tiene(texto, '999.00') && !tiene(texto, '444.00'), 'Pantalla: NO aparecen la venta del otro vendedor, la de fuera del corte ni la pendiente')
    assert(texto.includes('TEST MV Cabilla 1/2') && texto.includes('15'), 'Resumen por artículo: Cabilla 1/2 con 15 unidades')
    await page.screenshot({ path: path.join(SHOT_DIR, '01-mis-ventas.png'), fullPage: true })

    await page.getByText(`DES-${String(estado.numeros[1]).padStart(5, '0')}`).first().click()
    await page.waitForTimeout(300)
    const textoDetalle = (await page.locator('body').innerText()).replace(/ /g, ' ')
    assert(textoDetalle.includes('TMV-ALA') && tiene(textoDetalle, '40.00') && tiene(textoDetalle, '80.00'), 'Despacho abierto: artículos con código, precio y total por línea')
    await page.screenshot({ path: path.join(SHOT_DIR, '02-despacho-abierto.png'), fullPage: true })

    await page.fill('input[placeholder="Buscar cliente"]', 'luna')
    await page.waitForTimeout(200)
    assert((await page.locator('body').innerText()).includes('Detalle de ventas (1)'), 'Buscador de cliente filtra la lista')
    await page.fill('input[placeholder="Buscar cliente"]', '')

    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('button:has-text("Descargar PDF")')])
    const pdfPath = path.join(SHOT_DIR, descarga.suggestedFilename())
    await descarga.saveAs(pdfPath)
    const cabecera = fs.readFileSync(pdfPath).subarray(0, 4).toString()
    assert(cabecera === '%PDF' && fs.statSync(pdfPath).size > 5000, `PDF descargado: ${descarga.suggestedFilename()} (${Math.round(fs.statSync(pdfPath).size / 1024)} KB)`)

    const [descargaWa, popup] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      context.waitForEvent('page', { timeout: 30000 }),
      page.click('button:has-text("Enviar por WhatsApp")'),
    ])
    assert(descargaWa.suggestedFilename().endsWith('.pdf') && popup.url().startsWith('https://wa.me/'), 'WhatsApp (PC): descarga el PDF y abre wa.me con el mensaje')
    await popup.close()

    // Vista de teléfono (los vendedores la usan sobre todo en el celular)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const anchoPagina = await page.evaluate(() => document.documentElement.scrollWidth)
    assert(anchoPagina <= 400, `Teléfono: la página no se desborda a lo ancho (${anchoPagina}px)`)
    await page.screenshot({ path: path.join(SHOT_DIR, '03-telefono.png'), fullPage: true })

    if (errores.length) throw new Error(`Errores de consola: ${errores.join(' | ')}`)
    console.log(`\nOK — "Mis ventas" verificado en staging. Evidencia en ${path.relative(repoRoot, SHOT_DIR)}/`)
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
  console.log(`Smoke UI "Mis ventas" → staging (${STAGING_REF}) vía ${FRONTEND}`)
  await provisionar()
  await verificarServidor()
  await verificarUI()
} catch (error) {
  console.error(`\nFALLO: ${error.message}`)
  process.exitCode = 1
} finally {
  await limpiar()
}
