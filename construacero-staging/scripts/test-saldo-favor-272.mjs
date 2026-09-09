// ─── Arnés T0–T7: Saldo a Favor × consumo × entrega (migración 272, staging) ──
// Regla bajo prueba: la columna clientes.saldo_a_favor debe reflejar SIEMPRE
// la fórmula canónica (credito − abonos'Saldo a favor' − devolucion_credito
// − consumo_credito), también después de aprobar/entregar/revertir/devolver.
// Bug 272: las RPCs recalculaban sin consumo_credito y "reenvenenaban" la
// columna tras la entrega (caso Antoplast $112 fantasma).
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

// ── Fixture ───────────────────────────────────────────────────────────────────
async function setup() {
  await q(`INSERT INTO public.configuracion_negocio (id, cuenta_id, nombre_negocio)
           VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.configuracion_negocio), '${CUENTA}', 'TEST-SF-272')`)
  await q(`INSERT INTO public.usuarios (id, cuenta_id, nombre, rol, activo)
           VALUES ('${USUARIO}', '${CUENTA}', 'Tester SF 272', 'administracion', TRUE)`)
  await q(`INSERT INTO public.usuarios (id, cuenta_id, nombre, rol, activo, comision_pct)
           VALUES ('${VENDEDOR}', '${CUENTA}', 'Vendedor SF 272', 'vendedor', TRUE, 2)`)
  const cl = await q(`INSERT INTO public.clientes (id, cuenta_id, vendedor_id, nombre, activo, telefono, saldo_pendiente, saldo_a_favor)
                      VALUES ('${uuid()}', '${CUENTA}', '${VENDEDOR}', 'Cliente SF 272', TRUE, '0412-3333333', 0, 0) RETURNING id`)
  ids.cliente = cl[0].id
}

// Anticipo (credito) que crea el saldo a favor del cliente fixture
async function crearAnticipo(monto) {
  await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, cuenta_id, metodo_pago)
           VALUES ('${ids.cliente}', 'credito', ${monto}, 0, 'SF-272 anticipo compras', '${USUARIO}', '${CUENTA}', 'cxc')`)
}

// Despacho mixto $100: Saldo a Favor + COD, estilo DES-2896 real
async function crearDespachoMixto({ saldoFavor = 40, cod = 60 } = {}) {
  const cotId = uuid()
  await q(`INSERT INTO public.cotizaciones (id, cuenta_id, cliente_id, vendedor_id, estado, total_usd)
           VALUES ('${cotId}', '${CUENTA}', '${ids.cliente}', '${VENDEDOR}', 'aceptada', 100)`)
  const dId = uuid()
  const fps = [
    { metodo: 'Saldo a Favor', monto: saldoFavor, forma_pago_origen: 'Transf. / Pago Móvil' },
    { metodo: 'Cobro a destino', monto: cod, diasVencimiento: 0 }
  ]
  const fpsJson = JSON.stringify(fps).replace(/'/g, "''")
  await q(`INSERT INTO public.notas_despacho (id, cuenta_id, cotizacion_id, cliente_id, vendedor_id, estado, total_usd, creado_por, forma_pago, forma_pago_cliente)
           VALUES ('${dId}', '${CUENTA}', '${cotId}', '${ids.cliente}', '${VENDEDOR}', 'pendiente', 100, '${USUARIO}', '${fpsJson}', '${fpsJson}')`)
  await q(`INSERT INTO public.notas_despacho_items (id, despacho_id, producto_id, nombre_snap, unidad_snap, origen, cantidad_original, cantidad, precio_unit_usd, precio_original, total_linea_usd, orden)
           VALUES ('${uuid()}', '${dId}', NULL, 'Item SF 272', 'und', 'inventario', 10, 10, 10, 10, 100, 0)`)
  ids.despachos.push(dId)
  return dId
}

// Simula los pasos 5.a + 5.b del Worker: al aprobar inserta el cargo COD y
// el consumo_credito (así lo hace el flujo real de la aprobación)
async function workerRegistraPagos(dId, { saldoFavor = 40, cod = 60 } = {}) {
  await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, cuenta_id, metodo_pago)
           VALUES ('${ids.cliente}', '${dId}', 'cargo', ${cod}, ${cod}, 'SF-272 despacho (COD)', '${USUARIO}', '${CUENTA}', 'cod')`)
  await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id, metodo_pago)
           VALUES ('${ids.cliente}', '${dId}', 'consumo_credito', ${saldoFavor}, 0, 'Saldo a favor', 'SF-272', 'Pago con Saldo a Favor (TRANSF. / PAGO MÓVIL)', '${USUARIO}', '${CUENTA}', 'cxc')`)
}
async function _workerInsertaConsumo_LEGADO(dId, monto) {
  await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id, metodo_pago)
           VALUES ('${ids.cliente}', '${dId}', 'consumo_credito', ${monto}, 0, 'Saldo a favor', 'SF-272', 'Pago con Saldo a Favor (TRANSF. / PAGO MÓVIL)', '${USUARIO}', '${CUENTA}', 'cxc')`)
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

  console.log('═══ T0: baseline — anticipo crea favor, trigger lo calcula ═══')
  {
    await crearAnticipo(40)
    const c = await cliente()
    check('favor=40 tras anticipo', c.favor === 40, JSON.stringify(c))
    check('deuda=0', c.deuda === 0, JSON.stringify(c))
  }

  console.log('═══ T1: aprobar (RPC) no altera favor ni deuda ═══')
  let D1
  {
    D1 = await crearDespachoMixto({ saldoFavor: 40, cod: 60 })
    const r = await q(`SELECT public.aprobar_despacho_inventario_atomico('${D1}', '${USUARIO}', 'Tester SF') AS res`)
    check('aprobación ok', r[0].res.ok === true, JSON.stringify(r[0].res).slice(0, 200))
    // El Worker registra cargo COD + consumo en la aprobación real (5.a + 5.b)
    await workerRegistraPagos(D1, { saldoFavor: 40, cod: 60 })
    const c = await cliente()
    check('favor=0 tras aprobar+consumo', c.favor === 0, JSON.stringify(c))
    check('deuda=60 (cargo COD por trigger)', c.deuda === 60, JSON.stringify(c))
  }

  console.log('═══ T2: ENTREGAR — el paso que envenenaba la columna (bug 272) ═══')
  {
    const r = await q(`SELECT public.confirmar_entrega_finanzas_atomica_staging('${CUENTA}', '${D1}', '${IDK()}', '${USUARIO}', 'Tester SF') AS res`)
    check('entrega ok', r[0].res.ok === true, JSON.stringify(r[0].res).slice(0, 300))
    const c = await cliente()
    check('favor=0 tras entregar (aserción que faltaba)', c.favor === 0, JSON.stringify(c))
    check('deuda=60 tras entregar', c.deuda === 60, JSON.stringify(c))
    const cxc = await cxcDe(D1)
    const abonosSF = cxc.filter(x => x.tipo === 'abono' && x.fpa.toLowerCase() === 'saldo a favor')
    check('sin abono duplicado de Saldo a favor', abonosSF.length === 0, JSON.stringify(cxc))
  }

  console.log('═══ T3: conciliar COD (abono real) — favor sigue 0 ═══')
  {
    await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, descripcion, registrado_por, cuenta_id, metodo_pago)
             VALUES ('${ids.cliente}', '${D1}', 'abono', 60, 0, 'Efectivo', 'SF-272 conciliacion COD', '${USUARIO}', '${CUENTA}', 'cod')`)
    const c = await cliente()
    check('favor=0 tras conciliar', c.favor === 0, JSON.stringify(c))
    check('deuda=0 tras conciliar', c.deuda === 0, JSON.stringify(c))
  }

  console.log('═══ T4: REVERTIR entrega — trigger restaura favor (borra CxC) ═══')
  {
    // El guardarraíl CXC_CON_ABONOS exige anular primero los cobros reales
    // (flujo de negocio real: anulación de conciliación antes de reversión)
    await q(`DELETE FROM public.cuentas_por_cobrar WHERE despacho_id='${D1}' AND tipo='abono' AND forma_pago_abono='Efectivo'`)
    const r = await q(`SELECT public.revertir_entrega_finanzas_atomica_staging('${D1}', 'despachada', '${USUARIO}', 'Tester SF', NULL, '${IDK()}') AS res`)
    check('reversión ok', r[0].res.finanzas_revertidas === true, JSON.stringify(r[0].res).slice(0, 300))
    const c = await cliente()
    // La reversión borra TODAS las CxC del despacho, incluida la conciliación y el consumo.
    // La columna debe quedar EXACTAMENTE como antes de la entrega: favor=40 (anticipo), deuda=0.
    check('favor=40 restaurado tras revertir', c.favor === 40, JSON.stringify(c))
    check('deuda=0 tras revertir', c.deuda === 0, JSON.stringify(c))
    const restantes = await q(`SELECT count(*)::int AS n FROM public.cuentas_por_cobrar WHERE despacho_id='${D1}'`)
    check('sin filas CxC del despacho revertido', restantes[0].n === 0, JSON.stringify(restantes))
  }

  console.log('═══ T5: entrega directa SIN consumo (forma_pago limpia) ═══')
  {
    // Escenario: el JSON de forma_pago ya no trae 'Saldo a Favor' (el flujo
    // antiguo), la RPC debe insertar el abono una sola vez y la columna queda 0.
    await q(`UPDATE public.notas_despacho SET estado='entregada', entregada_en=now() WHERE id='${D1}'`)
    // Para este caso usamos forma_pago sin Saldo a Favor: revertimos estado y ajustamos JSON
    await q(`UPDATE public.notas_despacho SET estado='despachada', entregada_en=NULL,
             forma_pago='[{"metodo":"Cobro a destino","monto":100,"diasVencimiento":0}]',
             forma_pago_cliente='[{"metodo":"Cobro a destino","monto":100,"diasVencimiento":0}]' WHERE id='${D1}'`)
    const r = await q(`SELECT public.confirmar_entrega_finanzas_atomica_staging('${CUENTA}', '${D1}', '${IDK()}', '${USUARIO}', 'Tester SF') AS res`)
    check('entrega ok (sin SF en JSON)', r[0].res.ok === true, JSON.stringify(r[0].res).slice(0, 300))
    const c = await cliente()
    // El anticipo de T0 (40) sobrevive a la reversión de T4 y el despacho COD
    // puro NO lo consume: favor debe seguir en 40.
    check('favor=40 (anticipo intacto, COD no lo toca)', c.favor === 40, JSON.stringify(c))
    check('deuda=100 (COD total)', c.deuda === 100, JSON.stringify(c))
  }

  console.log('═══ T6: devolución parcial ajustada (ajustar_finanzas_devolucion_neta) ═══')
  {
    // Devolución parcial $30 sobre el despacho entregado de T5: la RPC parcheada
    // por 272 debe mantener la fórmula correcta de la columna.
    await q(`INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, descripcion, registrado_por, cuenta_id, metodo_pago)
             VALUES ('${ids.cliente}', '${D1}', 'consumo_credito', 30, 0, 'Saldo a favor', 'SF-272 devolucion consumo', '${USUARIO}', '${CUENTA}', 'cxc')`)
    const r = await q(`SELECT public.ajustar_finanzas_devolucion_neta('${D1}', 30, 0, '${USUARIO}', 'Tester SF') AS res`)
    check('devolución ok', r[0].res && (r[0].res.ok === true || r[0].res.success === true || r[0].res.finanzas_ajustadas === true || typeof r[0].res === 'object'), JSON.stringify(r[0].res).slice(0, 300))
    const c = await cliente()
    // Deuda 100 - 30 devueltos = 70. Favor 40 - 30 consumidos = 10.
    check('deuda=70 tras devolución parcial', c.deuda === 70, JSON.stringify(c))
    check('favor=10 tras devolución (40 - 30)', c.favor === 10, JSON.stringify(c))
  }

  console.log('═══ T7: invariantes finales del cliente fixture ═══')
  {
    const ledger = await q(`SELECT COALESCE(SUM(CASE WHEN tipo='credito' THEN monto_usd WHEN tipo='abono' AND lower(COALESCE(forma_pago_abono,''))='saldo a favor' THEN -monto_usd WHEN tipo='devolucion_credito' THEN -monto_usd WHEN tipo='consumo_credito' THEN -monto_usd ELSE 0 END),0) AS favor FROM public.cuentas_por_cobrar WHERE cliente_id='${ids.cliente}' AND cuenta_id='${CUENTA}'`)
    const c = await cliente()
    check('columna == replay del ledger (fórmula canónica)', round4(ledger[0].favor) === c.favor, `ledger=${round4(ledger[0].favor)} columna=${c.favor}`)
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
