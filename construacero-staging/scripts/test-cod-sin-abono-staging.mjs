// ─── Arnés Fase 2 — conciliación COD sin abono (FIX-A/FIX-B) ────────────────
// Contra STAGING con fixtures aislados (cuenta del desarrollador virtual E2E).
// Casos:
//   T1  Guardarrail vivo: abono COD > saldo del cliente → 400 (pre-fix).
//   T2  editar-pago con codSinAbono=true: flag voltea, CxC sin filas nuevas,
//       auditoría COD_CONCILIADO_SIN_ABONO registrada, G-COD v4 dispara la
//       comisión (vendedor comisionable de la cuenta fixture).
//   T3  codSinAbono sobre COD ya pagado: idempotente (no duplica comisión).
//   T4  codSinAbono con despacho inexistente: rechazo limpio 404.
// Limpieza: borrado completo de fixtures al final (incluido en caso de fallo).

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const stagingRoot = path.resolve(here, '..')

function parseEnvFile(text = '') {
  const values = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    values[m[1]] = v
  }
  return values
}

const [envFile, devVars, e2eEnv] = await Promise.all([
  readFile(path.join(stagingRoot, '.env'), 'utf8').catch(() => ''),
  readFile(path.join(stagingRoot, '.dev.vars'), 'utf8').catch(() => ''),
  readFile(path.join(stagingRoot, '.env.e2e.local'), 'utf8').catch(() => ''),
])
const config = { ...parseEnvFile(envFile), ...parseEnvFile(devVars), ...parseEnvFile(e2eEnv), ...process.env }

const ref = (config.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1]
if (ref !== 'spupqgkdsgohxxfoxydl') { console.error(`FATAL: ref=${ref}, no es staging`); process.exit(1) }
const FRONT = 'http://localhost:5174'

const supabase = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

let passed = 0, failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} ${extra}`) }
}

async function api(pathname, method = 'GET', body = null) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session?.access_token) throw new Error('sin sesión')
  const headers = { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' }
  if (body !== null) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${FRONT}${pathname}`, { method, headers, body: body === null ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data, text }
}

// ── Auth E2E ─────────────────────────────────────────────────────────────────
const { data: login, error: loginErr } = await supabase.auth.signInWithPassword({
  email: (config.STAGING_E2E_EMAIL || '').trim().toLowerCase(),
  password: config.STAGING_E2E_PASSWORD || '',
})
if (loginErr) { console.error('FATAL login:', loginErr.message); process.exit(1) }
console.log(`sesión: ${login.user.email}`)

if (config.DEV_SUPER_CODE) {
  await api('/api/auth/super-admin', 'POST', { code: config.DEV_SUPER_CODE })
  await supabase.auth.refreshSession()
} else {
  await api('/api/auth/switch-operator', 'POST', { operator_id: config.STAGING_E2E_OPERATOR_ID, pin: config.STAGING_E2E_PIN })
}

const { data: me } = await supabase.auth.getUser()
const cuentaId = me.user?.id
const operadorId = me.user?.app_metadata?.operator_id
console.log(`cuenta: ${cuentaId?.slice(0, 8)} · operador: ${operadorId?.slice(0, 8)}`)
if (!cuentaId || operadorId !== '00000000-0000-0000-0000-000000000000') {
  console.error('FATAL: se esperaba el desarrollador virtual de staging'); process.exit(1)
}

// ── Fixtures (service key; solo filas aisladas de la cuenta fixture) ─────────
const svcHeaders = {
  apikey: config.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${config.SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}
const svcUrl = `${config.VITE_SUPABASE_URL}/rest/v1`

async function svcInsert(table, body) {
  const r = await fetch(`${svcUrl}/${table}`, { method: 'POST', headers: svcHeaders, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`insert ${table}: ${JSON.stringify(j).slice(0, 300)}`)
  return Array.isArray(j) ? j[0] : j
}
async function svcGet(table, query) {
  const r = await fetch(`${svcUrl}/${table}?${query}`, { headers: { apikey: svcHeaders.apikey, Authorization: svcHeaders.Authorization } })
  if (!r.ok) throw new Error(`get ${table}: ${await r.text().then(t => t.slice(0, 300))}`)
  return r.json()
}
async function svcDelete(table, query) {
  const r = await fetch(`${svcUrl}/${table}?${query}`, { method: 'DELETE', headers: { apikey: svcHeaders.apikey, Authorization: svcHeaders.Authorization } })
  if (!r.ok) throw new Error(`delete ${table}: ${await r.text().then(t => t.slice(0, 300))}`)
}

const ids = {}

console.log('\n── Setup fixtures ──')
// Usuario vendedor comisionable de la cuenta fixture (rol 'vendedor', NO externo)
const vend = await svcInsert('usuarios', {
  id: crypto.randomUUID(), cuenta_id: cuentaId, nombre: 'Vend CODFix E2E', rol: 'vendedor',
  activo: true, markup_pct: 0, comision_pct: 2, comision_pct_cabilla: 2,
})
ids.vendedor = vend.id
// Cliente dueño = vendedor (para que la RPC calcule para él)
const cli = await svcInsert('clientes', {
  id: crypto.randomUUID(), cuenta_id: cuentaId, vendedor_id: ids.vendedor,
  nombre: 'Cliente CODFix E2E', activo: true, telefono: '0412-9999999',
  saldo_pendiente: 0, saldo_a_favor: 0,
})
ids.cliente = cli.id
console.log(`vendedor ${ids.vendedor.slice(0, 8)} · cliente ${ids.cliente.slice(0, 8)}`)

// Cotización fixture (cotizacion_id es NOT NULL en notas_despacho de staging)
const cot = await svcInsert('cotizaciones', {
  cuenta_id: cuentaId, cliente_id: ids.cliente, vendedor_id: ids.vendedor,
  estado: 'aceptada', total_usd: 500,
})
ids.cotizacion = cot.id
// numero es NOT NULL sin default: se usa la secuencia vía cotizaciones (flujo real)
const numRow = await svcGet('cotizaciones', `id=eq.${ids.cotizacion}&select=numero`)

// Producto + ítem fixture: la RPC 238b calcula desde cotizacion_items
const prod = await svcInsert('productos', {
  cuenta_id: cuentaId, nombre: 'Prod CODFix E2E', codigo: 'E2E-CODFIX', unidad: 'und',
  precio_usd: 500, costo_usd: 250, stock_actual: 0, stock_minimo: 0, activo: true,
})
ids.producto = prod.id
await svcInsert('cotizacion_items', {
  cotizacion_id: ids.cotizacion, nombre_snap: 'Prod CODFix E2E',
  cantidad: 1, precio_unit_usd: 500, total_linea_usd: 500,
})

// Despacho entregado con COD de $500
const fps = JSON.stringify([{ metodo: 'Zelle', monto: 0 }, { metodo: 'Cobro a destino', monto: 500, diasVencimiento: 0, cobro_destino_pagado: false }])
const desp = await svcInsert('notas_despacho', {
  cuenta_id: cuentaId, numero: numRow[0].numero, cotizacion_id: ids.cotizacion,
  cliente_id: ids.cliente, cliente_factura_id: ids.cliente, vendedor_id: ids.vendedor,
  creado_por: ids.vendedor,
  estado: 'entregada', total_usd: 500, forma_pago: fps, forma_pago_cliente: fps,
  entregada_en: new Date().toISOString(), notas: 'E2E cod-sin-abono fixture',
})
ids.despacho = desp.id
console.log(`despacho ${ids.despacho.slice(0, 8)} (COD $500, flag=false)`)

// Cargo CxC del COD (como lo haría la aprobación real)
const cargo = await svcInsert('cuentas_por_cobrar', {
  cuenta_id: cuentaId, cliente_id: ids.cliente, despacho_id: ids.despacho,
  tipo: 'cargo', monto_usd: 500, saldo_usd: 500, metodo_pago: 'cod',
  descripcion: 'E2E CODFix cargo COD', registrado_por: ids.vendedor,
})
ids.cargo = cargo.id
await fetch(`${svcUrl}/clientes?id=eq.${ids.cliente}`, {
  method: 'PATCH', headers: { ...svcHeaders, Prefer: 'return=minimal' },
  body: JSON.stringify({ saldo_pendiente: 500 }),
})
console.log('cargo COD $500 creado, saldo cliente = 500')

try {
  // ── T1: guardarrail — abono mayor al saldo → 400 ────────────────────────────
  console.log('\nT1: guardarrail abono > saldo')
  const t1 = await api('/api/cxc/abono', 'POST', {
    clienteId: ids.cliente, monto: 600, formaPago: 'Efectivo $',
    descripcion: 'E2E T1 excede', despachoId: ids.despacho,
  })
  check('T1.1 abono $600 contra saldo $500 → 400', t1.status === 400, `status=${t1.status} body=${(t1.text || '').slice(0, 120)}`)
  check('T1.2 mensaje de guardarrail correcto', /supera el saldo pendiente/i.test(t1.text || ''), (t1.text || '').slice(0, 120))

  // ── T2: codSinAbono → flag + auditoría + comisión ───────────────────────────
  console.log('\nT2: codSinAbono happy path')
  const fpsPagado = JSON.stringify([{ metodo: 'Zelle', monto: 0 }, { metodo: 'Cobro a destino', monto: 500, diasVencimiento: 0, cobro_destino_pagado: true, conciliado_sin_abono: true, metodos_pagados: [{ metodo: 'Efectivo $', monto: 500 }] }])
  const t2 = await api('/api/despachos/editar-pago', 'POST', {
    despachoId: ids.despacho, formaPago: fpsPagado, formaPagoCliente: fpsPagado, codSinAbono: true,
  })
  check('T2.1 editar-pago 200', t2.status === 200, `status=${t2.status} body=${(t2.text || '').slice(0, 150)}`)

  const [desp2] = await svcGet('notas_despacho', `id=eq.${ids.despacho}&select=forma_pago`)
  const fpsNow = typeof desp2.forma_pago === 'string' ? JSON.parse(desp2.forma_pago) : desp2.forma_pago
  const codNow = fpsNow.find(f => f.metodo === 'Cobro a destino')
  check('T2.2 flag cobro_destino_pagado=true', codNow?.cobro_destino_pagado === true, JSON.stringify(codNow)?.slice(0, 150))
  const cxcRows = await svcGet('cuentas_por_cobrar', `despacho_id=eq.${ids.despacho}&select=id,tipo`)
  check('T2.3 CxC: solo el cargo (sin abonos nuevos)', (cxcRows || []).length === 1 && cxcRows[0].tipo === 'cargo', JSON.stringify(cxcRows)?.slice(0, 150))

  const aud = await svcGet('auditoria', `entidad_id=eq.${ids.despacho}&accion=eq.COD_CONCILIADO_SIN_ABONO&select=id,descripcion&order=ts.desc&limit=1`)
  check('T2.4 auditoría COD_CONCILIADO_SIN_ABONO', (aud || []).length === 1, JSON.stringify(aud)?.slice(0, 150))

  // G-COD v4 debió disparar la comisión (vendedor comisionable, COD recién pagado)
  const coms = await svcGet('comisiones', `despachoid=eq.${ids.despacho}&select=id,totalcomision,estado,vendedorid`)
  check('T2.5 comisión creada por G-COD v4', (coms || []).length === 1, JSON.stringify(coms)?.slice(0, 200))
  if ((coms || []).length === 1) {
    check('T2.6 comisión ~2% de $500 = $10.00', Math.abs(Number(coms[0].totalcomision) - 10) < 0.05, `total=${coms[0].totalcomision}`)
    check('T2.7 comisión del vendedor fixture', coms[0].vendedorid === ids.vendedor)
  }

  // ── T3: idempotencia — codSinAbono sobre flag ya true ───────────────────────
  console.log('\nT3: idempotencia (COD ya pagado)')
  const t3 = await api('/api/despachos/editar-pago', 'POST', {
    despachoId: ids.despacho, formaPago: fpsPagado, formaPagoCliente: fpsPagado, codSinAbono: true,
  })
  check('T3.1 segunda pasada 200', t3.status === 200, `status=${t3.status}`)
  const coms3 = await svcGet('comisiones', `despachoid=eq.${ids.despacho}&select=id`)
  check('T3.2 no duplica comisión', (coms3 || []).length === 1, `count=${(coms3 || []).length}`)

  // ── T4: codSinAbono con despacho inexistente → rechazo limpio ────────────────
  console.log('\nT4: despacho inexistente')
  const t4 = await api('/api/despachos/editar-pago', 'POST', {
    despachoId: crypto.randomUUID(), formaPago: fpsPagado, formaPagoCliente: fpsPagado, codSinAbono: true,
  })
  check('T4.1 despacho inexistente → 404', t4.status === 404, `status=${t4.status}`)
} finally {
  console.log('\n── Limpieza ──')
  try {
    if (ids.despacho) {
      await svcDelete('auditoria', `entidad_id=eq.${ids.despacho}&accion=eq.COD_CONCILIADO_SIN_ABONO`)
      await svcDelete('comisiones', `despachoid=eq.${ids.despacho}`)
      await svcDelete('cuentas_por_cobrar', `despacho_id=eq.${ids.despacho}`)
      await svcDelete('notas_despacho', `id=eq.${ids.despacho}`)
    }
    if (ids.cotizacion) { await svcDelete('cotizacion_items', `cotizacion_id=eq.${ids.cotizacion}`); await svcDelete('cotizaciones', `id=eq.${ids.cotizacion}`) }
    if (ids.cliente) await svcDelete('clientes', `id=eq.${ids.cliente}`)
    if (ids.producto) await svcDelete('productos', `id=eq.${ids.producto}`)
if (ids.vendedor) await svcDelete('usuarios', `id=eq.${ids.vendedor}`)
    console.log('fixtures eliminados')
  } catch (e) {
    console.error('LIMPIEZA INCOMPLETA — revisar manualmente:', e.message)
    process.exitCode = 1
  }
}

console.log(`\n═══ RESULTADO: ${passed} ✓ · ${failed} ✗ ═══`)
process.exit(failed > 0 ? 1 : 0)
