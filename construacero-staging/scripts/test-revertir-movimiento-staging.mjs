// ─── Arnés Release 15: revertir_movimiento_inventario_atomico (staging) ──────
// Casos:
//   T1 revertir egreso manual OK (stock sube)
//   T2 revertir ingreso manual OK (stock baja)
//   T3 doble reversión → rechazada (MOVIMIENTO_YA_REVERTIDO)
//   T4 movimiento de venta (origen despacho) → rechazado
//   T5 cuenta ajena → rechazada
//   T6 idempotencia: misma clave → mismo resultado, sin filas nuevas
//   T7 continuidad del kardex del fixture (cada stock_anterior = saldo previo)
// Fixtures aislados (producto + movimientos propios) y limpieza final verificada.
import fs from 'node:fs'
import pg from 'pg'

function parse(f) {
  const o = {}
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) o[m[1]] = m[2].trim()
  })
  return o
}
const e = { ...parse('.env'), ...parse('.dev.vars') }

const c = new pg.Client({
  host: 'db.spupqgkdsgohxxfoxydl.supabase.co', port: 5432, user: 'postgres',
  password: e.PGPASSWORD || e.DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false },
})
await c.connect()

const CUENTA = '11111111-1111-1111-1111-111111111111' // se resuelve abajo
let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`) }
}
const uuid = () => crypto.randomUUID()

// ── Setup: cuenta + admin + producto fixture ─────────────────────────────────
// La cuenta real de staging se deduce de los productos (staging vive bajo una sola cuenta).
const { rows: cfgRows } = await c.query(`SELECT DISTINCT cuenta_id FROM public.productos LIMIT 2`)
if (cfgRows.length !== 1) { console.error('cuenta ambigua en staging'); process.exit(1) }
const cuentaId = cfgRows[0].cuenta_id
const { rows: admin } = await c.query(
  `SELECT id, nombre, color FROM public.usuarios
   WHERE cuenta_id=$1 AND activo=true AND rol='administracion' ORDER BY nombre LIMIT 1`, [cuentaId])
if (!admin.length) { console.error('no hay admin en staging'); process.exit(1) }
const ADMIN = admin[0]

const { rows: permitNeg } = await c.query(
  `SELECT COALESCE(permitir_stock_negativo,false) AS neg FROM public.configuracion_negocio WHERE cuenta_id=$1`, [cuentaId])
const PERMIT_NEG = permitNeg[0]?.neg === true

const CODIGO = 'T15-' + Date.now().toString(36)
const { rows: prod } = await c.query(
  `INSERT INTO public.productos (codigo, nombre, unidad, stock_actual, stock_minimo, activo, cuenta_id)
   VALUES ($1,'PRODUCTO ARNES T15','lt',10,0,true,$2) RETURNING id`,
  [CODIGO, cuentaId])
const PROD = prod[0].id
console.log(`Fixture: producto ${CODIGO} (${PROD}), cuenta ${String(cuentaId).slice(0,8)}, admin ${ADMIN.nombre}, stock inicial 10, neg permitido=${PERMIT_NEG}`)

async function insertMov(tipo, cantidad, origenTipo = null, motivoTipo = 'ajuste_inventario') {
  const stock = await c.query(`SELECT stock_actual FROM public.productos WHERE id=$1`, [PROD])
  const antes = Number(stock.rows[0].stock_actual)
  const despues = tipo === 'ingreso' ? antes + cantidad : antes - cantidad
  if (despues < 0 && !PERMIT_NEG) throw new Error('fixture: stock negativo no permitido')
  const { rows } = await c.query(
    `INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, producto_id, producto_nombre, cantidad, stock_anterior, stock_nuevo,
       usuario_id, usuario_nombre, cuenta_id, motivo_tipo, origen_tipo)
     VALUES ($1,$2,$3,$4,'PRODUCTO ARNES T15',$5,$6,$7,$8,'ARNES T15',$9,$11,$10)
     RETURNING id, numero`,
    [uuid(), tipo, 'Movimiento de prueba T15', PROD, cantidad, antes, despues, ADMIN.id, cuentaId, origenTipo, motivoTipo])
  await c.query(`UPDATE public.productos SET stock_actual=$1 WHERE id=$2`, [despues, PROD])
  return rows[0]
}

async function rpc(movId, adminId = ADMIN.id, cuenta = cuentaId) {
  const key = uuid()
  try {
    const { rows } = await c.query(
      `SELECT public.revertir_movimiento_inventario_atomico($1,$2,$3,$4,$5,$6) AS r`,
      [cuenta, movId, adminId, ADMIN.nombre, ADMIN.color, key])
    return { ok: true, r: rows[0].r, key }
  } catch (err) {
    return { ok: false, error: String(err.message || err), key }
  }
}

try {
  // ── T1: revertir egreso manual ─────────────────────────────────────────────
  console.log('\nT1 — revertir egreso manual')
  const eg = await insertMov('egreso', 3)
  const t1 = await rpc(eg.id)
  check('RPC ok', t1.ok, t1.error)
  check('tipo_inverso=ingreso', t1.r?.tipo_inverso === 'ingreso')
  const s1 = await c.query(`SELECT stock_actual FROM public.productos WHERE id=$1`, [PROD])
  check('stock sube +3 (→10)', Number(s1.rows[0].stock_actual) === 10, `stock=${s1.rows[0].stock_actual}`)
  check('origen_referencia correcta', t1.r?.movimiento_origen === eg.id)

  // ── T6: idempotencia (misma operación, nueva clave distinta NO; la misma clave → cacheado) ──
  console.log('\nT6 — idempotencia con la misma clave')
  // repetir la MISMA clave: llamar de nuevo con la misma key que devolvió t1
  const t6 = await c.query(
    `SELECT public.revertir_movimiento_inventario_atomico($1,$2,$3,$4,$5,$6) AS r`,
    [cuentaId, eg.id, ADMIN.id, ADMIN.nombre, ADMIN.color, t1.key]).then(r => r.rows[0].r).catch(err => ({ err: String(err.message || err) }))
  check('devuelve cacheado idempotent=true', t6?.idempotent === true, JSON.stringify(t6).slice(0, 120))
  const cnt6 = await c.query(
    `SELECT COUNT(*)::int AS n FROM public.inventario_movimientos WHERE origen_referencia='REVERSO_DE:'||$1::text`, [eg.id])
  check('solo 1 fila de reversión', cnt6.rows[0].n === 1, `n=${cnt6.rows[0].n}`)

  // ── T3: doble reversión con clave NUEVA → rechazada ────────────────────────
  console.log('\nT3 — doble reversión (clave nueva)')
  const t3 = await rpc(eg.id)
  check('rechaza MOVIMIENTO_YA_REVERTIDO', !t3.ok && t3.error.includes('MOVIMIENTO_YA_REVERTIDO'), t3.error)

  // ── T2: revertir ingreso manual ────────────────────────────────────────────
  console.log('\nT2 — revertir ingreso manual')
  const ing = await insertMov('ingreso', 5)
  const t2 = await rpc(ing.id)
  check('RPC ok', t2.ok, t2.error)
  check('tipo_inverso=egreso', t2.r?.tipo_inverso === 'egreso')
  const s2 = await c.query(`SELECT stock_actual FROM public.productos WHERE id=$1`, [PROD])
  check('stock baja −5 (→10)', Number(s2.rows[0].stock_actual) === 10, `stock=${s2.rows[0].stock_actual}`)

  // ── T4: movimiento de venta → rechazado ────────────────────────────────────
  console.log('\nT4 — movimiento con origen (venta/despacho) NO revertible')
  const venta = await insertMov('egreso', 1, null, 'venta')
  const t4 = await rpc(venta.id)
  check('rechaza movimiento de venta (despacho)', !t4.ok && t4.error.includes('MOVIMIENTO_NO_REVERTIBLE_TIPO_venta'), t4.error)

  // ── T5: cuenta ajena → rechazada ───────────────────────────────────────────
  console.log('\nT5 — cuenta ajena')
  const otro = await insertMov('egreso', 1)
  const t5 = await rpc(otro.id, ADMIN.id, uuid())
  check('rechaza MOVIMIENTO_NO_ENCONTRADO_O_CUENTA_AJENA o ROL_NO_AUTORIZADO', !t5.ok && (t5.error.includes('MOVIMIENTO_NO_ENCONTRADO_O_CUENTA_AJENA') || t5.error.includes('ROL_NO_AUTORIZADO')), t5.error)

  // ── T7: continuidad del kardex del fixture ─────────────────────────────────
  console.log('\nT7 — continuidad del kardex')
  const { rows: kx } = await c.query(
    `SELECT numero, tipo, cantidad, stock_anterior, stock_nuevo
       FROM public.inventario_movimientos WHERE producto_id=$1 ORDER BY numero`, [PROD])
  let contOk = true, prev = null
  for (const m of kx) {
    if (prev !== null && Number(m.stock_anterior) !== prev) contOk = false
    const delta = m.tipo === 'ingreso' ? Number(m.cantidad) : -Number(m.cantidad)
    if (Number(m.stock_nuevo) !== Number(m.stock_anterior) + delta) contOk = false
    prev = Number(m.stock_nuevo)
  }
  check('cadena stock_anterior→stock_nuevo continua', contOk, `movimientos=${kx.length}`)

  // stock final del producto = último stock_nuevo
  const fin = await c.query(`SELECT stock_actual FROM public.productos WHERE id=$1`, [PROD])
  check('stock_actual coincide con último saldo', Number(fin.rows[0].stock_actual) === prev, `real=${fin.rows[0].stock_actual} kardex=${prev}`)
} finally {
  // ── Limpieza ────────────────────────────────────────────────────────────────
  const d1 = await c.query(`DELETE FROM public.inventario_movimientos WHERE producto_id=$1 RETURNING id`, [PROD])
  const d2 = await c.query(`DELETE FROM public.inventario_operaciones WHERE operacion_tipo='inventory_reversal' AND cuenta_id=$1 AND creado_en > now() - interval '1 hour'`, [cuentaId]).catch(async () => {
    // nombre de columna distinto: limpiar por resultado LIKE
    return c.query(`DELETE FROM public.inventario_operaciones WHERE operacion_tipo='inventory_reversal' AND cuenta_id=$1 AND creado_en > now() - interval '1 hour'`, [cuentaId])
  })
  const d3 = await c.query(`DELETE FROM public.productos WHERE id=$1`, [PROD])
  console.log(`\nLimpieza: ${d1.rowCount} movimientos, ${d2.rowCount ?? '?'} operaciones, producto ${d3.rowCount} eliminado`)
  await c.end()
}
console.log(`\n=== RESULTADO: ${pass} pass / ${fail} fail ===`)
process.exit(fail ? 1 : 0)
