import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const EXPECTED_REF = 'oyfyuszgjwcepjpngclv'
const CONFIRM = 'RUN_PRODUCTION_DEEP_EDIT_239'
const signatures = [
  'editar_despacho_profundidad(uuid,jsonb)',
  'editar_despacho_profundidad(uuid,jsonb,uuid,text,text)',
  'editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)',
]

function loadEnv(file) {
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); const i = line.indexOf('=')
    if (!line || line.startsWith('#') || i < 1) continue
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[line.slice(0, i).trim()] = value
  }
  return out
}
function assert(ok, message) { if (!ok) throw new Error(`POSTFLIGHT_FAIL: ${message}`) }
function key(row) {
  const product = row.producto_id || `externo:${row.codigo_snap || ''}:${row.nombre_snap || ''}`
  return `${product}|${Number(row.precio_unit_usd || 0).toFixed(4)}|${Number(row.descuento_pct || 0).toFixed(4)}|${row.origen || 'inventario'}|${row.es_prestamo ? 'prestamo' : 'venta'}`
}
function payload(rows) { return rows.map((r, i) => ({
  producto_id: r.producto_id || null, codigo_snap: r.codigo_snap || null,
  nombre_snap: r.nombre_snap, unidad_snap: r.unidad_snap || 'und', cantidad: Number(r.cantidad),
  precio_unit_usd: Number(r.precio_unit_usd), descuento_pct: Number(r.descuento_pct || 0),
  orden: Number.isInteger(r.orden) ? r.orden : i, origen: r.origen || (r.producto_id ? 'inventario' : 'externo'),
  es_prestamo: Boolean(r.es_prestamo),
})) }
function normalized(rows) { return rows.map(r => ({ key: key(r), cantidad: Number(r.cantidad), orden: Number(r.orden || 0) })).sort((a,b) => `${a.orden}|${a.key}`.localeCompare(`${b.orden}|${b.key}`)) }

if (process.env.PRODUCTION_DEEP_EDIT_CONFIRM !== CONFIRM) throw new Error(`Falta PRODUCTION_DEEP_EDIT_CONFIRM=${CONFIRM}`)
const env = loadEnv('.env')
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
assert(ref === EXPECTED_REF && env.host === `db.${EXPECTED_REF}.supabase.co`, 'destino principal inesperado')
assert(env.DB_PASSWORD, 'falta DB_PASSWORD')
const sql = fs.readFileSync(path.resolve('supabase/release/main/239_edicion_profunda_dedup_guard.sql'), 'utf8')
const backupPath = path.resolve(`tmp/backups/deep-edit-main-239-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.mkdirSync(path.dirname(backupPath), { recursive: true })
const db = new pg.Client({ host: env.host, port: Number(env.port || 5432), database: env.database || 'postgres', user: env.user || 'postgres', password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000, statement_timeout: 120000 })
let inTx = false
try {
  await db.connect()
  const identity = (await db.query(`select current_database() database, current_user user_name`)).rows[0]
  assert(identity.database === 'postgres' && identity.user_name === 'postgres', 'identidad DB inesperada')
  const funcs = (await db.query(`select p.oid::regprocedure::text signature, pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='editar_despacho_profundidad' order by 1`)).rows
  assert(funcs.length === 3, 'se esperaban tres overloads para respaldar')
  const acl = (await db.query(`select p.oid::regprocedure::text signature, case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end grantee, x.privilege_type from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) x where n.nspname='public' and p.proname='editar_despacho_profundidad'`)).rows
  fs.writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), project_ref: ref, identity, functions: funcs, acl }, null, 2) + '\n', { flag: 'wx' })
  await db.query('BEGIN'); inTx = true
  await db.query(sql)
  const active = (await db.query(`select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid='public.editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)'::regprocedure`)).rows[0]?.definition || ''
  assert(/delete\s+from\s+public\.notas_despacho_items/i.test(active), 'RPC sin DELETE')
  assert(/administracion[\s\S]*jefe[\s\S]*desarrollador/i.test(active) && !/supervisor/i.test(active.slice(active.indexOf('IF v_operador.rol NOT IN'), active.indexOf('IF v_operador.rol NOT IN') + 250)), 'RPC aún autoriza supervisor')
  const candidate = (await db.query(`select d.id, u.id operator_id, u.nombre operator_name, u.rol operator_role from public.notas_despacho d join lateral (select id,nombre,rol from public.usuarios where cuenta_id=d.cuenta_id and activo is true and rol in ('administracion','jefe','desarrollador') order by case rol when 'administracion' then 1 when 'jefe' then 2 else 3 end limit 1) u on true where d.estado='pendiente' order by d.actualizado_en desc nulls last limit 20`)).rows[0]
  assert(candidate, 'sin despacho pendiente de prueba')
  const original = (await db.query(`select producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,orden,origen,es_prestamo from public.notas_despacho_items where despacho_id=$1 order by orden nulls last,id`, [candidate.id])).rows
  const items = payload(original); assert(items.length > 0 && new Set(items.map(key)).size === items.length, 'fixture elegido tiene duplicados')
  await db.query('SAVEPOINT deep_edit_smoke')
  const call = (itemsArg) => db.query(`select public.editar_despacho_profundidad($1::uuid,$2::jsonb,$3::uuid,$4::text,$5::text,$6::text)`, [candidate.id, JSON.stringify(itemsArg), candidate.operator_id, candidate.operator_name, candidate.operator_role, null])
  await call(items)
  let after = (await db.query(`select producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,orden,origen,es_prestamo from public.notas_despacho_items where despacho_id=$1 order by orden nulls last,id`, [candidate.id])).rows
  assert(after.length === items.length, 'primer guardado cambió el número de filas')
  await call(items)
  after = (await db.query(`select id from public.notas_despacho_items where despacho_id=$1`, [candidate.id])).rows
  assert(after.length === items.length, 'guardado repetido acumuló filas')
  await db.query('SAVEPOINT duplicate_check')
  let rejected = false
  try { await call([items[0], items[0]]) } catch (e) { rejected = /ITEMS_DUPLICADOS/i.test(String(e.message)) }
  assert(rejected, 'duplicado no rechazado')
  await db.query('ROLLBACK TO SAVEPOINT duplicate_check')
  await db.query('ROLLBACK TO SAVEPOINT deep_edit_smoke')
  await db.query('RELEASE SAVEPOINT deep_edit_smoke')
  await db.query('COMMIT'); inTx = false
  const post = (await db.query(`select has_function_privilege('anon','public.editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)','EXECUTE') anon_execute, has_function_privilege('authenticated','public.editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)','EXECUTE') authenticated_execute, has_function_privilege('service_role','public.editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)','EXECUTE') service_execute`)).rows[0]
  assert(post.anon_execute === false && post.authenticated_execute === false && post.service_execute === true, 'ACL incorrecta')
  console.log(JSON.stringify({ ok: true, project_ref: ref, backupPath, candidate: { id: candidate.id, operator_role: candidate.operator_role }, tests: { repeatedSave: 'PASS', duplicateReject: 'PASS', smokeRollback: 'PASS' }, postflight: post }, null, 2))
} catch (error) {
  if (inTx) await db.query('ROLLBACK').catch(() => {})
  console.error(JSON.stringify({ ok: false, backupPath, error: String(error.stack || error) }, null, 2))
  process.exitCode = 1
} finally { await db.end().catch(() => {}) }
