#!/usr/bin/env node
// scripts/smoke-cod-prod-14.mjs
// Smoke end-to-end (Tarea 5, §10.4 del plan 2026-10-18) de la conciliación COD
// en producción vía PostgREST — la misma capa que invoca el Worker.
//
// Sujeto: fixture SMOKE-14COD en el tenant E2E (983a7922-…), NO los casos
// históricos de §14. Secuencia:
//   S0  resumen_financiero_despacho → estado 'pendiente', deuda COD 300
//   P1  pago parcial Zelle 100 (clave A) → 'parcial', sin comisión
//   P2  estado: 1 abono, 0 comisiones, resumen 'parcial'/200
//   F1  pago final (Efectivo Bs 4800 @ tasa 40 + Efectivo $ 80, clave B) → 'cobrado'
//   F2  comisión recalculada UNA vez (1 fila), snapshot Bs fijo
//   F3  resumen 'cobrado'/0
//   F4  ambos JSON conservan la entrada no-COD y marcan cobro_destino_pagado
//   R1  replay con body byte-idéntico (misma clave B) → idempotent:true, sin duplicar
//   A1  misma clave B con payload alterado → COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA
//
// Variables de entorno: SUPABASE_URL (opcional), SUPABASE_SERVICE_KEY (requerida).
// La clave NUNCA se imprime ni se persiste en archivos.

const URL_BASE = (process.env.SUPABASE_URL || 'https://oyfyuszgjwcepjpngclv.supabase.co').replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''
if (!SERVICE_KEY) {
  console.error('FATAL: SUPABASE_SERVICE_KEY es requerida')
  process.exit(2)
}

const CUENTA = '983a7922-4c2c-4c88-9480-99fec1b74b5e'
const DESPACHO = '14c0de00-0000-4000-8000-000000000003'
const USUARIO = 'ef4044bf-7459-440e-ba4a-16b036f36496' // E2E Desarrollador Temporal
const USUARIO_NOMBRE = 'E2E Desarrollador Temporal'
const KEY_A = '14c0de00-0000-4000-8000-0000000000a1'
const KEY_B = '14c0de00-0000-4000-8000-0000000000b1'
const TASA_SNAPSHOT = '40.00000000'
const MONTO_BS = '4800.00'
const EQUIV_BS_USD = 120

const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}
const TIMEOUT = 30000

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

async function rpc(fn, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: H,
    body,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* deja text */ }
  return { status: res.status, ok: res.ok, text, json }
}

async function select(table, query) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, {
    headers: H,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SELECT ${table} → ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

function bodyReconcile(key, pagos, evidencia) {
  return JSON.stringify({
    p_cuenta_id: CUENTA,
    p_despacho_id: DESPACHO,
    p_idempotency_key: key,
    p_usuario_id: USUARIO,
    p_usuario_nombre: USUARIO_NOMBRE,
    p_pagos: pagos,
    p_evidencia: evidencia,
    p_ip_origen: '127.0.0.1',
  })
}

const PAGOS_PARCIAL = [{ metodo: 'Zelle', monto: '100.00', referencia: 'SMOKE-14COD-Z1' }]
const PAGOS_FINAL = [
  {
    metodo: 'Efectivo Bs',
    monto: '120.00',
    monto_bs: MONTO_BS,
    tasa_snapshot: TASA_SNAPSHOT,
    tasa_fuente: 'SMOKE-14COD tasa BCV prueba',
    tasa_actualizada_en: '2026-10-18T21:40:00.000Z',
  },
  { metodo: 'Efectivo $', monto: '80.00' },
]
const EVID_PARCIAL = 'SMOKE-14COD evidencia pago parcial'
const EVID_FINAL = 'SMOKE-14COD evidencia pago final'

const estadoCod = (r) => r?.cod?.estado
const deudaCod = (r) => r?.ledger?.deuda_cod_usd

async function main() {
  console.log(`Smoke COD 14 — ${URL_BASE} — despacho fixture ${DESPACHO}`)

  // ── S0: resumen previo ────────────────────────────────────────────────────
  const s0 = await rpc('resumen_financiero_despacho', JSON.stringify({ p_cuenta_id: CUENTA, p_despacho_id: DESPACHO }))
  check('S0 resumen HTTP 200', s0.ok, s0.text.slice(0, 120))
  check('S0 estado pendiente / deuda_cod 300', estadoCod(s0.json) === 'pendiente' && deudaCod(s0.json) === 300,
    `estado=${estadoCod(s0.json)} deuda=${deudaCod(s0.json)}`)

  // ── P1: pago parcial (clave A) ────────────────────────────────────────────
  const bodyA = bodyReconcile(KEY_A, PAGOS_PARCIAL, EVID_PARCIAL)
  const p1 = await rpc('registrar_pago_externo_cobro_idempotente', bodyA)
  check('P1 parcial HTTP 200', p1.ok, p1.text.slice(0, 160))
  const r1 = p1.json || {}
  check("P1 estado_cod 'parcial'", r1.estado_cod === 'parcial', `estado_cod=${r1.estado_cod}`)
  check('P1 saldo_previo 300 → restante 200', r1.saldo_previo_usd === 300 && r1.saldo_restante_usd === 200,
    `previo=${r1.saldo_previo_usd} restante=${r1.saldo_restante_usd}`)
  check('P1 sin comisión (comision_id null)', r1.comision_id === null, `comision_id=${r1.comision_id}`)
  check('P1 idempotent false / 1 abono', r1.idempotent === false && Array.isArray(r1.abono_ids) && r1.abono_ids.length === 1)

  // ── P2: estado tras parcial ───────────────────────────────────────────────
  const abonos1 = await select('cuentas_por_cobrar', `despacho_id=eq.${DESPACHO}&select=id,tipo,monto_usd,metodo_pago,forma_pago_abono,referencia,descripcion&order=creado_en`)
  const com1 = await select('comisiones', `despachoid=eq.${DESPACHO}&select=id`)
  const s1 = await rpc('resumen_financiero_despacho', JSON.stringify({ p_cuenta_id: CUENTA, p_despacho_id: DESPACHO }))
  check('P2 ledger: 1 cargo + 1 abono', abonos1.length === 2 && abonos1.filter((r) => r.tipo === 'abono').length === 1, `filas=${abonos1.length}`)
  check('P2 sin comisión tras parcial', com1.length === 0, `comisiones=${com1.length}`)
  check("P2 resumen 'parcial' / deuda 200", estadoCod(s1.json) === 'parcial' && deudaCod(s1.json) === 200,
    `estado=${estadoCod(s1.json)} deuda=${deudaCod(s1.json)}`)

  // ── F1: pago final (clave B) ──────────────────────────────────────────────
  const bodyB = bodyReconcile(KEY_B, PAGOS_FINAL, EVID_FINAL) // se reusa byte a byte en R1
  const f1 = await rpc('registrar_pago_externo_cobro_idempotente', bodyB)
  check('F1 final HTTP 200', f1.ok, f1.text.slice(0, 160))
  const r2 = f1.json || {}
  check("F1 estado_cod 'cobrado'", r2.estado_cod === 'cobrado', `estado_cod=${r2.estado_cod}`)
  check('F1 restante 0 / excedente 0', r2.saldo_restante_usd === 0 && r2.excedente_usd === 0,
    `restante=${r2.saldo_restante_usd} excedente=${r2.excedente_usd}`)
  check('F1 comision_id presente', typeof r2.comision_id === 'string' && r2.comision_id.length > 0, `comision_id=${r2.comision_id}`)
  check('F1 2 abonos en esta transacción', Array.isArray(r2.abono_ids) && r2.abono_ids.length === 2)

  // ── F2: comisión una sola vez + snapshot Bs ───────────────────────────────
  const com2 = await select('comisiones', `despachoid=eq.${DESPACHO}&select=id,totalcomision,comision_liberada,comision_retenida,estado,pctcabilla,pctotros,calculo_version,politica_comision,fuente_calculo`)
  check('F2 comisión recalculada UNA vez (1 fila)', com2.length === 1, `comisiones=${com2.length}`)
  check("F2 fila 'generada' con monto > 0", com2.length === 1 && com2[0].estado === 'generada' && Number(com2[0].totalcomision) > 0,
    com2.length === 1 ? `total=${com2[0].totalcomision} liberada=${com2[0].comision_liberada} retenida=${com2[0].comision_retenida}` : '')

  const abonos2 = await select('cuentas_por_cobrar', `despacho_id=eq.${DESPACHO}&select=id,tipo,monto_usd,metodo_pago,forma_pago_abono,referencia,descripcion&order=creado_en`)
  const abonoBs = abonos2.find((r) => String(r.forma_pago_abono || '').toLowerCase() === 'efectivo bs')
  check('F2 abono Bs con snapshot fijo en descripción',
    !!abonoBs && /tasa=40\.00000000/.test(abonoBs.descripcion || '') && /equivalente_usd=120/.test(abonoBs.descripcion || '') && /recibido=4800\.00/.test(abonoBs.descripcion || ''),
    abonoBs ? abonoBs.descripcion.slice(0, 140) : 'sin abono Bs')

  // ── F3: resumen final ─────────────────────────────────────────────────────
  const s2 = await rpc('resumen_financiero_despacho', JSON.stringify({ p_cuenta_id: CUENTA, p_despacho_id: DESPACHO }))
  check("F3 resumen 'cobrado' / deuda 0 / cobrado 300",
    estadoCod(s2.json) === 'cobrado' && deudaCod(s2.json) === 0 && s2.json?.ledger?.cobrado_usd === 300,
    `estado=${estadoCod(s2.json)} deuda=${deudaCod(s2.json)} cobrado=${s2.json?.ledger?.cobrado_usd}`)

  // ── F4: JSONs — entrada no-COD conservada + metodos_pagados con snapshot ──
  const nd = await select('notas_despacho', `id=eq.${DESPACHO}&select=forma_pago,forma_pago_cliente`)
  for (const campo of ['forma_pago', 'forma_pago_cliente']) {
    const fp = JSON.parse(nd[0][campo])
    const cod = fp.find((e) => String(e.metodo || '').toLowerCase() === 'cobro a destino')
    const noCod = fp.find((e) => e.metodo === 'Efectivo')
    const mp = cod?.metodos_pagados || []
    const pagoBs = mp.find((e) => e.metodo === 'Efectivo Bs')
    check(`F4 ${campo}: cobro_destino_pagado=true + clave B`, cod?.cobro_destino_pagado === true && cod?.idempotency_key === KEY_B)
    check(`F4 ${campo}: entrada no-COD 'Efectivo 100' conservada`, !!noCod && String(noCod.monto) === '100')
    check(`F4 ${campo}: metodos_pagados=3 con snapshot Bs fijo`,
      mp.length === 3 && !!pagoBs && String(pagoBs.tasa_snapshot) === TASA_SNAPSHOT
      && Number(pagoBs.equivalente_usd) === EQUIV_BS_USD && !!pagoBs.tasa_confirmada_en,
      `pagados=${mp.length} tasa=${pagoBs?.tasa_snapshot} equiv=${pagoBs?.equivalente_usd}`)
  }

  // ── R1: replay con body byte-idéntico (misma clave B) ─────────────────────
  const r1r = await rpc('registrar_pago_externo_cobro_idempotente', bodyB)
  check('R1 replay HTTP 200', r1r.ok, r1r.text.slice(0, 160))
  const rr = r1r.json || {}
  check('R1 idempotent=true', rr.idempotent === true, `idempotent=${rr.idempotent}`)
  const norm = (o) => JSON.stringify({ ...o, idempotent: null })
  check('R1 mismo resultado que F1 (sin duplicar)', norm(rr) === norm(r2))
  const abonos3 = await select('cuentas_por_cobrar', `despacho_id=eq.${DESPACHO}&select=id,tipo`)
  const com3 = await select('comisiones', `despachoid=eq.${DESPACHO}&select=id`)
  const aud3 = await select('auditoria', `entidad_id=eq.${DESPACHO}&select=id`)
  check('R1 sin duplicar abonos (3 abonos / 4 filas ledger)',
    abonos3.filter((r) => r.tipo === 'abono').length === 3 && abonos3.length === 4,
    `abonos=${abonos3.filter((r) => r.tipo === 'abono').length} filas=${abonos3.length}`)
  check('R1 sin re-calcular comisión (1)', com3.length === 1, `comisiones=${com3.length}`)
  check('R1 sin auditoría extra (2)', aud3.length === 2, `auditoria=${aud3.length}`)

  // ── A1: misma clave B con payload alterado ────────────────────────────────
  const bodyAlterado = bodyReconcile(KEY_B, PAGOS_FINAL, 'SMOKE-14COD evidencia ALTERADA')
  const a1 = await rpc('registrar_pago_externo_cobro_idempotente', bodyAlterado)
  check('A1 payload alterado rechazado (400)', a1.status === 400, `status=${a1.status}`)
  check('A1 error IDEMPOTENCIA_REUTILIZADA', /IDEMPOTENCIA_REUTILIZADA/.test(a1.text), a1.text.slice(0, 140))
  const abonos4 = await select('cuentas_por_cobrar', `despacho_id=eq.${DESPACHO}&select=id,tipo`)
  check('A1 sin efectos (siguen 3 abonos / 4 filas ledger)',
    abonos4.filter((r) => r.tipo === 'abono').length === 3 && abonos4.length === 4,
    `abonos=${abonos4.filter((r) => r.tipo === 'abono').length} filas=${abonos4.length}`)

  // ── Resumen de evidencia ──────────────────────────────────────────────────
  console.log('\nEVIDENCIA:')
  console.log(JSON.stringify({
    resultado_final: r2,
    comision: com2[0] || null,
    resultado_replay: { idempotent: rr.idempotent, estado_cod: rr.estado_cod },
    error_alterado: a1.json || a1.text.slice(0, 200),
  }, null, 2))
  console.log(`\n${failures === 0 ? 'SMOKE COMPLETO: TODOS LOS CHECKS EN VERDE' : `SMOKE CON FALLAS: ${failures} check(s) en rojo`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL smoke:', e.message)
  process.exit(2)
})
