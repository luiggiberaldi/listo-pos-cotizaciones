#!/usr/bin/env node
/**
 * Smoke semántico del Release 17 en PRODUCCIÓN (plan §4, paso 6).
 *
 * Qué verifica (con un producto de prueba, en un tenant E2E aislado y temporal):
 *   S0  producto creado con stock 100; despacho 'pendiente' sin lote de egreso
 *   A1  aprobar (pendiente→despachada) por la API real del Worker
 *   A2  stock 100→97, kardex 'egreso' con lote, "Despacho #N aprobado"
 *   E1  marcar entregada (despachada→entregada)
 *   E2  el stock NO se toca (sigue en 97) y el kardex NO crece
 *   R1  revertir/reabrir (entregada→pendiente) con motivo
 *   R2  stock vuelve EXACTO a 100, kardex 'ingreso', lote limpiado,
 *       y el motivo de la reversión queda GUARDADO en la nota
 *   CU  el kardex del producto cuadra: ingresos − egresos = stock_actual
 *
 * Seguridad:
 *  - Guardia de entorno: solo corre contra el proyecto de PRODUCCIÓN
 *    (ref `oyfyuszgjwcepjpngclv`) y exige confirmación explícita por variable.
 *  - Crea SU PROPIA cuenta E2E temporal (tenant aislado) con todos sus
 *    fixtures; TODO se elimina al final, haya fallado o no.
 *  - Nunca toca datos reales del negocio (otros tenants son invisibles e
 *    inaccesibles para esta cuenta).
 *  - Los secretos viven en `.env` / `.env.secrets`; este script los lee pero
 *    nunca los imprime.
 *
 * Uso:
 *   PRODUCCION_SMOKE_R17_CONFIRM=SMOKE_R17_PRODUCCION node scripts/smoke-release17-produccion.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { hashPinPBKDF2, generateSalt } from '../api/lib/crypto.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROD_REF = 'oyfyuszgjwcepjpngclv'
const WORKER = (process.env.SMOKE_R17_WORKER || 'https://listo-pos-cotizaciones.luigistorelogistics.workers.dev').replace(/\/$/, '')

const MOTIVO_REVERSION = 'SMOKE R17 — cliente ausente (prueba automatizada de ventana)'
const PIN = '424242'
const STOCK_INICIAL = 100
const CANTIDAD = 3
const PRECIO = 10

function parseEnv(file) {
  const values = {}
  if (!fs.existsSync(file)) return values
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

const config = { ...parseEnv(path.join(ROOT, '.env')), ...parseEnv(path.join(ROOT, '.env.secrets')) }
const supabaseUrl = (config.SUPABASE_URL || config.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = config.SUPABASE_ANON_KEY || config.VITE_SUPABASE_ANON_KEY
const serviceKey = config.SUPABASE_SERVICE_KEY

// ─── Guardias ────────────────────────────────────────────────────────────────
if (process.env.PRODUCCION_SMOKE_R17_CONFIRM !== 'SMOKE_R17_PRODUCCION') {
  console.error('Guardia: este smoke escribe fixtures temporales en PRODUCCIÓN.')
  console.error('Ejecuta con:  PRODUCCION_SMOKE_R17_CONFIRM=SMOKE_R17_PRODUCCION node scripts/smoke-release17-produccion.mjs')
  process.exit(2)
}
if (!supabaseUrl.includes(PROD_REF)) {
  console.error(`Guardia de entorno: se esperaba la URL de PRODUCCIÓN (${PROD_REF}). Obtenida: ${supabaseUrl || '(vacía)'}`)
  process.exit(2)
}
if (!serviceKey) { console.error('Falta SUPABASE_SERVICE_KEY en .env / .env.secrets'); process.exit(2) }
if (!anonKey) { console.error('Falta (VITE_)SUPABASE_ANON_KEY en .env'); process.exit(2) }

// ─── Helpers de API ──────────────────────────────────────────────────────────
const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function adminFetch(pathname, options = {}) {
  return fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: { ...adminHeaders, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  })
}

async function detalleError(response) {
  const body = await response.text()
  try {
    const parsed = JSON.parse(body)
    return `${parsed.message || parsed.error || ''} ${parsed.details || ''} ${parsed.hint || ''}`.trim() || body
  } catch { return body }
}

async function assertOk(response, label) {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} — ${(await detalleError(response)).slice(0, 700)}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

function assert(condicion, mensaje) {
  if (!condicion) throw new Error(`FALLO: ${mensaje}`)
  console.log(`  ✓ ${mensaje}`)
}

// Llamadas a la API del Worker con la sesión del operador (el camino real de la app).
async function api(pathname, { method = 'POST', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${estado.jwt}`,
    'Content-Type': 'application/json',
  }
  if (estado.session) {
    headers['X-Operator-Id'] = estado.userId
    headers['X-Operator-Session'] = estado.session
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const res = await fetch(`${WORKER}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* texto plano */ }
  return { status: res.status, ok: res.ok, json, text }
}

async function leerTabla(tabla, filtro) {
  const res = await adminFetch(`/rest/v1/${tabla}?${filtro}`)
  return assertOk(res, `Leer ${tabla}`)
}

const EMAIL = `test-smoke-r17-${Date.now()}@construacero.test`
const PASSWORD = `SmokeR17-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 10000}`
const OPERADOR_NOMBRE = 'TEST SMOKE R17 JEFE'
const PRODUCTO_NOMBRE = 'TEST SMOKE R17 BUFFY'
const CLIENTE_NOMBRE = 'TEST SMOKE R17'
const REFERENCIA = `SMOKE-R17-${Date.now()}`

const estado = {
  userId: null, configId: null, usuarioId: null, clienteId: null,
  cotizacionId: null, productoId: null, despachoId: null, numero: null,
  jwt: null, session: null,
}

// ─── Provisionamiento (tenant E2E temporal) ──────────────────────────────────
async function provisionar() {
  console.log('· Provisionando tenant E2E temporal…')

  const user = await assertOk(await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  }), 'Crear cuenta E2E temporal')
  estado.userId = user.id

  estado.configId = 880000 + Math.floor(Math.random() * 90000)
  await assertOk(await adminFetch('/rest/v1/configuracion_negocio?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: estado.configId, cuenta_id: estado.userId, nombre_negocio: 'TEST SMOKE R17' }),
  }), 'Crear configuración de la cuenta E2E')

  const pinSalt = generateSalt()
  const pinHash = await hashPinPBKDF2(PIN, pinSalt)
  const [usuario] = await assertOk(await adminFetch('/rest/v1/usuarios?select=id', {
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
  }), 'Crear operador de prueba (jefe + PIN)')
  estado.usuarioId = usuario.id

  const [cliente] = await assertOk(await adminFetch('/rest/v1/clientes?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      nombre: CLIENTE_NOMBRE,
      rif_cedula: 'V-99999999',
      telefono: '0412000000',
      saldo_pendiente: 0,
      activo: true,
      vendedor_id: estado.userId,
      cuenta_id: estado.userId,
    }),
  }), 'Crear cliente de prueba')
  estado.clienteId = cliente.id

  // Login real + sesión de operador por PIN (el mismo camino de cualquier operador).
  const tokenResp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(30000),
  })
  const token = await assertOk(tokenResp, 'Login REST como cuenta E2E')
  estado.jwt = token.access_token

  const sesion = await api('/api/auth/switch-operator', { body: { operator_id: estado.userId, pin: PIN } })
  if (!sesion.ok) throw new Error(`Abrir sesión de operador: HTTP ${sesion.status} — ${(sesion.text || '').slice(0, 300)}`)
  estado.session = sesion.json?.operatorSession?.token || sesion.json?.token
  if (!estado.session) throw new Error('La sesión de operador no devolvió token')

  // Producto de prueba con stock conocido (pasa por la RPC real de creación).
  const prod = await api('/api/productos/crear', {
    body: {
      codigo: `TEST-${REFERENCIA}`,
      nombre: PRODUCTO_NOMBRE,
      unidad: 'und',
      precio_usd: PRECIO,
      stock_actual: STOCK_INICIAL,
      stock_minimo: 0,
    },
    idempotencyKey: randomUUID(),
  })
  if (!prod.ok) throw new Error(`Crear producto: HTTP ${prod.status} — ${(prod.text || '').slice(0, 300)}`)
  estado.productoId = prod.json?.id || prod.json?.producto_id || prod.json?.p_producto_id
  if (!estado.productoId) {
    const filas = await leerTabla('productos', `cuenta_id=eq.${estado.userId}&nombre=eq.${encodeURIComponent(PRODUCTO_NOMBRE)}&select=id`)
    estado.productoId = filas[0]?.id
  }
  if (!estado.productoId) throw new Error('No se pudo determinar el id del producto creado')

  // Cotización de prueba (la nota de despacho siempre nace de una cotización).
  const [cotizacion] = await assertOk(await adminFetch('/rest/v1/cotizaciones?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      cuenta_id: estado.userId,
      cliente_id: estado.clienteId,
      vendedor_id: estado.userId,
      estado: 'aceptada',
      subtotal_usd: CANTIDAD * PRECIO,
      total_usd: CANTIDAD * PRECIO,
      notas_cliente: `SMOKE R17 ${REFERENCIA} — fixture de prueba automatizada`,
    }),
  }), 'Crear cotización de prueba')
  estado.cotizacionId = cotizacion.id

  // Despacho de prueba (fixture directo, como el smoke COD 14) + 1 ítem de inventario.
  const [despacho] = await assertOk(await adminFetch('/rest/v1/notas_despacho?select=id,numero', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      cuenta_id: estado.userId,
      cotizacion_id: estado.cotizacionId,
      cliente_id: estado.clienteId,
      vendedor_id: estado.userId,
      estado: 'pendiente',
      total_usd: CANTIDAD * PRECIO,
      flete_usd: 0,
      corte_usd: 0,
      notas: `SMOKE R17 ${REFERENCIA} — fixture de prueba automatizada`,
      creado_por: estado.userId,
    }),
  }), 'Crear despacho de prueba')
  estado.despachoId = despacho.id
  estado.numero = despacho.numero

  await assertOk(await adminFetch('/rest/v1/notas_despacho_items?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      despacho_id: estado.despachoId,
      producto_id: estado.productoId,
      codigo_snap: `TEST-${REFERENCIA}`,
      nombre_snap: PRODUCTO_NOMBRE,
      unidad_snap: 'und',
      cantidad_original: CANTIDAD,
      precio_original: PRECIO,
      cantidad: CANTIDAD,
      precio_unit_usd: PRECIO,
      descuento_pct: 0,
      total_linea_usd: CANTIDAD * PRECIO,
      orden: 1,
      origen: 'inventario',
      es_prestamo: false,
      cuenta_id: estado.userId,
    }),
  }), 'Crear ítem del despacho')

  console.log(`  · Fixtures listos: 1 operador + 1 cliente + 1 producto (${STOCK_INICIAL} und) + despacho #${estado.numero}`)
}

// ─── Verificación del ciclo semántico ────────────────────────────────────────
async function leerDespacho() {
  const filas = await leerTabla('notas_despacho', `id=eq.${estado.despachoId}&select=estado,egreso_lote_id,alerta_stock,alerta_stock_items,motivo_devolucion,despachada_en,entregada_en`)
  return filas[0]
}
async function leerStock() {
  const filas = await leerTabla('productos', `id=eq.${estado.productoId}&select=stock_actual`)
  return Number(filas[0]?.stock_actual)
}
async function leerKardex() {
  return leerTabla('inventario_movimientos', `producto_id=eq.${estado.productoId}&select=id,lote_id,tipo,motivo,cantidad,stock_anterior,stock_nuevo,usuario_nombre&order=creado_en.asc`)
}

async function smoke() {
  // ── S0 ──
  console.log('\n— S0: estado inicial —')
  assert(await leerStock() === STOCK_INICIAL, `Stock inicial = ${STOCK_INICIAL}`)
  const d0 = await leerDespacho()
  assert(d0.estado === 'pendiente', 'Despacho inicial en estado "pendiente"')
  assert(!d0.egreso_lote_id, 'Despacho inicial sin lote de egreso')

  // ── A1: aprobar (pendiente→despachada) — egreso al aprobar ──
  console.log('\n— A1/A2: aprobar → egreso de inventario —')
  const aprobar = await api('/api/despachos/estado', {
    body: { despachoId: estado.despachoId, nuevoEstado: 'despachada' },
    idempotencyKey: randomUUID(),
  })
  assert(aprobar.ok, `API /api/despachos/estado (aprobar) respondió ${aprobar.status}`)
  if (!aprobar.ok) throw new Error(`Detalle: ${(aprobar.text || '').slice(0, 400)}`)

  const d1 = await leerDespacho()
  assert(d1.estado === 'despachada', 'Estado ahora "despachada"')
  assert(!!d1.egreso_lote_id, 'Lote de egreso asignado al aprobar')
  assert(d1.alerta_stock === false, 'Sin alerta de stock (había stock suficiente)')
  assert(await leerStock() === STOCK_INICIAL - CANTIDAD, `Stock descontado: ${STOCK_INICIAL} → ${STOCK_INICIAL - CANTIDAD}`)

  const k1 = await leerKardex()
  const egresos = k1.filter(m => m.tipo === 'egreso')
  assert(egresos.length === 1, 'Kardex: exactamente 1 movimiento de egreso')
  assert(egresos[0].lote_id === d1.egreso_lote_id, 'El egreso queda ligado al lote del despacho')
  assert(Number(egresos[0].cantidad) === CANTIDAD, `Egreso por ${CANTIDAD} unidades`)
  assert(String(egresos[0].motivo).includes(`Despacho #${estado.numero}`) && String(egresos[0].motivo).includes('aprobado'),
    `Motivo del egreso: "${egresos[0].motivo}"`)
  assert(Number(egresos[0].stock_anterior) === STOCK_INICIAL && Number(egresos[0].stock_nuevo) === STOCK_INICIAL - CANTIDAD,
    'Kardex del egreso cuadra 100→97')
  assert(egresos[0].usuario_nombre === OPERADOR_NOMBRE, 'Kardex firmado con el operador real')

  // ── E1: entregar (despachada→entregada) — la entrega NO toca inventario ──
  console.log('\n— E1/E2: entregar → inventario intacto (semántica nueva) —')
  const entregar = await api('/api/despachos/estado', {
    body: { despachoId: estado.despachoId, nuevoEstado: 'entregada' },
    idempotencyKey: randomUUID(),
  })
  assert(entregar.ok, `API /api/despachos/estado (entregar) respondió ${entregar.status}`)
  if (!entregar.ok) throw new Error(`Detalle: ${(entregar.text || '').slice(0, 400)}`)

  const d2 = await leerDespacho()
  assert(d2.estado === 'entregada', 'Estado ahora "entregada"')
  assert(await leerStock() === STOCK_INICIAL - CANTIDAD, `Stock INTACTO al entregar: sigue en ${STOCK_INICIAL - CANTIDAD}`)
  assert((await leerKardex()).length === k1.length, 'Kardex sin movimientos nuevos al entregar')

  // ── R1: revertir / reabrir (entregada→pendiente) con motivo ──
  console.log('\n— R1/R2: revertir con motivo → reingreso exacto —')
  const revertir = await api('/api/despachos/estado', {
    body: { despachoId: estado.despachoId, nuevoEstado: 'pendiente', motivo_devolucion: MOTIVO_REVERSION },
    idempotencyKey: randomUUID(),
  })
  assert(revertir.ok, `API /api/despachos/estado (revertir con motivo) respondió ${revertir.status}`)
  if (!revertir.ok) throw new Error(`Detalle: ${(revertir.text || '').slice(0, 400)}`)

  const d3 = await leerDespacho()
  assert(d3.estado === 'pendiente', 'Estado de vuelta a "pendiente"')
  assert(d3.motivo_devolucion === MOTIVO_REVERSION, 'El motivo de la reversión queda GUARDADO en la nota')
  assert(!d3.egreso_lote_id, 'Lote de egreso limpiado al revertir')
  assert(await leerStock() === STOCK_INICIAL, `Inventario vuelve EXACTO: ${STOCK_INICIAL - CANTIDAD} → ${STOCK_INICIAL}`)

  const k3 = await leerKardex()
  const ingresos = k3.filter(m => m.tipo === 'ingreso')
  const reingreso = ingresos.find(m => Number(m.cantidad) === CANTIDAD && Number(m.stock_nuevo) === STOCK_INICIAL)
  assert(!!reingreso, 'Kardex: movimiento de ingreso (reingreso) por las 3 unidades')
  assert(reingreso && Number(reingreso.stock_anterior) === STOCK_INICIAL - CANTIDAD, 'Reingreso cuadra 97→100')
  assert(k3.some(m => m.tipo === 'egreso'), 'El kardex de egreso se conserva (la historia nunca se borra)')

  // ── CUADRE ──
  console.log('\n— CUADRE: kardex contra stock —')
  const totalIngresos = k3.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.cantidad), 0)
  const totalEgresos = k3.filter(m => m.tipo === 'egreso').reduce((a, m) => a + Number(m.cantidad), 0)
  const stockFinal = await leerStock()
  assert(totalIngresos - totalEgresos === stockFinal,
    `Kardex cuadra: ${totalIngresos} ingresos − ${totalEgresos} egresos = stock ${stockFinal}`)
}

// ─── Limpieza total (siempre, haya fallado o no) ─────────────────────────────
async function limpiar() {
  console.log('\n· Limpiando fixtures del tenant E2E…')
  const borrados = []
  const borrar = async (tabla, filtro, etiqueta) => {
    try {
      const res = await adminFetch(`/rest/v1/${tabla}?${filtro}`, { method: 'DELETE' })
      if (res.ok) borrados.push(etiqueta || tabla)
      else console.log(`  · (aviso) no se pudo borrar ${tabla}: HTTP ${res.status}`)
    } catch (error) { console.log(`  · (aviso) ${tabla}: ${error.message}`) }
  }
  if (estado.productoId) await borrar('inventario_movimientos', `cuenta_id=eq.${estado.userId}`, 'inventario_movimientos')
  if (estado.despachoId) {
    await borrar('notas_despacho_items', `despacho_id=eq.${estado.despachoId}`, 'notas_despacho_items')
    await borrar('notas_despacho', `id=eq.${estado.despachoId}`, 'notas_despacho')
  }
  if (estado.cotizacionId) await borrar('cotizaciones', `id=eq.${estado.cotizacionId}`, 'cotizaciones')
  await borrar('productos', `cuenta_id=eq.${estado.userId}`, 'productos')
  if (estado.clienteId) {
    await borrar('cliente_prestamos', `cliente_id=eq.${estado.clienteId}`, 'cliente_prestamos')
    await borrar('clientes', `id=eq.${estado.clienteId}`, 'clientes')
  }
  await borrar('auditoria', `cuenta_id=eq.${estado.userId}`, 'auditoria')
  if (estado.usuarioId) await borrar('usuarios', `id=eq.${estado.usuarioId}`, 'usuarios')
  if (estado.configId) await borrar('configuracion_negocio', `id=eq.${estado.configId}`, 'configuracion_negocio')
  if (estado.userId) {
    try {
      const res = await adminFetch(`/auth/v1/admin/users/${estado.userId}`, { method: 'DELETE' })
      if (res.ok) borrados.push('cuenta E2E')
    } catch (error) { console.log(`  · (aviso) cuenta E2E: ${error.message}`) }
  }
  console.log(`  · Limpieza completada (${borrados.join(', ')})`)
}

// ─── Main ────────────────────────────────────────────────────────────────────
let fallo = null
const inicio = Date.now()
try {
  console.log(`SMOKE R17 — PRODUCCIÓN (${PROD_REF}) vía ${WORKER}`)
  await provisionar()
  await smoke()
} catch (error) {
  fallo = error
} finally {
  await limpiar()
}

if (fallo) {
  console.error(`\nFALLO tras ${((Date.now() - inicio) / 1000).toFixed(1)}s: ${fallo.message}`)
  process.exit(1)
}
console.log(`\nOK — smoke semántico del Release 17 en producción superado en ${((Date.now() - inicio) / 1000).toFixed(1)}s.`)
