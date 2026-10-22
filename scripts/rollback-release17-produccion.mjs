#!/usr/bin/env node
// scripts/rollback-release17-produccion.mjs — REVERSIÓN DE EMERGENCIA del release 17
// (egreso de inventario al aprobar) en PRODUCCIÓN. Empaqueta el plan B del plan §5 en
// UN solo comando, con su prueba en seco. La reversión de la APLICACIÓN (revert del
// commit de app) es un paso aparte que va coordinado en la misma ventana.
//
// Qué hace (modo --apply):
//   1. Guardas: destino correcto, paquete de rollback con su marca de propiedad,
//      pre-imágenes de las 6 funciones presentes.
//   2. Ejecuta 17_egreso_inventario_rollback_review.sql (sin su gate REVIEW_ONLY, que se
//      verifica byte a byte antes de retirarlo): reingreso espejo de los lotes de MIGRACIÓN
//      (el kardex jamás se borra; la inversión se registra como 'ROLLBACK release 17'),
//      limpieza de sellos de migración y de sellos legado.
//   3. Restaura los 6 cuerpos previos de funciones desde las pre-imágenes
//      (el modelo viejo: descuento al entregar).
//   4. Elimina revertir_despacho_inventario_atomica (no existía antes; si la app nueva
//      quedara viva un momento, su llamada cae al camino legacy en vez de ejecutar
//      semántica nueva contra un modelo viejo).
//   5. Verifica el retorno: sellos de migración en cero, inversión cuadrada por producto,
//      cuerpos idénticos a las pre-imágenes, función nueva ausente.
//   6. Evidencia en docs/operaciones/release17-rollback-<ts>.md + tmp/*.json.
//
// Las columnas egreso_lote_id/alerta_stock/alerta_stock_items se CONSERVAN (evidencia),
// decisión del paquete de rollback. Los despachos obsoletos (#1930, #1933, #2144) nunca
// tuvieron lote: este rollback no los toca.
//
// MODO DE USO:
//   node scripts/rollback-release17-produccion.mjs [--preimagenes <dir>]
//       PRUEBA EN SECO (SOLO lectura): qué se revertiría, cuántas unidades volverían,
//       qué sellos se limpian y qué cuerpos se restauran → veredicto LISTO / NO APLICA.
//   PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=REVERTIR_RELEASE17_PRODUCCION \
//     node scripts/rollback-release17-produccion.mjs --apply [--preimagenes <dir>]
//       LA REVERSIÓN REAL. Exige la confirmación explícita por variable.
//   node scripts/rollback-release17-produccion.mjs --local-pg "postgresql://..." ...
//       MODO LOCAL DE PRUEBA (usado SOLO por el ensayo scripts/test-release17-rollback-local.mjs):
//       habla con un PostgreSQL local en vez de la Management API. Nunca toca producción.
//
// Pre-imágenes: por defecto supabase/release/main/17_backup_cuerpos_produccion/*.live.sql
// (las que captura el instalador en la ventana); fallback 17_backup_cuerpos/. Con
// --preimagenes se señala otra carpeta (el ensayo local usa una temporal).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const CONFIRM_VALUE = 'REVERTIR_RELEASE17_PRODUCCION'
const EXPECTED_REF = 'oyfyuszgjwcepjpngclv'
const ROLLBACK_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_rollback_review.sql')
const PREIMG_DEFAULTS = [
  path.join(ROOT, 'supabase/release/main/17_backup_cuerpos_produccion'),
  path.join(ROOT, 'supabase/release/main/17_backup_cuerpos'),
]
const FUNCIONES_PREIMAGEN = [
  { args: 'uuid,uuid,text,text,boolean', file: 'aprobar_despacho_inventario_atomico.live.sql', name: 'aprobar_despacho_inventario_atomico' },
  { args: 'uuid,uuid,text,text,numeric,boolean', file: 'confirmar_entrega_inventario_atomica.live.sql', name: 'confirmar_entrega_inventario_atomica' },
  { args: 'uuid,text,uuid,text,text', file: 'revertir_entrega_inventario_atomica.live.sql', name: 'revertir_entrega_inventario_atomica' },
  { args: 'uuid,jsonb,uuid,text,text,text', file: 'editar_despacho_profundidad_6args.live.sql', name: 'editar_despacho_profundidad' },
  { args: 'uuid,jsonb,uuid,text,text', file: 'editar_despacho_profundidad_5args.live.sql', name: 'editar_despacho_profundidad' },
  { args: 'uuid,jsonb', file: 'editar_despacho_profundidad_2args.live.sql', name: 'editar_despacho_profundidad' },
]
const FUNCION_NUEVA = { name: 'revertir_despacho_inventario_atomica', args: 'uuid,text,uuid,text,text' }
// Gate REVIEW_ONLY del paquete: se verifica byte a byte y SOLO entonces se retira.
const GATE = `DO $review_gate$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 17_egreso_inventario_rollback_review.sql requiere aprobacion explicita de rollback';
END;
$review_gate$;`

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }
const APPLY = has('--apply')
const LOCAL_PG = val('--local-pg') || null
const PREIMG_DIR = val('--preimagenes') || PREIMG_DEFAULTS.find((d) => fs.existsSync(d)) || PREIMG_DEFAULTS[0]

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
// md5 como el que calcula PostgreSQL sobre pg_get_functiondef (ambos lados con trim).
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const sqlLiteral = (s) => "'" + String(s).replace(/'/g, "''") + "'"
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)

// ── Transporte: Management API (producción) o PostgreSQL local (solo ensayo) ──
let q, close = async () => {}
let destino = null
if (LOCAL_PG) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: LOCAL_PG })
  await client.connect()
  // node-pg puede devolver un arreglo de Result en consultas multi-sentencia.
  q = async (sql) => {
    const res = await client.query(sql)
    const ultimo = Array.isArray(res) ? res[res.length - 1] : res
    return (ultimo && ultimo.rows) || []
  }
  close = async () => client.end()
  destino = 'PostgreSQL LOCAL de prueba (nunca producción)'
  console.log('⚠️  MODO LOCAL DE PRUEBA — este comando NO toca producción.')
} else {
  const parseEnv = (file) => {
    const out = {}
    if (!fs.existsSync(file)) return out
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      const i = line.indexOf('=')
      if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['\"]|['\"]$/g, '')
    }
    return out
  }
  const env = parseEnv(path.join(ROOT, '.env'))
  const TOKEN = env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN
  if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN en .env'); process.exit(1) }
  const REF = fs.readFileSync(path.join(ROOT, '.supabase/project-ref'), 'utf8').trim()
  if (REF !== EXPECTED_REF) { console.error(`Destino inesperado: ${REF} (se exige producción ${EXPECTED_REF})`); process.exit(1) }
  const API = `https://api.supabase.com/v1/projects/${REF}/database/query`
  q = async (sql) => {
    const r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`API ${r.status}: ${text.slice(0, 400)}`)
    return JSON.parse(text)
  }
  destino = `PRODUCCIÓN ${REF}`
}

// ── Operador autor de los movimientos de reversión (usuario_id NOT NULL+FK) ──
const sqlRollbackSrc = fs.readFileSync(ROLLBACK_PATH, 'utf8')
const opMatch = sqlRollbackSrc.match(/v_usuario_id\s+uuid\s+:=\s+'([0-9a-fA-F-]{36})'::uuid/)
const OPERADOR_ID = process.env.RELEASE17_OPERADOR_ID || (opMatch ? opMatch[1] : null)
if (!OPERADOR_ID || !/^[0-9a-fA-F-]{36}$/.test(OPERADOR_ID)) {
  console.error('Operador de la reversión no válido: fija RELEASE17_OPERADOR_ID (UUID de un operador real de producción).')
  process.exit(1)
}

// ── Pre-imágenes ─────────────────────────────────────────────────────────────
const preimgs = []
for (const e of FUNCIONES_PREIMAGEN) {
  const p = path.join(PREIMG_DIR, e.file)
  const ok = fs.existsSync(p)
  preimgs.push({ ...e, path: p, sql: ok ? fs.readFileSync(p, 'utf8') : null, md5: ok ? md5(fs.readFileSync(p, 'utf8').trim()) : null })
}

const evidence = { tool: 'rollback-release17-produccion.mjs', modo: APPLY ? 'apply' : 'dry-run', destino, preimagenes_dir: path.relative(ROOT, PREIMG_DIR), started_at: new Date().toISOString(), asserts: [], stages: [] }
let failed = false
const ok = (label, cond, detail = '') => {
  evidence.asserts.push({ label, ok: !!cond, detail: String(detail).slice(0, 400) })
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond || !detail ? '' : ' — ' + String(detail).slice(0, 200)}`)
  if (!cond) failed = true
}
const info = (m) => console.log(`INFO  ${m}`)
const record = (name, rows) => evidence.stages.push({ name, at: new Date().toISOString(), rows: JSON.stringify(rows ?? []).slice(0, 3000) })

console.log(`== Reversión de emergencia release 17 — ${APPLY ? 'APPLY' : 'PRUEBA EN SECO'} · ${destino} ==`)

// ═══ PARTE SOLO LECTURA (dry-run y apply la comparten) ═══════════════════════
const estado = await q(`SELECT
  (SELECT count(*)::int FROM information_schema.columns
   WHERE table_schema='public' AND table_name='notas_despacho'
     AND column_name IN ('egreso_lote_id','alerta_stock','alerta_stock_items')) AS columnas_nuevas,
  (SELECT count(*)::int FROM public.inventario_movimientos
   WHERE motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%') AS movimientos_migracion,
  (SELECT COALESCE(SUM(cantidad),0)::numeric FROM public.inventario_movimientos
   WHERE motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%') AS unidades_migracion,
  (SELECT count(*)::int FROM public.inventario_movimientos
   WHERE motivo LIKE 'ROLLBACK release 17%') AS movimientos_rollback_previos`)
record('estado', estado)
const st = estado[0]
ok('el release 17 está instalado (columnas nuevas presentes)', Number(st.columnas_nuevas) === 3, JSON.stringify(st))
if (Number(st.movimientos_rollback_previos) > 0) {
  info(`ya hay ${st.movimientos_rollback_previos} movimientos de ROLLBACK previos — revisar si la reversión ya se hizo (idempotencia: solo se revertiría lo aún vigente)`)
}

const plan = await q(`SELECT
  (SELECT count(*)::int FROM public.notas_despacho nd
    WHERE nd.estado IN ('despachada','entregada')
      AND nd.egreso_lote_id = md5('migra-egreso-17-' || nd.id)::uuid) AS despachos_migracion,
  (SELECT COALESCE(SUM(ndi.cantidad),0)::numeric FROM public.notas_despacho nd
    JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
    WHERE nd.estado IN ('despachada','entregada')
      AND nd.egreso_lote_id = md5('migra-egreso-17-' || nd.id)::uuid
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen,'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE) AS unidades_por_devolver,
  (SELECT count(*)::int FROM public.notas_despacho nd
    WHERE nd.estado = 'entregada'
      AND nd.egreso_lote_id = md5('migra-egreso-17-legado-' || nd.id)::uuid
      AND NOT EXISTS (SELECT 1 FROM public.inventario_movimientos m WHERE m.lote_id = nd.egreso_lote_id)) AS sellos_legado,
  (SELECT count(*)::int FROM public.notas_despacho nd
    WHERE nd.egreso_lote_id IS NOT NULL
      AND nd.egreso_lote_id IS DISTINCT FROM md5('migra-egreso-17-' || nd.id)::uuid
      AND nd.egreso_lote_id IS DISTINCT FROM md5('migra-egreso-17-legado-' || nd.id)::uuid) AS trafico_nuevo`)
record('plan de reversión', plan)
const pl = plan[0]
console.log(`\nPLAN de reversión:`)
console.log(`  Despachos de MIGRACIÓN que reingresan stock: ${pl.despachos_migracion} (${pl.unidades_por_devolver} unidades)`)
console.log(`  Sellos legado que se limpian (sin movimiento): ${pl.sellos_legado}`)
console.log(`  Despachos con egreso de tráfico NUEVO (fuera de alcance, se coordinan aparte): ${pl.trafico_nuevo}`)

ok('las 6 pre-imágenes están presentes', preimgs.every((p) => p.sql), preimgs.filter((p) => !p.sql).map((p) => p.file).join(', '))
if (!LOCAL_PG) {
  // En producción usuario_id es NOT NULL con FK: el operador debe existir y estar activo.
  const op = await q(`SELECT id, nombre FROM public.usuarios WHERE id = ${sqlLiteral(OPERADOR_ID)} AND activo = true`)
  ok(`el operador de la reversión existe y está activo en el destino (${OPERADOR_ID})`, (op || []).length === 1, JSON.stringify(op))
}
console.log(`Operador de la reversión (autor de los movimientos 'ROLLBACK release 17'): ${OPERADOR_ID}`)
for (const p of preimgs) {
  const live = await q(`SELECT md5(btrim(pg_get_functiondef(pr.oid), E' \t\n\r\v\f')) AS md5 FROM pg_proc pr
WHERE pr.oid = to_regprocedure(${sqlLiteral(`public.${p.name}(${p.args})`)})`)
  const vivo = live[0]?.md5
  ok(`cuerpo actual de ${p.name}(${p.args}) ${vivo === p.md5 ? 'ya coincide con la pre-imagen' : 'se restaurará desde la pre-imagen'}`, true)
}

if (!APPLY) {
  evidence.finished_at = new Date().toISOString()
  evidence.veredicto = failed ? 'NO APLICA' : 'LISTO PARA REVERTIR'
  const ev = path.join(ROOT, `tmp/release17-rollback-dryrun-${stamp()}.json`)
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  fs.writeFileSync(ev, JSON.stringify(evidence, null, 2))
  console.log(`\n== PRUEBA EN SECO (sin mutaciones) ==\nVeredicto: ${evidence.veredicto}`)
  if (evidence.veredicto === 'LISTO PARA REVERTIR') {
    console.log('La reversión real se ejecuta con:')
    console.log(`  PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=${CONFIRM_VALUE} node scripts/rollback-release17-produccion.mjs --apply`)
  }
  console.log(`Evidencia: ${path.relative(ROOT, ev)}`)
  await close()
  process.exit(failed ? 1 : 0)
}

// ═══ PARTE QUE MUTA (solo --apply con confirmación explícita) ════════════════
if (!LOCAL_PG && process.env.PRODUCCION_RELEASE17_ROLLBACK_CONFIRM !== CONFIRM_VALUE) {
  console.error(`ABORT: --apply exige PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=${CONFIRM_VALUE}`)
  process.exit(1)
}
if (failed) {
  console.error('\nABORT: preflight con fallos — NO se revierte nada.')
  await close()
  process.exit(1)
}

// ── 1. Rollback SQL (gate verificado byte a byte y retirado) ─────────────────
let sql = sqlRollbackSrc
if (sql.split(GATE).length !== 2) {
  console.error('ABORT: el gate REVIEW_ONLY del paquete de rollback no coincide exactamente; no se ejecuta nada.')
  process.exit(1)
}
sql = sql.replace(GATE, '-- (gate REVIEW_ONLY verificado y retirado por scripts/rollback-release17-produccion.mjs)')
  .replace(/v_usuario_id\s+uuid\s+:=\s+'[0-9a-fA-F-]{36}'::uuid/, `v_usuario_id  uuid := '${OPERADOR_ID}'::uuid`)
const rb = await q(sql)
record('rollback_review aplicado (reingreso espejo + sellos)', rb)
ok('reingreso espejo ejecutado sin errores', true)

// ── 2. Restaurar los 6 cuerpos previos ───────────────────────────────────────
for (const p of preimgs) {
  const res = await q(p.sql)
  record(`cuerpo restaurado: ${p.name}(${p.args})`, res)
  ok(`cuerpo previo restaurado: ${p.name}(${p.args})`, true, p.file)
}

// ── 3. Eliminar la función NUEVA del release (con guarda de propiedad) ───────
const prop = await q(`SELECT obj_description(pr.oid, 'pg_proc') AS comentario FROM pg_proc pr
WHERE pr.oid = to_regprocedure(${sqlLiteral(`public.${FUNCION_NUEVA.name}(${FUNCION_NUEVA.args})`)})`)
const comentario = prop[0]?.comentario || ''
if (!comentario) {
  info(`la función nueva ${FUNCION_NUEVA.name} ya no existe (nada que eliminar)`)
} else if (String(comentario).startsWith('Main egreso-inventario release 17')) {
  await q(`DROP FUNCTION IF EXISTS public.${FUNCION_NUEVA.name}(${FUNCION_NUEVA.args})`)
  ok(`función nueva eliminada: ${FUNCION_NUEVA.name}(${FUNCION_NUEVA.args})`, true)
} else {
  ok(`la función ${FUNCION_NUEVA.name} NO se elimina: su marca de propiedad no es la del release 17`, false, String(comentario).slice(0, 120))
}

// ── 4. Verificación del retorno ──────────────────────────────────────────────
const v1 = await q(`SELECT count(*)::int AS n FROM public.notas_despacho nd
WHERE nd.egreso_lote_id = md5('migra-egreso-17-' || nd.id)::uuid
   OR nd.egreso_lote_id = md5('migra-egreso-17-legado-' || nd.id)::uuid`)
ok('ningún sello de migración/legado queda puesto (todo limpio)', Number(v1[0]?.n) === 0, JSON.stringify(v1[0]))

const v2a = await q(`SELECT m.producto_id, SUM(m.cantidad)::numeric AS u
FROM public.inventario_movimientos m
WHERE m.motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%'
GROUP BY m.producto_id`)
const v2b = await q(`SELECT m.producto_id, SUM(m.cantidad)::numeric AS u
FROM public.inventario_movimientos m
WHERE m.motivo LIKE 'ROLLBACK release 17 — reversión de MIGRACIÓN%'
GROUP BY m.producto_id`)
const mapaA = new Map(v2a.map((r) => [r.producto_id, Number(r.u)]))
const mapaB = new Map(v2b.map((r) => [r.producto_id, Number(r.u)]))
const desbalance = [...mapaA.entries()].filter(([k, u]) => mapaB.get(k) !== u).map(([k, u]) => `${k}: migración ${u} vs rollback ${mapaB.get(k)}`)
ok('inversión cuadrada por producto (cada unidad de migración tiene su reingreso)',
  desbalance.length === 0 && mapaA.size === mapaB.size,
  `productos con migración: ${mapaA.size}, con rollback: ${mapaB.size}, desbalances: ${desbalance.slice(0, 5).join(' | ')}`)

for (const p of preimgs) {
  const live = await q(`SELECT md5(btrim(pg_get_functiondef(pr.oid), E' \t\n\r\v\f')) AS md5 FROM pg_proc pr
WHERE pr.oid = to_regprocedure(${sqlLiteral(`public.${p.name}(${p.args})`)})`)
  ok(`cuerpo vivo idéntico a la pre-imagen: ${p.name}(${p.args})`, live[0]?.md5 === p.md5, `vivo ${live[0]?.md5} vs preimagen ${p.md5}`)
}
const v3 = await q(`SELECT to_regprocedure(${sqlLiteral(`public.${FUNCION_NUEVA.name}(${FUNCION_NUEVA.args})`)}) IS NULL AS ausente`)
ok(`función nueva ausente: ${FUNCION_NUEVA.name}`, v3[0]?.ausente === true, JSON.stringify(v3[0]))

const v4 = await q(`SELECT count(*)::int AS n FROM public.notas_despacho
WHERE egreso_lote_id IS NULL AND estado IN ('despachada','entregada')`)
info(`despachos sin lote tras la reversión: ${v4[0]?.n} (incluye los obsoletos #1930/#1933/#2144 y las entregadas legadas — correcto tras revertir)`)

// ── 5. Evidencia ─────────────────────────────────────────────────────────────
evidence.finished_at = new Date().toISOString()
evidence.result = failed ? 'FAIL' : 'PASS'
const evJson = path.join(ROOT, `tmp/release17-rollback-evidence-${stamp()}.json`)
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
fs.writeFileSync(evJson, JSON.stringify(evidence, null, 2))
const md = [
  `# REVERSIÓN de emergencia — release 17 en ${destino} — ${evidence.started_at}`,
  ``, `- Resultado: **${evidence.result}** · Comando: scripts/rollback-release17-produccion.mjs --apply`,
  `- Pre-imágenes: \`${path.relative(ROOT, PREIMG_DIR)}\` (6 cuerpos restaurados)`,
  `- Kardex: los movimientos de migración se conservan; la inversión va como 'ROLLBACK release 17'.`,
  `- Columnas egreso_lote_id/alerta_* conservadas como evidencia (decisión del paquete de rollback).`,
  ``, `## Aserciones`, ...evidence.asserts.map((a) => `- ${a.ok ? '✅' : '❌'} ${a.label}${a.ok ? '' : ` — \`${a.detail}\``}`),
  ``, `## Recordatorio`, `Revertir también la APLICACIÓN (revert del commit de app) en la misma ventana.`,
].join('\n')
const evMd = path.join(ROOT, LOCAL_PG ? 'tmp' : 'docs/operaciones', `release17-rollback-${stamp()}.md`)
fs.writeFileSync(evMd, md)
console.log(`\nEvidencia: ${path.relative(ROOT, evMd)} · ${path.relative(ROOT, evJson)}`)
console.log('RECORDATORIO: revertir también la APLICACIÓN (revert del commit de app) en la misma ventana.')
console.log(failed ? 'RESULTADO: FAIL' : 'RESULTADO: PASS')
await close()
process.exit(failed ? 1 : 0)
