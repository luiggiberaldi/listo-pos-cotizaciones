#!/usr/bin/env node
// scripts/apply-release17-produccion.mjs — aplica el release 17 (egreso de
// inventario al aprobar) al proyecto PRINCIPAL (producción). Orden obligatorio
// (docs/plans/2026-10-21-plan-produccion-release17-lote-erp.md §4):
// preflight read-only → pre-imágenes (backup de cuerpos vivos) → apply →
// backfill T6 → postflight → smoke read-only → evidencia.
//
// Canal: Management API HTTPS (mismo que scripts/apply-release19-produccion.mjs
// y scripts/apply-release17-staging.mjs). Credenciales:
// SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN desde .env — NUNCA se
// imprimen.
//
// MODO DE USO:
//   node scripts/apply-release17-produccion.mjs --dry-run-parse
//       Prueba en seco SIN red: huellas de los artefactos, firmas que se
//       instalan, archivos de pre-imagen y árbol de decisión.
//   node scripts/apply-release17-produccion.mjs
//       PRUEBA EN SECO contra producción (SOLO lectura: SELECT). Repite todo el
//       preflight de la ventana y termina con el veredicto LISTO / NO LISTO.
//       No muta nada. Es lo que se ejecuta antes de abrir la ventana.
//   PRODUCCION_RELEASE17_CONFIRM=APLICAR_RELEASE17_PRODUCCION \
//     RELEASE17_OPERADOR_ID=<uuid-de-un-operador-real> \
//     node scripts/apply-release17-produccion.mjs --apply
//       LA VENTANA REAL (muta la base): pre-imágenes → apply → backfill →
//       postflight → smoke. Exige la confirmación explícita por variable.
//
// Guardas:
//   * --apply exige PRODUCCION_RELEASE17_CONFIRM=APLICAR_RELEASE17_PRODUCCION.
//   * El destino sale de .supabase/project-ref y debe ser oyfyuszgjwcepjpngclv
//     (proyecto principal); jamás apunta a staging.
//   * Huellas SHA-256 de los artefactos verificadas antes de tocar nada
//     (supabase/release/main/17_egreso_inventario_SHA256SUMS.txt). Si un archivo
//     cambió, aborta: ese paquete ya no es el probado en staging.
//   * Estado previo: solo procede si las 6 firmas reemplazables están vivas, la
//     función NUEVA (revertir_despacho_inventario_atomica) está ausente y las
//     columnas nuevas no existen. Si el release ya está instalado, lo confirma y
//     sale 0; si solo falta el backfill, lo completa. Cualquier otro estado
//     aborta sin mutar nada (lección 262→263: nunca crear sobrecargas huérfanas).
//   * El operador del backfill (autor del kardex de migración) debe existir en
//     public.usuarios del destino — el de staging NO vale aquí. Se fija con
//     RELEASE17_OPERADOR_ID (y opcional RELEASE17_OPERADOR_NOMBRE); si falta o
//     no existe, la prueba en seco lista los operadores activos del destino.
//   * Despachos obsoletos excluidos del backfill (v_excluir_numeros en el SQL;
//     #1930, #1933, #2144 por decisión 2026-10-21): nunca mueven inventario.
//     La prueba en seco muestra el plan por despacho (DESCUENTA / SALTADO).
//   * Búsquedas de firmas por to_regprocedure(tipos) y comparaciones tolerantes
//     a nombres de parámetro: este Postgres devuelve los argumentos de identidad
//     como "p_x uuid, …" (lección del cutover release 19).
//
// Pre-imágenes: supabase/release/main/17_backup_cuerpos_produccion/*.live.sql
// (directorio APARTE del de staging para no pisar el material de rollback del
// cutover de staging) + stash en la BD `release_17_backup_cuerpos`.
// Evidencia: docs/operaciones/release17-produccion-cutover-<timestamp>.md y
// tmp/release17-produccion-evidence-<timestamp>.json. Exit 0 solo si el
// postflight queda completo.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const CONFIRM_VALUE = 'APLICAR_RELEASE17_PRODUCCION'
const EXPECTED_REF = 'oyfyuszgjwcepjpngclv'
const APPLY_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_aprobacion_apply.sql')
const BACKFILL_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_backfill.sql')
const POSTFLIGHT_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_postflight_readonly.sql')
const ROLLBACK_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_rollback_review.sql')
const PREIMG_DIR = path.join(ROOT, 'supabase/release/main/17_backup_cuerpos_produccion')
const SUMS_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_SHA256SUMS.txt')

// Función NUEVA del release 17 (T4): no existe antes del apply y por tanto no
// tiene pre-imagen. Si aparece viva sin el marcador del release, el estado del
// destino es desconocido y se aborta.
const FUNCIONES_NUEVAS = ['revertir_despacho_inventario_atomica']

const MODE = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--dry-run-parse') ? 'parse'
  : 'dry-run'

function parseEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    const i = line.indexOf('=')
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['\"]|['\"]$/g, '')
  }
  return out
}
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')
const sqlLiteral = (s) => "'" + String(s).replace(/'/g, "''") + "'"

// "p_x text DEFAULT 'a'" → "text"; "uuid, uuid" (COMMENT) → "uuid,uuid".
// Sirve tanto para las firmas del apply como para las que devuelve el servidor
// (que incluyen nombres de parámetro: "p_despacho_id uuid, …").
function normalizeArgs(raw) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of raw) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((a) => {
    const toks = a.replace(/\s+DEFAULT[\s\S]*$/i, '').trim().split(/\s+/).filter(Boolean)
    return (toks.length >= 2 ? toks.slice(1).join(' ') : toks[0] || '').toLowerCase()
  }).join(',')
}

// ── Huellas: los artefactos deben ser byte-idénticos a los probados en staging ──
const sums = {}
for (const line of fs.readFileSync(SUMS_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([0-9a-f]{64}) \*(.+)$/)
  if (m) sums[m[2]] = m[1]
}
function verifySums() {
  let allOk = true
  for (const [rel, want] of Object.entries(sums)) {
    const got = sha256(fs.readFileSync(path.join(ROOT, rel)))
    const ok = got === want
    console.log(`${ok ? 'OK  ' : 'FAIL'} huella ${rel} ${got.slice(0, 12)}…`)
    if (!ok) allOk = false
  }
  return allOk
}

// ── Firmas del apply: nombre + tipos (sin nombres de parámetro ni DEFAULT) ──
const applySrc = fs.readFileSync(APPLY_PATH, 'utf8')
const expected = []
for (const m of applySrc.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([\s\S]*?)\)\s*RETURNS/g)) {
  expected.push({ name: m[1], args: normalizeArgs(m[2]) })
}
if (!expected.length) { console.error('No se extrajeron firmas del apply'); process.exit(1) }
const reemplazables = expected.filter((e) => !FUNCIONES_NUEVAS.includes(e.name))
const nuevas = expected.filter((e) => FUNCIONES_NUEVAS.includes(e.name))

// Firmas que el apply marca con comentario 'Main egreso-inventario release 17'
// (las sobrecargas delegadas de editar 2-arg y 5-arg no llevan comentario a propósito).
const mainCommented = []
for (const m of applySrc.matchAll(/COMMENT ON FUNCTION public\.([a-z_]+)\(([^)]*)\)\s*IS\s+'([^']*)'/g)) {
  if (m[3].startsWith('Main egreso-inventario release 17')) {
    mainCommented.push({ name: m[1], args: normalizeArgs(m[2]) })
  }
}

// Nombre del archivo de pre-imagen: si una función tiene varios overloads en el
// apply, cada uno guarda su propio cuerpo (nunca se pisan — el rollback lo exige).
const nameCounts = {}
for (const e of reemplazables) nameCounts[e.name] = (nameCounts[e.name] || 0) + 1
const preimgFile = (e) => nameCounts[e.name] > 1
  ? `${e.name}_${e.args.split(',').length}args.live.sql`
  : `${e.name}.live.sql`

// Referencia a firma tolerante a nombres de parámetro (lección release 19):
// to_regprocedure entiende solo tipos, igual que nuestras firmas normalizadas.
const sigRef = (e) => `to_regprocedure(${sqlLiteral(`public.${e.name}(${e.args})`)})`

// ── Operador del backfill (autor del kardex de migración) ────────────────────
const backfillSrc0 = fs.readFileSync(BACKFILL_PATH, 'utf8')
const opIdMatch = backfillSrc0.match(/v_usuario_id\s+uuid\s+:=\s+'([0-9a-fA-F-]{36})'::uuid/)
const opNameMatch = backfillSrc0.match(/v_usuario_nombre\s+text\s+:=\s+'([^']*)'/)
const OPERADOR_ID = process.env.RELEASE17_OPERADOR_ID || (opIdMatch ? opIdMatch[1] : null)
const OPERADOR_NOMBRE = process.env.RELEASE17_OPERADOR_NOMBRE || (opNameMatch ? opNameMatch[1] : 'MIGRACIÓN release 17')

// ── Despachos obsoletos excluidos del backfill (decisión 2026-10-21) ─────────
// #1930, #1933, #2144 quedaron fuera del sistema: el backfill los saltea por
// completo (ni egreso, ni sello, ni movimiento) y NUNCA deben mover inventario.
const exclMatch = backfillSrc0.match(/v_excluir_numeros\s+integer\[\]\s+:=\s+ARRAY\[([^\]]*)\]/i)
if (!exclMatch) { console.error('ABORT: no se encontró v_excluir_numeros en el backfill (lista de obsoletos)'); process.exit(1) }
const NUMEROS_EXCLUIDOS = [...new Set(exclMatch[1].split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite))].sort((a, b) => a - b)
if (!OPERADOR_ID || !/^[0-9a-fA-F-]{36}$/.test(OPERADOR_ID)) {
  console.error('Operador del backfill no válido: fija RELEASE17_OPERADOR_ID (UUID de un operador real de producción).')
  process.exit(1)
}

if (MODE === 'parse') {
  console.log('== Dry-run parse (sin red, sin mutaciones) ==')
  const ok = verifySums()
  console.log(`\nFirmas REEMPLAZABLES que deben estar vivas antes del apply (${reemplazables.length}):`)
  for (const e of reemplazables) console.log(`  ${e.name}(${e.args}) → 17_backup_cuerpos_produccion/${preimgFile(e)}`)
  console.log(`\nFunciones NUEVAS del release (${nuevas.length}) — deben estar AUSENTES antes del apply:`)
  for (const e of nuevas) console.log(`  ${e.name}(${e.args})`)
  console.log(`\nMarcador de instalación 'Main egreso-inventario release 17' en ${mainCommented.length} firmas:`)
  for (const c of mainCommented) console.log(`  ${c.name}(${c.args})`)
  console.log(`\nOperador del backfill (autor del kardex de migración): ${OPERADOR_NOMBRE} · ${OPERADOR_ID}`)
  console.log(`Despachos excluidos del backfill (obsoletos, nunca mueven inventario): ${NUMEROS_EXCLUIDOS.map((n) => '#' + n).join(', ') || '(ninguno)'}`)
  console.log('\nÁrbol de decisión del instalador:')
  console.log('  1. Marcador release 17 vivo y 0 despachos sin lote → "YA INSTALADO", evidencia y exit 0.')
  console.log('  2. Marcador release 17 vivo con despachos sin lote → SOLO backfill → postflight.')
  console.log('  3. Sin marcador, 6 firmas reemplazables vivas, función nueva ausente y')
  console.log('     columnas nuevas ausentes → pre-imágenes → APPLY → backfill → postflight.')
  console.log('  4. Cualquier otro estado → ABORTA sin mutar nada.')
  process.exit(ok ? 0 : 1)
}

// ── Guardas previas ──────────────────────────────────────────────────────────
if (MODE === 'apply' && process.env.PRODUCCION_RELEASE17_CONFIRM !== CONFIRM_VALUE) {
  console.error(`ABORT: --apply exige PRODUCCION_RELEASE17_CONFIRM=${CONFIRM_VALUE}`)
  process.exit(1)
}
if (!verifySums()) {
  console.error('ABORT: las huellas de los artefactos no coinciden con las probadas en staging.')
  process.exit(1)
}
const env = parseEnv(path.join(ROOT, '.env'))
const TOKEN = env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN en .env'); process.exit(1) }
const REF = fs.readFileSync(path.join(ROOT, '.supabase/project-ref'), 'utf8').trim()
if (REF !== EXPECTED_REF) { console.error(`Destino inesperado: ${REF} (se exige producción ${EXPECTED_REF})`); process.exit(1) }
for (const f of [APPLY_PATH, BACKFILL_PATH, POSTFLIGHT_PATH, ROLLBACK_PATH]) {
  if (!fs.existsSync(f)) { console.error('Falta archivo: ' + path.relative(ROOT, f)); process.exit(1) }
}

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`
async function q(sql) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  let rows = null
  try { rows = JSON.parse(text) } catch { /* cuerpo no-JSON: se conserva como texto */ }
  return { ok: r.ok, status: r.status, body: text, rows }
}
const evidence = {
  tool: 'apply-release17-produccion.mjs',
  mode: MODE,
  project_ref: REF,
  environment: 'produccion',
  operador_backfill: { id: OPERADOR_ID, nombre: OPERADOR_NOMBRE },
  started_at: new Date().toISOString(),
  stages: [],
  asserts: [],
}
const record = (name, res) => {
  evidence.stages.push({ name, at: new Date().toISOString(), status: res.status, body: res.body.slice(0, 4000) })
  console.log(`\n== ${name} ==\nstatus=${res.status} ${res.body.slice(0, 300).replace(/\s+/g, ' ')}`)
}
let failed = false
function assert(cond, label, detail = '') {
  evidence.asserts.push({ label, ok: !!cond, detail: String(detail).slice(0, 500) })
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`)
  if (!cond) failed = true
}
function warn(label, detail = '') {
  evidence.asserts.push({ label: `AVISO ${label}`, ok: true, detail: String(detail).slice(0, 500) })
  console.log(`AVISO ${label}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`)
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const names = [...new Set(expected.map((e) => e.name))]

function liveSignaturesSql(list) {
  return `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (${[...new Set(list.map((e) => e.name))].map(sqlLiteral).join(',')})
ORDER BY p.proname, args`
}

// ═══ PARTE SOLO LECTURA (dry-run y apply la comparten) ═══════════════════════
const pre1 = await q('SELECT current_database() AS db, now() AS ts')
record('PRE 1: conexión', pre1)
assert(pre1.ok, 'PRE: conexión a producción OK', pre1.body)

// Firmas vivas — el servidor devuelve los argumentos con nombres de parámetro,
// así que se normalizan igual que las del apply antes de comparar.
const pre2 = await q(liveSignaturesSql(expected))
record('PRE 2: firmas vivas', pre2)
{
  const live = (pre2.rows || []).map((r) => ({ name: r.proname, args: normalizeArgs(String(r.args)) }))
  for (const e of reemplazables) {
    // CREATE OR REPLACE solo reemplaza el cuerpo si la firma exacta ya existe;
    // si falta, el apply crearía una sobrecarga nueva que los call-sites no usan.
    const match = live.find((l) => l.name === e.name && l.args === e.args)
    assert(!!match, `PRE: firma reemplazable viva para ${e.name}(${e.args})`, JSON.stringify(live.filter((l) => l.name === e.name)))
  }
  // La función nueva puede estar presente legítimamente si el release ya se instaló
  // (re-ejecución de la ventana). Su ausencia solo es exigible en estado limpio; la
  // validación definitiva va después, contra el estado detectado (lección ventana
  // 2026-10-22: la re-verificación trataba "ya instalado" como si fuera un fallo).
  for (const e of nuevas) {
    const match = live.find((l) => l.name === e.name && l.args === e.args)
    if (!match) assert(true, `PRE: función NUEVA ${e.name}(${e.args}) ausente (estado limpio)`)
    else console.log(`INFO  PRE: función NUEVA ${e.name}(${e.args}) presente — se valida contra el estado detectado`)
  }
}

const pre3 = await q(`SELECT count(*)::int AS n FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notas_despacho'
  AND column_name IN ('egreso_lote_id','alerta_stock','alerta_stock_items')`)
record('PRE 3: columnas nuevas del release', pre3)
const columnasNuevas = Number(pre3.rows?.[0]?.n) === 3
console.log(`INFO  Columnas nuevas (egreso_lote_id, alerta_stock, alerta_stock_items): ${columnasNuevas ? 'presentes' : 'ausentes (estado limpio)'}`)

const pre4 = await q(`SELECT id, nombre, rol FROM public.usuarios
WHERE id = ${sqlLiteral(OPERADOR_ID)} AND activo = true`)
record(`PRE 4: operador del backfill (${OPERADOR_NOMBRE})`, pre4)
const operadorOk = (pre4.rows || []).length === 1
assert(operadorOk,
  `PRE: el operador del backfill existe y está activo en el destino (${OPERADOR_ID})`, pre4.body)
if (!operadorOk) {
  // El operador de staging NO vale en producción: sugerir los activos del destino.
  const cand = await q(`SELECT id, nombre, rol FROM public.usuarios
WHERE activo = true ORDER BY rol, nombre LIMIT 10`)
  record('PRE 4b: operadores activos del destino (candidatos)', cand)
  console.log('INFO  Fija RELEASE17_OPERADOR_ID con uno de estos operadores activos de producción:')
  for (const c of cand.rows || []) console.log(`      ${c.id}  ${c.nombre}  (${c.rol})`)
}

// Conteos previos. El conteo "backfill_objetivos" usa la columna nueva, que solo
// existe cuando el release ya se aplicó: si falta, no hay nada que migrar aún.
const pre5 = await q(`SELECT
  (SELECT count(*)::int FROM public.notas_despacho WHERE estado IN ('despachada','entregada')) AS despachos_cerrados,
  (SELECT count(*)::int FROM public.inventario_movimientos) AS kardex_total,
  (SELECT COALESCE(SUM(stock_actual),0)::numeric FROM public.productos) AS stock_total`)
record('PRE 5: conteos previos', pre5)
let backfillObjetivos = null
if (columnasNuevas) {
  const pre5b = await q(`SELECT count(*)::int AS backfill_objetivos
FROM public.notas_despacho
WHERE estado IN ('despachada','entregada') AND egreso_lote_id IS NULL
  AND numero <> ALL(ARRAY[${NUMEROS_EXCLUIDOS.join(',')}]::integer[])`)
  record('PRE 5b: despachos pendientes de egreso (backfill)', pre5b)
  backfillObjetivos = Number(pre5b.rows?.[0]?.backfill_objetivos || 0)
}

// ── PLAN de inventario (solo lectura): qué descontaría el backfill y qué no ──
{
  const filtroLote = columnasNuevas ? 'egreso_lote_id IS NULL AND ' : ''
  const plan = await q(`SELECT nd.numero,
  COALESCE(SUM(ndi.cantidad),0)::numeric AS unidades
FROM public.notas_despacho nd
LEFT JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
  AND ndi.producto_id IS NOT NULL
  AND COALESCE(ndi.origen,'inventario') = 'inventario'
  AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
WHERE ${filtroLote}nd.estado = 'despachada'
GROUP BY nd.numero ORDER BY nd.numero`)
  record('PLAN: despachos "en vuelo" y su descuento', plan)
  console.log('\nPLAN de inventario del backfill ("en vuelo"):')
  let unidadesDescuento = 0
  for (const r of plan.rows || []) {
    const num = Number(r.numero), u = Number(r.unidades) || 0
    const excluido = NUMEROS_EXCLUIDOS.includes(num)
    if (!excluido) unidadesDescuento += u
    console.log(`  #${num} — ${excluido ? 'SALTADO (obsoleto por decisión: nunca mueve inventario)' : `DESCUENTA ${u} unidades`}`)
  }
  console.log(`  TOTAL que bajaría del stock: ${unidadesDescuento} unidades (solo los no excluidos)`)
  const sellar = await q(`SELECT count(*)::int AS n FROM public.notas_despacho
WHERE ${filtroLote}estado = 'entregada'`)
  record('PLAN: entregadas que solo se sellan (sin tocar stock)', sellar)
  console.log(`  Entregadas que solo se sellan SIN tocar stock: ${Number(sellar.rows?.[0]?.n || 0)}`)
}

// Marcador de instalación en las firmas canónicas del release.
const marcador = []
for (const c of mainCommented) {
  const res = await q(`SELECT obj_description(p.oid, 'pg_proc') AS comentario
FROM pg_proc p WHERE p.oid = ${sigRef(c)}`)
  marcador.push(String(res.rows?.[0]?.comentario || '').startsWith('Main egreso-inventario release 17'))
}
const instalado = marcador.length === mainCommented.length && marcador.every(Boolean)
console.log(`\nEstado detectado: ${instalado ? 'release 17 INSTALADO' : 'release 17 NO instalado'}`
  + ` · backfill pendiente: ${backfillObjetivos === null ? 'no aplica (columnas ausentes)' : backfillObjetivos + ' despacho(s)'} (sin contar los obsoletos ${NUMEROS_EXCLUIDOS.map((n) => '#' + n).join(', ') || '—'})`)

// Validez de la función nueva contra el estado detectado (ver nota en PRE 2).
{
  const live = (pre2.rows || []).map((r) => ({ name: r.proname, args: normalizeArgs(String(r.args)) }))
  for (const e of nuevas) {
    const presente = live.some((l) => l.name === e.name && l.args === e.args)
    assert(instalado ? presente : !presente,
      instalado
        ? `PRE: función NUEVA ${e.name}(${e.args}) presente (coherente con release instalado)`
        : `PRE: función NUEVA ${e.name}(${e.args}) ausente (estado limpio)`,
      JSON.stringify(live.filter((l) => l.name === e.name)))
  }
}

// Veredicto del estado (árbol de decisión) — solo mira el ESTADO del destino,
// no las aserciones de configuración (p. ej. el operador del backfill).
let veredicto = null
const estadoLimpio = !instalado && !columnasNuevas && reemplazables.every((e) => {
  const rows = (pre2.rows || []).filter((r) => r.proname === e.name).map((r) => normalizeArgs(String(r.args)))
  return rows.includes(e.args)
}) && nuevas.every((e) => {
  const rows = (pre2.rows || []).filter((r) => r.proname === e.name).map((r) => normalizeArgs(String(r.args)))
  return !rows.includes(e.args)
})
if (instalado && backfillObjetivos === 0) veredicto = 'already'
else if (instalado && backfillObjetivos !== null && backfillObjetivos > 0) veredicto = 'backfill-pendiente'
else if (estadoLimpio) veredicto = 'listo'
else veredicto = 'abort'
assert(veredicto !== 'abort', 'PRE: estado previo reconocido (listo / backfill-pendiente / ya instalado)', String(veredicto))

// Postflight read-only. Solo tiene sentido si las columnas del release existen;
// en un destino limpio su ausencia NO es un fallo.
if (columnasNuevas || instalado) {
  const postSrc = fs.readFileSync(POSTFLIGHT_PATH, 'utf8')
  const postRes = await q(postSrc)
  record('POSTFLIGHT (read-only): 17_egreso_inventario_postflight_readonly.sql', postRes)
  assert(postRes.ok, 'POSTFLIGHT: ejecutado sin errores', postRes.body)
} else {
  console.log('INFO  POSTFLIGHT: no aplica aún (el release 17 no está instalado en el destino)')
}

if (MODE !== 'apply') {
  // ── Prueba en seco: NADA se muta. Evidencia y veredicto. ──
  evidence.finished_at = new Date().toISOString()
  evidence.veredicto = veredicto
  evidence.result = failed || veredicto === 'abort' ? 'NO LISTO'
    : veredicto === 'already' ? 'YA INSTALADO' : 'LISTO PARA LA VENTANA'
  const evJson = path.join(ROOT, `tmp/release17-produccion-dryrun-${stamp()}.json`)
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  fs.writeFileSync(evJson, JSON.stringify(evidence, null, 2))
  console.log(`\n== PRUEBA EN SECO (sin mutaciones) ==`)
  console.log(`Veredicto: ${evidence.result}`)
  if (evidence.result === 'LISTO PARA LA VENTANA') {
    console.log('La ventana real se ejecuta con:')
    console.log(`  PRODUCCION_RELEASE17_CONFIRM=${CONFIRM_VALUE} RELEASE17_OPERADOR_ID=${OPERADOR_ID} \\`)
    console.log('    node scripts/apply-release17-produccion.mjs --apply')
    console.log('(antes: backup de producción con restauración probada y aviso al equipo)')
  }
  console.log(`Evidencia: ${path.relative(ROOT, evJson)}`)
  process.exit(evidence.result === 'LISTO PARA LA VENTANA' || evidence.result === 'YA INSTALADO' ? 0 : 1)
}

// ═══ PARTE QUE MUTA (solo --apply con confirmación explícita) ════════════════
if (veredicto === 'abort' || failed) {
  console.error('\nABORT: preflight con fallos o estado inesperado — NO se aplica nada.')
  evidence.finished_at = new Date().toISOString()
  evidence.result = 'ABORT'
  fs.writeFileSync(path.join(ROOT, `tmp/release17-produccion-evidence-${stamp()}.json`), JSON.stringify(evidence, null, 2))
  process.exit(1)
}

// ── Pre-imágenes (backup de cuerpos vivos, SHA-256) ──────────────────────────
let preimgCount = 0
if (veredicto === 'listo') {
  fs.mkdirSync(PREIMG_DIR, { recursive: true })
  for (const e of reemplazables) {
    const res = await q(`SELECT pg_get_functiondef(p.oid) AS def
FROM pg_proc p WHERE p.oid = ${sigRef(e)}`)
    const def = res.rows?.[0]?.def
    if (!def) { assert(false, `PRE-IMG: cuerpo vivo de ${e.name}(${e.args})`, res.body); continue }
    const file = path.join(PREIMG_DIR, preimgFile(e))
    fs.writeFileSync(file, def + '\n')
    preimgCount++
    evidence.stages.push({ name: `PRE-IMG ${e.name}(${e.args})`, at: new Date().toISOString(), sha256: sha256(def), file: path.relative(ROOT, file) })
    console.log(`OK   PRE-IMG ${e.name}(${e.args}) → ${path.relative(ROOT, file)} sha256=${sha256(def).slice(0, 12)}…`)
  }
  assert(preimgCount === reemplazables.length,
    `PRE-IMG: ${reemplazables.length} cuerpos vivos respaldados`, `guardados=${preimgCount}`)
}

// ── Apply ───────────────────────────────────────────────────────────────────
if (failed) {
  console.error('\nABORT: pre-imágenes con fallos — NO se aplica nada.')
  evidence.finished_at = new Date().toISOString()
  evidence.result = 'ABORT'
  fs.writeFileSync(path.join(ROOT, `tmp/release17-produccion-evidence-${stamp()}.json`), JSON.stringify(evidence, null, 2))
  process.exit(1)
}

if (veredicto === 'listo') {
  const applyRes = await q(applySrc)
  record('APPLY: 17_egreso_inventario_aprobacion_apply.sql', applyRes)
  assert(applyRes.ok, 'APPLY: SQL aplicado sin errores', applyRes.body)
}

// ── Backfill T6 (idempotente; se re-ejecuta para probarlo) ──────────────────
let backfillSql = fs.readFileSync(BACKFILL_PATH, 'utf8')
if (process.env.RELEASE17_OPERADOR_ID) {
  const antes = backfillSql
  backfillSql = backfillSql
    .replace(/v_usuario_id\s+uuid\s+:=\s+'[0-9a-fA-F-]{36}'::uuid/, `v_usuario_id     uuid := '${OPERADOR_ID}'::uuid`)
    .replace(/v_usuario_nombre\s+text\s+:=\s+'[^']*'/, `v_usuario_nombre text := '${OPERADOR_NOMBRE.replace(/'/g, "''")}'`)
  if (backfillSql === antes) { console.error('ABORT: no se pudo fijar el operador en el backfill'); process.exit(1) }
}
const backfillRes = await q(backfillSql)
record(`BACKFILL (operador ${OPERADOR_NOMBRE})`, backfillRes)
assert(backfillRes.ok, 'BACKFILL: ejecutado sin errores', backfillRes.body)
const backfillAgain = await q(backfillSql)
record('BACKFILL: re-ejecución (idempotencia)', backfillAgain)
assert(backfillAgain.ok, 'BACKFILL: re-ejecución sin errores (sin doble efecto)', backfillAgain.body)

// ── Postflight + aserciones de cierre ────────────────────────────────────────
const post2 = await q(fs.readFileSync(POSTFLIGHT_PATH, 'utf8'))
record('POSTFLIGHT (cierre): 17_egreso_inventario_postflight_readonly.sql', post2)
assert(post2.ok, 'POSTFLIGHT: ejecutado sin errores', post2.body)

for (const c of mainCommented) {
  const res = await q(`SELECT obj_description(p.oid, 'pg_proc') AS comentario
FROM pg_proc p WHERE p.oid = ${sigRef(c)}`)
  const comentario = res.rows?.[0]?.comentario || ''
  assert(String(comentario).startsWith('Main egreso-inventario release 17'),
    `POST: marcador release 17 en ${c.name}(${c.args})`, res.body)
}

const post3 = await q(`SELECT p.proname,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (${names.map(sqlLiteral).join(',')})`)
{
  const rows = post3.rows || []
  assert(rows.length > 0 && rows.every((r) => r.svc === true && r.anon === false && r.auth === false),
    'POST: EXECUTE solo service_role en las RPCs del release', post3.body)
}

const post4 = await q(`SELECT COALESCE(array_agg(nd.numero ORDER BY nd.numero), '{}') AS numeros
FROM public.notas_despacho nd
WHERE nd.estado IN ('despachada','entregada') AND nd.egreso_lote_id IS NULL`)
{
  let numeros = post4.rows?.[0]?.numeros ?? []
  if (typeof numeros === 'string') { try { numeros = JSON.parse(numeros) } catch { numeros = [] } }
  numeros = (Array.isArray(numeros) ? numeros : []).map(Number)
  const inesperados = numeros.filter((n) => !NUMEROS_EXCLUIDOS.includes(n))
  assert(inesperados.length === 0,
    `POST: 0 despachos sin lote salvo los obsoletos decididos (${NUMEROS_EXCLUIDOS.map((n) => '#' + n).join(', ') || 'ninguno'})`,
    `sin lote: ${JSON.stringify(numeros)} · inesperados: ${JSON.stringify(inesperados)}`)
}

// Doble efecto del backfill = el mismo par (lote, producto) repetido. Un lote de
// migración puede traer VARIOS movimientos legítimos: uno por producto del despacho
// (#4161 con 5 productos espeja 5 movimientos en su lote). Contar movimientos por
// lote marcaba falso positivo justo en los despachos multi-producto (lección de la
// ventana 2026-10-22: los datos eran correctos; la comprobación, no).
const post5 = await q(`SELECT count(*)::int AS duplicados
FROM (SELECT lote_id, producto_id FROM public.inventario_movimientos
      WHERE motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%'
      GROUP BY lote_id, producto_id HAVING count(*) > 1) x`)
assert(Number(post5.rows?.[0]?.duplicados) === 0,
  'POST: backfill sin efecto doble (ningún par lote+producto repetido)', post5.body)

const post6 = await q(`SELECT count(*)::int AS n FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notas_despacho'
  AND column_name IN ('egreso_lote_id','alerta_stock','alerta_stock_items')`)
assert(Number(post6.rows?.[0]?.n) === 3, 'POST: columnas nuevas presentes (egreso_lote_id, alerta_stock, alerta_stock_items)', post6.body)

// Nota (runbook de cutover §3): la comprobación textual "¿confirmar_entrega toca
// productos?" da true por la rama de ENTREGA DIRECTA desde pendiente, que sí egresa
// a propósito. La entrega normal desde despachada no toca inventario; se deja como
// aviso, no como aserción.
warn('confirmar_entrega_inventario_atomica: su rama de entrega directa sí egresa por diseño (no es regresión)')

const post7 = await q(`SELECT
  (SELECT count(*)::int FROM public.inventario_movimientos WHERE motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%') AS movimientos_migracion,
  (SELECT COALESCE(SUM(cantidad),0)::numeric FROM public.inventario_movimientos WHERE motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%') AS unidades_migracion`)
record('POST: resumen del kardex de migración', post7)

// ── Smoke read-only sobre despachos reales ───────────────────────────────────
const smoke = await q(`SELECT nd.id, nd.numero, nd.estado, nd.egreso_lote_id,
  (SELECT count(*)::int FROM public.inventario_movimientos m WHERE m.lote_id = nd.egreso_lote_id) AS movimientos
FROM public.notas_despacho nd
WHERE nd.egreso_lote_id IS NOT NULL
ORDER BY nd.numero DESC LIMIT 3`)
record('SMOKE: despachos reales con lote de egreso', smoke)
assert((smoke.rows || []).length > 0, 'SMOKE: hay despachos reales con lote de egreso (el backfill dejó huella)', smoke.body)

// ── Evidencia ────────────────────────────────────────────────────────────────
evidence.finished_at = new Date().toISOString()
evidence.result = failed ? 'FAIL' : 'PASS'
evidence.pre_images = preimgCount
const evJson = path.join(ROOT, `tmp/release17-produccion-evidence-${stamp()}.json`)
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
fs.writeFileSync(evJson, JSON.stringify(evidence, null, 2))
const md = [
  `# Cutover release 17 (egreso al aprobar) en PRODUCCIÓN — ${evidence.started_at}`,
  ``,
  `- Proyecto: \`${REF}\` (principal) · Resultado: **${evidence.result}**`,
  `- Aplicado por: scripts/apply-release17-produccion.mjs (Management API HTTPS)`,
  `- Modo: ${veredicto}`,
  `- Operador del backfill (autor del kardex de migración): ${OPERADOR_NOMBRE} · \`${OPERADOR_ID}\``,
  `- Pre-imágenes: \`supabase/release/main/17_backup_cuerpos_produccion/*.live.sql\` (${preimgCount} cuerpos)`,
  `- Rollback: \`supabase/release/main/17_egreso_inventario_rollback_review.sql\` (guards + reingreso espejo del backfill)`,
  `- Evidencia JSON: \`${path.relative(ROOT, evJson)}\``,
  ``,
  `## Aserciones`,
  ...evidence.asserts.map((a) => `- ${a.ok ? '✅' : '❌'} ${a.label}${a.ok ? '' : ` — \`${a.detail}\``}`),
  ``,
  `## Etapas`,
  ...evidence.stages.map((s) => `### ${s.name} (${s.at})\n\`\`\`\n${String(s.body || s.sha256 || '').slice(0, 1200)}\n\`\`\``),
  ``,
].join('\n')
const evMd = path.join(ROOT, `docs/operaciones/release17-produccion-cutover-${stamp()}.md`)
fs.writeFileSync(evMd, md)
console.log(`\nEvidencia: ${path.relative(ROOT, evMd)} · ${path.relative(ROOT, evJson)}`)
console.log(failed ? 'RESULTADO: FAIL' : 'RESULTADO: PASS')
process.exit(failed ? 1 : 0)
