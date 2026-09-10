// ─── Arnés T0–T6: tipo de fila del consumo de saldo a favor (migración 274) ───
// Regla bajo prueba: el consumo de saldo a favor generado por la ENTREGA debe
// insertarse con tipo 'consumo_credito' (nunca 'abono') y NO debe netear el
// cargo COD — la deuda COD debe quedar cobrable tras entregar (caso #3072).
// Fixtures aislados (cuenta propia) + limpieza final.
import fs from 'node:fs'
import crypto from 'node:crypto'

const envTxt = fs.readFileSync('construacero-staging/.env', 'utf8')
const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const ref = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1]
const token = env.SUPABASE_ACCESS_TOKEN
if (ref !== 'spupqgkdsgohxxfoxydl') { console.error(`FATAL: ${ref} no es staging`); process.exit(1) }

async function q(sql, expectError = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const t = await r.text()
  if (!r.ok) {
    if (expectError) return { error: t }
    throw new Error(t.slice(0, 400))
  }
  return JSON.parse(t)
}

const uuid = () => crypto.randomUUID()
const CUENTA = uuid()
const USUARIO = uuid()
const VENDEDOR = uuid()
const ids = { despachos: [], cliente: null }
let passed = 0, failed = 0

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} ${extra}`) }
}

const round4 = (n) => Number(Number(n).toFixed(4))

// ── Fixture (idéntico al 272) ────────────────────────────────────────────────
async function setup() {
  await q(`INSERT INTO public.configuracion_negocio (id, cuenta_id, nombre_negocio)
           VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.configuracion_negocio), '${CUENTA}', 'TEST-274')`)
  await q(`INSERT INTO public.usuarios (id, cuenta_id, nombre, rol, activo)
           VALUES ('${USUARIO}', '${CUENTA}', 'Tester 274', 'administracion', TRUE)`)
  await q(`INSERT INTO public.usuarios (id, cuenta_id, nombre, rol, activo, comision_pct)
           VALUES ('${VENDEDOR}', '${CUENTA}', 'Vendedor 274', 'vendedor', TRUE, 2)`)
  const cl = await q(`INSERT INTO public.clientes (id, cuenta_id, vendedor_id, nombre, activo, telefono, saldo_pendiente, saldo_a_favor)
                      VALUES ('${uuid()}', '${CUENTA}', '${VENDEDOR}', 'Cliente 274', TRUE, '0412-4444444', 0, 0) RETURNING id`)
  ids.cliente = cl[0].id
}

async function crearAnticipo(monto) {
  await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, cuenta_id, metodo_pago)
           VALUES ('${ids.cliente}', 'credito', ${monto}, 0, 'SF-274 anticipo compras', '${USUARIO}', '${CUENTA}', 'cxc')`)
}

// Despacho mixto $100: Saldo a Favor $40 + COD $60 — SIN consumo pre-insertado.
// Así la ENTREGA es quien registra el consumo (el camino que parchea 274).
async function crearDespachoMixto({ saldoFavor = 40, cod = 60 } = {}) {
  const cotId = uuid()
  await q(`INSERT INTO public.cotizaciones (id, cuenta_id, cliente_id, vendedor_id, estado, total_usd)
           VALUES ('${cotId}', '${CUENTA}', '${ids.cliente}', '${VENDEDOR}', 'aceptada', 100)`)
  const dId = uuid()
  const fps = [
    { metodo: 'Saldo a Favor', monto: saldoFavor, forma_pago_origen: 'Efectivo $' },
    { metodo: 'Cobro a destino', monto: cod, diasVencimiento: 0 }
  ]
  const fpsJson = JSON.stringify(fps).replace(/'/g, "''")
  await q(`INSERT INTO public.notas_despacho (id, cuenta_id, cotizacion_id, cliente_id, vendedor_id, estado, total_usd, creado_por, forma_pago, forma_pago_cliente)
           VALUES ('${dId}', '${CUENTA}', '${cotId}', '${ids.cliente}', '${VENDEDOR}', 'pendiente', 100, '${USUARIO}', '${fpsJson}', '${fpsJson}')`)
  await q(`INSERT INTO public.notas_despacho_items (id, despacho_id, producto_id, nombre_snap, unidad_snap, origen, cantidad_original, cantidad, precio_unit_usd, precio_original, total_linea_usd, orden)
           VALUES ('${uuid()}', '${dId}', NULL, 'Item 274', 'und', 'inventario', 10, 10, 10, 10, 100, 0)`)
  ids.despachos.push(dId)
  return dId
}

async function workerAprueba(dId, { cod = 60 } = {}) {
  // Paso 5.a del Worker al aprobar: SOLO el cargo COD (el consumo lo hará la entrega)
  await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, cuenta_id, metodo_pago)
           VALUES ('${ids.cliente}', '${dId}', 'cargo', ${cod}, ${cod}, 'SF-274 despacho (COD)', '${USUARIO}', '${CUENTA}', 'cod')`)
}

async function cliente() {
  const r = await q(`SELECT saldo_pendiente, saldo_a_favor FROM public.clientes WHERE id='${ids.cliente}'`)
  return { deuda: round4(r[0].saldo_pendiente), favor: round4(r[0].saldo_a_favor) }
}

async function cxcDe(dId) {
  return q(`SELECT tipo, monto_usd, COALESCE(forma_pago_abono,'') AS fpa FROM public.cuentas_por_cobrar WHERE despacho_id='${dId}' ORDER BY creado_en`)
}

async function cleanup() {
  try {
    await q(`DELETE FROM public.comisiones WHERE despachoid IN (SELECT id FROM public.notas_despacho WHERE cuenta_id='${CUENTA}')`)
    await q(`DELETE FROM public.cuentas_por_cobrar WHERE cuenta_id='${CUENTA}'`)
    await q(`DELETE FROM public.inventario_movimientos WHERE cuenta_id='${CUENTA}'`)
    await q(`DELETE FROM public.notas_despacho_items WHERE despacho_id IN (SELECT id FROM public.notas_despacho WHERE cuenta_id='${CUENTA}')`)
    await q(`DELETE FROM public.notas_despacho WHERE cuenta_id='${CUENTA}'`)
    await q(`DELETE FROM public.cotizaciones WHERE cuenta_id='${CUENTA}'`)
    await q(`DELETE FROM public.clientes WHERE cuenta_id='${CUENTA}'`)
    await q(`DELETE FROM public.usuarios WHERE cuenta_id='${CUENTA}'`)
    await q(`DELETE FROM public.configuracion_negocio WHERE cuenta_id='${CUENTA}'`)
    console.log('\nLimpieza de fixtures OK')
  } catch (e) { console.error('LIMPIEZA PARCIAL — revisar residuos de cuenta', CUENTA, e.message) }
}

const IDK = () => uuid()

// ── Casos ─────────────────────────────────────────────────────────────────────
async function main() {
  await setup()

  console.log('═══ T0: baseline — anticipo crea favor=40 ═══')
  {
    await crearAnticipo(40)
    const c = await cliente()
    check('favor=40 tras anticipo', c.favor === 40, JSON.stringify(c))
    check('deuda=0', c.deuda === 0, JSON.stringify(c))
  }

  console.log('═══ T1: aprobar (cargo COD) — favor intacto, deuda=60 ═══')
  let D1
  {
    D1 = await crearDespachoMixto({ saldoFavor: 40, cod: 60 })
    const r = await q(`SELECT public.aprobar_despacho_inventario_atomico('${D1}', '${USUARIO}', 'Tester 274') AS res`)
    check('aprobación ok', r[0].res.ok === true, JSON.stringify(r[0].res).slice(0, 200))
    await workerAprueba(D1, { cod: 60 })
    const c = await cliente()
    check('favor=40 (aprobación no consume)', c.favor === 40, JSON.stringify(c))
    check('deuda=60 (cargo COD)', c.deuda === 60, JSON.stringify(c))
  }

  console.log('═══ T2: ENTREGAR — consumo con tipo consumo_credito, COD intacto ═══')
  let idk2
  {
    idk2 = IDK()
    const r = await q(`SELECT public.confirmar_entrega_finanzas_atomica_staging('${CUENTA}', '${D1}', '${idk2}', '${USUARIO}', 'Tester 274') AS res`)
    check('entrega ok', r[0].res.ok === true, JSON.stringify(r[0].res).slice(0, 300))
    const c = await cliente()
    check('favor=0 tras entregar (40 consumidos)', c.favor === 0, JSON.stringify(c))
    check('deuda=60 tras entregar (COD NO neteado)', c.deuda === 60, JSON.stringify(c))
    const cxc = await cxcDe(D1)
    const consumo = cxc.find(x => x.tipo === 'consumo_credito' && x.fpa.toLowerCase() === 'saldo a favor')
    check('fila de consumo con tipo consumo_credito', !!consumo, JSON.stringify(cxc))
    const abonosSF = cxc.filter(x => x.tipo === 'abono' && x.fpa.toLowerCase() === 'saldo a favor')
    check('CERO filas abono Saldo a favor', abonosSF.length === 0, JSON.stringify(abonosSF))
  }

  console.log('═══ T3: idempotencia — re-entregar con misma key no duplica ═══')
  {
    const r = await q(`SELECT public.confirmar_entrega_finanzas_atomica_staging('${CUENTA}', '${D1}', '${idk2}', '${USUARIO}', 'Tester 274') AS res`)
    const res = r[0].res
    check('re-entrega no explota', res && (res.ok === true || res.duplicado === true || res.idempotente === true || typeof res === 'object'), JSON.stringify(res).slice(0, 200))
    const cxc = await cxcDe(D1)
    const consumos = cxc.filter(x => x.tipo === 'consumo_credito')
    const cargos = cxc.filter(x => x.tipo === 'cargo')
    check('un solo consumo_credito', consumos.length === 1, JSON.stringify(cxc))
    check('un solo cargo COD', cargos.length === 1, JSON.stringify(cargos))
    const c = await cliente()
    check('favor=0 estable', c.favor === 0, JSON.stringify(c))
    check('deuda=60 estable', c.deuda === 60, JSON.stringify(c))
  }

  console.log('═══ T4: COBRABILIDAD — cobrar el COD tras entregar (repara #3072) ═══')
  {
    await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, descripcion, registrado_por, cuenta_id, metodo_pago)
             VALUES ('${ids.cliente}', '${D1}', 'abono', 60, 0, 'Efectivo', 'SF-274 cobro COD post-entrega', '${USUARIO}', '${CUENTA}', 'cod')`)
    const c = await cliente()
    check('deuda=0 tras cobrar COD', c.deuda === 0, JSON.stringify(c))
    check('favor=0 (el cobro no toca el bolsillo de favor)', c.favor === 0, JSON.stringify(c))
  }

  console.log('═══ T5: REVERTIR entrega — restaura favor y borra filas del despacho ═══')
  {
    // Guardarraíl real: anular primero los cobros (abono Efectivo) antes de revertir
    await q(`DELETE FROM public.cuentas_por_cobrar WHERE despacho_id='${D1}' AND tipo='abono' AND forma_pago_abono='Efectivo'`)
    const r = await q(`SELECT public.revertir_entrega_finanzas_atomica_staging('${D1}', 'despachada', '${USUARIO}', 'Tester 274', NULL, '${IDK()}') AS res`)
    check('reversión ok', r[0].res.finanzas_revertidas === true, JSON.stringify(r[0].res).slice(0, 300))
    const c = await cliente()
    check('favor=40 restaurado (consumo borrado)', c.favor === 40, JSON.stringify(c))
    check('deuda=0 tras revertir (cargo COD borrado)', c.deuda === 0, JSON.stringify(c))
    const restantes = await q(`SELECT count(*)::int AS n FROM public.cuentas_por_cobrar WHERE despacho_id='${D1}'`)
    check('sin filas CxC del despacho revertido', restantes[0].n === 0, JSON.stringify(restantes))
  }

  console.log('═══ T6: cruce legítimo — sigue siendo abono sin despacho ═══')
  {
    // El endpoint de cruce (cxc.js) inserta abono 'Saldo a favor' con despacho_id NULL:
    // deuda pendiente + favor disponible → pago de deuda real, no consumo de despacho.
    const cl = await cliente()
    check('pre: favor=40 disponible', cl.favor === 40, JSON.stringify(cl))
    // crear deuda real (cargo sin despacho, como CxC manual)
    await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, cuenta_id, metodo_pago)
             VALUES ('${ids.cliente}', 'cargo', 30, 30, 'SF-274 deuda manual', '${USUARIO}', '${CUENTA}', 'cxc')`)
    let c = await cliente()
    check('deuda=30 (cargo manual)', c.deuda === 30, JSON.stringify(c))
    // cruce: abono 'Saldo a favor' SIN despacho_id — exactamente como el endpoint
    await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id, metodo_pago)
             VALUES ('${ids.cliente}', 'abono', 30, 0, 'Saldo a favor', 'Cruce interno', 'SF-274 cruce contra deuda', '${USUARIO}', '${CUENTA}', 'cxc')`)
    c = await cliente()
    check('deuda=0 tras cruce', c.deuda === 0, JSON.stringify(c))
    check('favor=10 tras cruce (40-30)', c.favor === 10, JSON.stringify(c))
    const fila = await q(`SELECT count(*)::int AS n FROM public.cuentas_por_cobrar WHERE cliente_id='${ids.cliente}' AND tipo='abono' AND lower(forma_pago_abono)='saldo a favor' AND despacho_id IS NULL`)
    check('cruce con despacho_id NULL preservado', fila[0].n === 1, JSON.stringify(fila))
  }

  console.log('═══ T7: invariante — replay canónico == columnas (auditor) ═══')
  {
    const ledger = await q(`SELECT
      COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd WHEN tipo='abono' THEN -monto_usd ELSE 0 END),0) AS deuda,
      COALESCE(SUM(CASE WHEN tipo='credito' THEN monto_usd WHEN tipo='abono' AND lower(COALESCE(forma_pago_abono,''))='saldo a favor' THEN -monto_usd WHEN tipo='devolucion_credito' THEN -monto_usd WHEN tipo='consumo_credito' THEN -monto_usd ELSE 0 END),0) AS favor
      FROM public.cuentas_por_cobrar WHERE cliente_id='${ids.cliente}' AND cuenta_id='${CUENTA}'`)
    const c = await cliente()
    check('deuda columna == replay', round4(Math.max(0, ledger[0].deuda)) === c.deuda, `ledger=${ledger[0].deuda} col=${c.deuda}`)
    check('favor columna == replay', round4(Math.max(0, ledger[0].favor)) === c.favor, `ledger=${ledger[0].favor} col=${c.favor}`)
  }

  await cleanup()
  console.log(`\n═══ RESULTADO: ${passed} PASS, ${failed} FAIL ═══`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('FATAL:', e.message)
  await cleanup()
  process.exit(1)
})
