#!/usr/bin/env node
/**
 * Smoke del reporte Crédito/CxC con los datos REALES del negocio (plan §4, paso 7).
 *
 * Solo LECTURA: trae el libro de cuentas por cobrar y los clientes del tenant
 * real y los pasa por el MISMO motor de cálculo que usa la pantalla
 * (`src/utils/cxcPeriodReport.js` → `construirReportePeriodoCxC`, el módulo con
 * 22+ pruebas). Comprueba que los KPIs del período cuadran:
 *   - Cuadre de movimientos: saldo inicial + cargos − abonos = neto al cierre
 *   - "Saldo actual coincide": el neto al cierre contrasta con saldo_pendiente
 *   - La pestaña Movimientos tiene filas del período
 *
 * No escribe nada en la base. La verificación visual en la app (interfaz + PDFs)
 * se hace aparte, con sesión del negocio abierta.
 *
 * Uso:  node scripts/smoke-cxc-reporte-produccion.mjs [desde] [hasta]
 *       (por defecto: mes en curso 2026-10-01 → hoy)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { construirReportePeriodoCxC } from '../src/utils/cxcPeriodReport.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROD_REF = 'oyfyuszgjwcepjpngclv'
const TENANT = '74dd6821-963d-406e-8621-47352e0df27e' // cuenta real del negocio

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
const serviceKey = config.SUPABASE_SERVICE_KEY

if (!supabaseUrl.includes(PROD_REF)) {
  console.error(`Guardia de entorno: se esperaba la URL de PRODUCCIÓN (${PROD_REF}). Obtenida: ${supabaseUrl || '(vacía)'}`)
  process.exit(2)
}
if (!serviceKey) { console.error('Falta SUPABASE_SERVICE_KEY en .env / .env.secrets'); process.exit(2) }

// Fecha de hoy en Caracas (la pantalla usa el huso de Caracas para los rangos).
const hoyCaracas = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date())
const DESDE = process.argv[2] || '2026-10-01'
const HASTA = process.argv[3] || hoyCaracas

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function rest(pathname) {
  const res = await fetch(`${supabaseUrl}${pathname}`, { headers, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

const SELECT_CLIENTE = 'id, nombre, rif_cedula, telefono, saldo_pendiente, vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)'
const SELECT_MOVIMIENTO = 'id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd, fecha_vencimiento, creado_en, metodo_pago, forma_pago_abono, descripcion, referencia, cliente:clientes(nombre), despacho:notas_despacho(numero, cotizacion:cotizaciones(numero))'

const usd = n => `$${Number(n || 0).toFixed(2)}`

console.log(`SMOKE reporte Crédito/CxC — PRODUCCIÓN (${PROD_REF}) — solo lectura`)
console.log(`Rango: ${DESDE} → ${HASTA} (mes en curso)\n`)

// 1) Mismo origen de datos que useReportePeriodoCxC: clientes con deuda +
//    clientes con movimiento en el rango, con TODO su historial de movimientos.
const clientesConDeuda = await rest(
  `/rest/v1/clientes?cuenta_id=eq.${TENANT}&saldo_pendiente=gt.0&activo=eq.true&select=${encodeURIComponent(SELECT_CLIENTE)}&order=saldo_pendiente.desc`
)
const movsEnRango = await rest(
  `/rest/v1/cuentas_por_cobrar?cuenta_id=eq.${TENANT}&tipo=in.(cargo,abono)&creado_en=gte.${DESDE}T00:00:00-04:00&creado_en=lte.${HASTA}T23:59:59-04:00&select=cliente_id`
)
const idsDeuda = clientesConDeuda.map(c => c.id)
const idsExtra = [...new Set(movsEnRango.map(m => m.cliente_id))].filter(id => !idsDeuda.includes(id))

const clientesExtra = []
for (let i = 0; i < idsExtra.length; i += 50) {
  const batch = idsExtra.slice(i, i + 50)
  clientesExtra.push(...await rest(`/rest/v1/clientes?cuenta_id=eq.${TENANT}&id=in.(${batch.join(',')})&select=${encodeURIComponent(SELECT_CLIENTE)}`))
}

const todosIds = [...idsDeuda, ...clientesExtra.map(c => c.id)]
const transacciones = []
for (let i = 0; i < todosIds.length; i += 50) {
  const batch = todosIds.slice(i, i + 50)
  transacciones.push(...await rest(
    `/rest/v1/cuentas_por_cobrar?cuenta_id=eq.${TENANT}&tipo=in.(cargo,abono)&cliente_id=in.(${batch.join(',')})&select=${encodeURIComponent(SELECT_MOVIMIENTO)}&order=creado_en.asc`
  ))
}
console.log(`· Datos cargados: ${todosIds.length} clientes con actividad, ${transacciones.length} movimientos en su historial\n`)

// 2) El mismo cálculo que usa la pantalla.
const reporte = construirReportePeriodoCxC({ clientes: [...clientesConDeuda, ...clientesExtra], transacciones, rango: { from: DESDE, to: HASTA } })
const k = reporte.kpis

console.log('— KPIs del período (lo que muestra la pantalla) —')
console.log(`  Saldo inicial (deuda): ${usd(k.saldoInicial)}   Neto: ${usd(k.saldoInicialNeto)}`)
console.log(`  Cargos del período:    ${usd(k.totalCargos)}   (${reporte.movimientosDelPeriodo.filter(m => m.tipo === 'cargo').length} cargos)`)
console.log(`  Abonos aplicados:      ${usd(k.totalAbonos)}   (${reporte.movimientosDelPeriodo.filter(m => m.tipo === 'abono').length} abonos)`)
console.log(`  Neto al cierre:        ${usd(k.saldoFinalNeto)}`)
console.log(`  Deuda actual (saldo):  ${usd(k.totalDeuda)}   (${k.numClientesConDeuda} cliente(s) con deuda)`)

console.log('\n— Comprobaciones —')
let fallos = 0
const check = (ok, mensaje) => {
  console.log(`  ${ok ? '✓' : '✗'} ${mensaje}`)
  if (!ok) fallos++
}

const cuadreEsperado = Math.round((k.saldoInicialNeto + k.totalCargos - k.totalAbonos) * 100) / 100
check(cuadreEsperado === k.saldoFinalNeto,
  `Cuadre de movimientos: ${usd(k.saldoInicialNeto)} + ${usd(k.totalCargos)} − ${usd(k.totalAbonos)} = ${usd(k.saldoFinalNeto)}`)
check(k.diferenciaCuadreMovimientos === 0,
  `Diferencia del cuadre matemático = ${usd(k.diferenciaCuadreMovimientos)}`)
check(k.saldoActualComparado === true, 'El corte se contrasta contra el saldo actual del cliente')
if (k.saldoActualComparado) {
  check(k.diferenciaSaldoActual === 0,
    `Saldo actual ${k.diferenciaSaldoActual === 0 ? 'COINCIDE' : `difiere en ${usd(k.diferenciaSaldoActual)} (${k.clientesConDiferenciaSaldoActual} cliente(s))`}`)
}
check(reporte.movimientosDelPeriodo.length > 0,
  `Pestaña Movimientos con filas del período (${reporte.movimientosDelPeriodo.length})`)
check(reporte.clientesDelPeriodo.length > 0,
  `Pestaña Clientes con filas (${reporte.clientesDelPeriodo.length})`)

// Cruce independiente: sumas crudas del ledger contra los KPIs del módulo.
const crudoCargos = transacciones.filter(m => m.tipo === 'cargo'
  && m.creado_en >= `${DESDE}T00:00:00-04:00` && m.creado_en <= `${HASTA}T23:59:59-04:00`)
  .reduce((a, m) => a + Number(m.monto_usd || 0), 0)
const crudoAbonos = transacciones.filter(m => m.tipo === 'abono'
  && m.creado_en >= `${DESDE}T00:00:00-04:00` && m.creado_en <= `${HASTA}T23:59:59-04:00`)
  .reduce((a, m) => a + Number(m.monto_usd || 0), 0)
console.log(`\n· Cruce con el ledger crudo del rango: cargos ${usd(crudoCargos)} · abonos ${usd(crudoAbonos)}`)

console.log('\n— Movimientos del período (pestaña Movimientos) —')
for (const m of reporte.movimientosDelPeriodo.slice(0, 25)) {
  const signo = m.tipo === 'cargo' ? '+' : '−'
  console.log(`  ${String(m.creado_en).slice(0, 10)}  ${m.tipo.padEnd(6)} ${signo}${usd(m.monto_usd)}  ${m.cliente?.nombre || m.cliente_id}`)
}

if (fallos) {
  console.error(`\nFALLO: ${fallos} comprobación(es) en rojo`)
  process.exit(1)
}
console.log('\nOK — los KPIs del reporte Crédito/CxC cuadran con los datos reales del negocio.')
