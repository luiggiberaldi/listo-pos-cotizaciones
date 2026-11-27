// scripts/op084-pruebas-staging.mjs — Pruebas extra del plan OP-2026-084 (SOLO STAGING).
// Intentan "romper" el sistema a propósito y comprueban el resultado en la base real.
// No deja datos: las pruebas que escriben lo hacen dentro de transacciones que se deshacen.
// Requiere: servidor local :8789 y página local :5174 (npm run dev), .env, .env.e2e.local y .dev.vars.
// Uso: node scripts/op084-pruebas-staging.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './test-e2e-staging.mjs'

const STAGING = 'spupqgkdsgohxxfoxydl'
const here = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(here, '..')
const leer = f => { try { return parseEnvFile(readFileSync(path.join(raiz, f), 'utf8')) } catch { return {} } }
const env = { ...leer('.env'), ...leer('.dev.vars'), ...leer('.env.e2e.local') }
const URL_SB = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
const FRONT = 'http://localhost:5174'
if (!URL_SB?.includes(STAGING)) throw new Error('Guardia: esto solo corre contra staging')

const resultados = []
function anotar(codigo, ok, detalle) {
  resultados.push({ codigo, ok, detalle })
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${codigo} — ${detalle}`)
}

async function sqlStaging(query, escribir = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(escribir ? { query } : { query, read_only: true }),
  })
  const t = await r.text()
  if (r.status >= 300) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`)
  return JSON.parse(t)
}

// ── Sesión real de prueba (igual que el probador completo) ─────────────────
const sb = createClient(URL_SB, ANON, { auth: { persistSession: false } })
const { data: login, error: loginErr } = await sb.auth.signInWithPassword({ email: env.STAGING_E2E_EMAIL.trim().toLowerCase(), password: env.STAGING_E2E_PASSWORD })
if (loginErr) throw new Error(`Login E2E rechazado: ${loginErr.message}`)
const jwt = login.session.access_token
const cuenta = login.user.id
async function api(ruta, metodo = 'GET', cuerpo = null, extra = {}) {
  const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/json', ...extra }
  if (operadorToken) headers['X-Operator-Session'] = operadorToken
  if (cuerpo) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${FRONT}${ruta}`, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  const texto = await res.text()
  let datos = null; try { datos = JSON.parse(texto) } catch { datos = texto }
  return { status: res.status, datos }
}
let operadorToken = null
const sa = await api('/api/auth/super-admin', 'POST', { code: env.DEV_SUPER_CODE })
operadorToken = sa.datos?.operatorSession?.token
if (!operadorToken) throw new Error('No se abrió la sesión de operador de prueba')
console.log(`Sesión de prueba lista (empresa ${cuenta.slice(0, 8)})\n`)

// ── R1: respaldo completo ───────────────────────────────────────────────────
{
  const r = await api('/api/admin/backup')
  const b = r.datos
  const tablas = ['productos', 'inventario_movimientos', 'cotizacion_items', 'notas_despacho_items', 'cuentas_por_cobrar']
  const [conteo] = await sqlStaging(`SELECT ${tablas.map(t => `(SELECT count(*) FROM public.${t} WHERE cuenta_id='${cuenta}')::int AS ${t}`).join(', ')}`)
  const difs = tablas.filter(t => (b?.tablas?.[t]?.length ?? -1) !== conteo[t]).map(t => `${t}: archivo ${b?.tablas?.[t]?.length} vs base ${conteo[t]}`)
  anotar('R1 respaldo completo', r.status === 200 && b?.completo === true && difs.length === 0,
    difs.length ? difs.join('; ') : `versión ${b?.version}; ${tablas.map(t => `${t}=${conteo[t]}`).join(', ')}`)
}

// ── L4: "sobrescribir" eliminado del ingreso por lote ───────────────────────
{
  const [p] = await sqlStaging(`SELECT id, nombre FROM public.productos WHERE cuenta_id='${cuenta}' AND activo LIMIT 1`)
  const r = await api('/api/inventario/batch-ingest', 'POST', {
    motivo: 'OP-084 prueba sobrescribir', idempotencyKey: crypto.randomUUID(),
    productos: [{ id: p.id, nombre: p.nombre, cantidad: 1, isNuevo: false, modoExistente: 'sobrescribir', categoria: 'X', unidad: 'und' }],
  })
  anotar('L4 lote sin sobrescribir (servidor)', r.status === 400, `HTTP ${r.status}: ${r.datos?.error || ''}`)
  const [x] = await sqlStaging(`DO $$ BEGIN
      PERFORM public.ingresar_lote_inventario_atomico('${cuenta}', 'prueba', '[{"producto_id":"${p.id}","is_nuevo":false,"nombre":"x","cantidad":1,"modo_existente":"sobrescribir"}]'::jsonb, NULL, NULL, NULL, gen_random_uuid());
      RAISE EXCEPTION 'NO_BLOQUEO';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; IF SQLERRM <> 'MODO_SOBRESCRIBIR_ELIMINADO_USAR_CONTEO_FISICO' THEN RAISE; END IF; END $$; SELECT 1 AS ok`, true).catch(e => [{ err: e.message }])
  anotar('L4 lote sin sobrescribir (base)', x?.ok === 1, x?.err || 'rechazado con MODO_SOBRESCRIBIR_ELIMINADO_USAR_CONTEO_FISICO')
}

// ── S2/S3: funciones de dinero cerradas ─────────────────────────────────────
for (const [fn, cuerpo] of [
  ['registrar_cargo_cxc', { p_cliente_id: crypto.randomUUID(), p_despacho_id: null, p_monto_usd: 1, p_descripcion: 'x', p_registrado_por: crypto.randomUUID() }],
  ['registrar_pago_comision', { p_comision_id: crypto.randomUUID(), p_cuenta_id: cuenta, p_usuario_id: crypto.randomUUID() }],
  ['facturar_prestamo_atomico', { p_cuenta_id: cuenta, p_prestamo_id: crypto.randomUUID(), p_cantidad: 1, p_usuario_id: crypto.randomUUID(), p_tasa_bcv: 1, p_idempotency_key: crypto.randomUUID() }],
  ['restaurar_respaldo_atomico', { p_cuenta_id: cuenta, p_tablas: { productos: [] } }],
  ['buscar_productos_hibrido', { p_busqueda: 'tubo' }],
]) {
  for (const [quien, token] of [['sin sesión', ANON], ['con sesión', jwt]]) {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    anotar(`S2/S3 ${fn} ${quien}`, r.status === 401 || r.status === 403 || r.status === 404, `HTTP ${r.status}`)
  }
}

// ── S4: nadie escribe directo en tablas críticas ────────────────────────────
{
  const tablas = ['productos', 'inventario_movimientos', 'notas_despacho', 'notas_despacho_items', 'cliente_prestamos', 'despacho_devoluciones', 'despacho_devolucion_intercambios', 'cuentas_por_cobrar']
  const filas = await sqlStaging(`SELECT t, has_table_privilege('authenticated','public.'||t,'INSERT') OR has_table_privilege('authenticated','public.'||t,'UPDATE') OR has_table_privilege('authenticated','public.'||t,'DELETE') AS escribe FROM unnest(ARRAY[${tablas.map(t => `'${t}'`).join(',')}]) t`)
  const abiertas = filas.filter(f => f.escribe).map(f => f.t)
  anotar('S4 sin escritura directa', abiertas.length === 0, abiertas.length ? `abiertas: ${abiertas.join(', ')}` : `${tablas.length} tablas cerradas`)
}

// ── S1: lista de funciones abiertas a usuarios sin sesión ───────────────────
{
  const permitidas = ['listar_usuarios_login', 'tiene_gate_configurado', 'validar_gate_acceso', 'guarda_precios_ddl']
  const filas = await sqlStaging(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.prokind='f' AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')`)
  const extra = filas.map(f => f.proname).filter(n => !permitidas.includes(n))
  anotar('S1 funciones abiertas sin sesión', extra.length === 0, extra.length ? `de más: ${extra.join(', ')}` : `solo las ${filas.length} de ingreso/vigilancia`)
}

// ── S5: con sesión real de operador, nada de otras empresas ─────────────────
{
  const sbOp = createClient(URL_SB, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, 'X-Operator-Session': operadorToken } } })
  const tablas = ['productos', 'inventario_movimientos', 'notas_despacho', 'notas_despacho_items', 'cotizaciones', 'cotizacion_items', 'clientes', 'cuentas_por_cobrar', 'transportistas']
  const fugas = []
  let propios = 0
  for (const t of tablas) {
    const { count: ajenos, error } = await sbOp.from(t).select('id', { count: 'exact', head: true }).neq('cuenta_id', cuenta)
    const { count: mios } = await sbOp.from(t).select('id', { count: 'exact', head: true }).eq('cuenta_id', cuenta)
    propios += mios || 0
    if (error || ajenos > 0) fugas.push(`${t}: ${error ? error.message : ajenos}`)
  }
  for (const t of ['cliente_prestamos', 'despacho_devoluciones', 'despacho_devolucion_intercambios']) {
    const { data, error } = await sbOp.from(t).select('id').limit(2000)
    if (error) { fugas.push(`${t}: ${error.message}`); continue }
    const ids = (data || []).map(r => `'${r.id}'`)
    if (ids.length) {
      const padre = t === 'cliente_prestamos' ? `JOIN public.clientes c ON c.id=x.cliente_id WHERE c.cuenta_id <> '${cuenta}'` : `JOIN public.notas_despacho c ON c.id=x.despacho_id WHERE c.cuenta_id <> '${cuenta}'`
      const [{ n }] = await sqlStaging(`SELECT count(*)::int n FROM public.${t} x ${padre} AND x.id IN (${ids.join(',')})`)
      if (n > 0) fugas.push(`${t}: ${n}`)
    }
  }
  anotar('S5 empresa no ve datos ajenos (sesión real de operador)', fugas.length === 0 && propios > 0, fugas.length ? fugas.join('; ') : `0 filas ajenas; ${propios} filas propias visibles`)
}

// ── PR6: candado del préstamo (dos facturaciones a la vez esperan turno) ───
{
  const [pr] = await sqlStaging(`SELECT cp.id, c.cuenta_id, (SELECT u.id FROM public.usuarios u WHERE u.cuenta_id=c.cuenta_id AND u.activo AND u.rol IN ('administracion','jefe') LIMIT 1) adm
    FROM public.cliente_prestamos cp JOIN public.clientes c ON c.id=cp.cliente_id JOIN public.notas_despacho_items i ON i.id=cp.despacho_item_id
    WHERE cp.cantidad_prestada - coalesce(cp.cantidad_devuelta,0) - coalesce(cp.cantidad_facturada,0) >= 2 AND i.precio_unit_usd > 0 LIMIT 1`)
  const tx = (espera) => `BEGIN; SELECT public.facturar_prestamo_atomico('${pr.cuenta_id}','${pr.id}',1,'${pr.adm}',250,gen_random_uuid()); SELECT pg_sleep(${espera}); ROLLBACK;`
  const t0 = Date.now()
  const a = sqlStaging(tx(4), true).then(() => Date.now() - t0)
  await new Promise(r => setTimeout(r, 800))
  const b = sqlStaging(tx(0), true).then(() => Date.now() - t0)
  const [ta, tb] = await Promise.all([a, b])
  anotar('PR6 dos facturaciones simultáneas esperan turno', tb >= ta - 600, `primera terminó a los ${ta} ms, segunda a los ${tb} ms (la segunda esperó al candado)`)
}

// ── Resumen ─────────────────────────────────────────────────────────────────
const fallas = resultados.filter(r => !r.ok)
console.log(`\nResultado: ${resultados.length - fallas.length}/${resultados.length} OK${fallas.length ? ` — FALLAS: ${fallas.map(f => f.codigo).join(', ')}` : ''}`)
process.exit(fallas.length ? 1 : 0)
