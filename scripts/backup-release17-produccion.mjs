#!/usr/bin/env node
// scripts/backup-release17-produccion.mjs — respaldo VERIFICABLE de las tablas críticas
// del release 17 (egreso de inventario al aprobar) desde PRODUCCIÓN, por la Management
// API (SOLO LECTURA: únicamente SELECT). GATE del plan de ventana §3.1.
//
// Tablas respaldadas: productos, inventario_movimientos, notas_despacho, notas_despacho_items.
// Genera en la carpeta de salida:
//   esquema.sql    — DDL de las 4 tablas (enums incluidos; vector(n) → text para restaurar
//                    en un PostgreSQL local sin pgvector; los valores vuelven como texto).
//   datos.sql      — INSERTs restaurables vía jsonb_populate_recordset (en trozos de 1.000).
//   manifiesto.json — conteos + huella de CONTENIDO por tabla (md5 de cada fila en JSON,
//                    ordenado por id, con TimeZone=UTC) + SHA-256 de los archivos.
//   evidencia.txt  — resumen legible.
//
// MODO DE USO:
//   node scripts/backup-release17-produccion.mjs [carpeta_salida] [--verify]
//     1) Respalda las 4 tablas desde producción (solo lectura).
//     2) Con --verify, además ejecuta scripts/verify-release17-backup-local.mjs sobre la
//        carpeta: restaura TODO en un PostgreSQL desechable local y compara por CONTENIDO,
//        más una re-verificación contra producción viva. Es el comando de la ventana.
//
// Seguridad: destino fijado por .supabase/project-ref (debe ser oyfyuszgjwcepjpngclv);
// token de .env (SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN), jamás se imprime.
// El respaldo sale de la carpeta del proyecto (por defecto Desktop/construacero-backups/…,
// convención de scripts/backup-supabase-logical.mjs) para que no viaje a git.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const EXPECTED_REF = 'oyfyuszgjwcepjpngclv'
const TABLAS = ['productos', 'inventario_movimientos', 'notas_despacho', 'notas_despacho_items']
const CHUNK = 1000

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
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`
const quoteLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

const args = process.argv.slice(2)
const verify = args.includes('--verify')
const argDir = args.find((a) => !a.startsWith('--'))
const OUT = argDir || path.join('C:/Users/luigg/Desktop/construacero-backups', `release17-${new Date().toISOString().slice(0, 10)}`)

const env = parseEnv(path.join(ROOT, '.env'))
const TOKEN = env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN en .env'); process.exit(1) }
const REF = fs.readFileSync(path.join(ROOT, '.supabase/project-ref'), 'utf8').trim()
if (REF !== EXPECTED_REF) { console.error(`Destino inesperado: ${REF} (se exige producción ${EXPECTED_REF})`); process.exit(1) }

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`
async function q(sql) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`API ${r.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

// Huella de CONTENIDO: md5 de cada fila serializada a JSON, ordenada por id, con zona
// horaria y estilo de fecha fijos (igual en producción y en la restauración local).
const CHECKSUM_SQL = (tabla) => `SET TimeZone TO 'UTC';
SET DateStyle TO 'ISO, MDY';
SELECT count(*)::int AS filas,
       md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY t.id), '')) AS huella
FROM public.${ident(tabla)} t`

fs.mkdirSync(OUT, { recursive: true })

// ---------- 1) DDL de las 4 tablas (columnas, enums, constraints internas) ----------
const cols = await q(`
SELECT c.relname AS tabla, a.attname AS col,
       format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS notnull,
       pg_get_expr(d.adbin, d.adrelid) AS default, a.attidentity AS identity, a.attgenerated AS gen
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relname IN (${TABLAS.map(quoteLiteral).join(',')})
ORDER BY c.relname, a.attnum`)

const constraints = await q(`
SELECT conrelid::regclass::text AS tabla, conname, pg_get_constraintdef(oid) AS def, contype,
       confrelid::regclass::text AS ref
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (${TABLAS.map((t) => quoteLiteral('public.' + t)).join(',')})
ORDER BY contype DESC, conname`)

const enums = await q(`
SELECT t.typname,
       string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.oid IN (
  SELECT DISTINCT a.atttypid FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (${TABLAS.map(quoteLiteral).join(',')})
    AND a.attnum > 0 AND NOT a.attisdropped)
GROUP BY 1 ORDER BY 1`)

const byTable = new Map()
for (const r of cols) {
  if (!byTable.has(r.tabla)) byTable.set(r.tabla, [])
  byTable.get(r.tabla).push(r)
}

let ddl = `-- DDL capturado desde producción ${REF} el ${new Date().toISOString()}\n`
ddl += `-- Generado por scripts/backup-release17-produccion.mjs (tablas críticas release 17)\n`
ddl += `-- vector(n) se restaura como text en local: el valor viaja como texto en datos.sql.\n\n`
for (const e of enums) ddl += `DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = ${quoteLiteral(e.typname)}) THEN CREATE TYPE ${ident(e.typname)} AS ENUM (${e.labels}); END IF; END $do$;\n`
ddl += '\n'
for (const tabla of TABLAS) {
  const list = byTable.get(tabla) || []
  if (!list.length) { console.error(`ABORT: la tabla public.${tabla} no existe en el destino`); process.exit(1) }
  ddl += `CREATE TABLE IF NOT EXISTS public.${ident(tabla)} (\n`
  ddl += list.map((r) => {
    const tipo = r.tipo.replace(/vector\(\d+\)/, 'text')
    let line = `  ${ident(r.col)} ${tipo}`
    if (r.gen && r.gen !== '') line += ` GENERATED ALWAYS AS (${r.default}) STORED`
    else if (r.identity && r.identity !== '') line += ` GENERATED BY DEFAULT AS IDENTITY`
    else if (r.default) line += ` DEFAULT ${r.default}`
    if (r.notnull) line += ` NOT NULL`
    return line
  }).join(',\n')
  ddl += '\n);\n\n'
}
for (const k of constraints) {
  // FKs solo si la tabla referida también está respaldada (si no, no se puede crear en local).
  if (k.contype === 'f' && !TABLAS.some((t) => k.ref === `public.${t}`)) continue
  ddl += `ALTER TABLE public.${ident(k.tabla.split('.')[1])} ADD CONSTRAINT ${ident(k.conname)} ${k.def};\n`
}

// ---------- 2) Conteos + huellas de contenido contra PRODUCCIÓN ----------
console.log(`== Respaldo release 17 desde producción ${REF} (SOLO LECTURA) ==`)
const verificacion = {}
for (const tabla of TABLAS) {
  const rows = await q(CHECKSUM_SQL(tabla))
  verificacion[tabla] = rows[0]
  console.log(`  ${tabla}: ${rows[0].filas} filas · huella ${String(rows[0].huella).slice(0, 12)}…`)
}

// ---------- 3) Datos en trozos (jsonb_populate_recordset) ----------
let datos = `-- Datos capturados desde producción ${REF} el ${new Date().toISOString()}\n`
datos += `-- Restauración: scripts/verify-release17-backup-local.mjs (o psql -f datos.sql sobre esquema.sql).\n\n`
datos += 'SET session_replication_role = replica; -- carga sin validar FK (la integridad se re-verifica por huella)\n\n'
const conteos = {}
for (const tabla of TABLAS) {
  const list = (byTable.get(tabla) || []).filter((r) => !(r.gen && r.gen !== ''))
  const tieneIdentidad = list.some((r) => r.identity === 'a')
  const colList = list.map((r) => ident(r.col)).join(', ')
  let last = null
  let n = 0
  for (;;) {
    const filtro = last === null ? 'TRUE' : `t.id > ${quoteLiteral(last)}`
    // La sentencia INSERT se genera ENTERA en el servidor: si el payload pasara por
    // JavaScript (JSON.parse/stringify), los números perderían sus decimales
    // (3750.00 → 3750) y los valores dentro de columnas jsonb — que no tienen tipo
    // con escala fija — quedarían alterados (lección de la ventana 2026-10-22).
    const rows = await q(`SELECT
  'INSERT INTO public.${ident(tabla)} (${colList})${tieneIdentidad ? ' OVERRIDING SYSTEM VALUE' : ''} '
  || 'SELECT ${list.map((r) => 'j.' + ident(r.col)).join(', ')} '
  || 'FROM jsonb_populate_recordset(NULL::public.${ident(tabla)}, '
  || quote_literal(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]'))
  || '::jsonb) AS j;' AS stmt,
  count(*)::int AS n,
  max(t.id::text) AS ultimo
FROM (SELECT * FROM public.${ident(tabla)} t WHERE ${filtro} ORDER BY t.id LIMIT ${CHUNK}) t`)
    const fila = rows[0] || {}
    const nTrozo = Number(fila.n || 0)
    if (!nTrozo || !fila.stmt) break
    datos += `-- ${tabla}: filas ${n + 1}..${n + nTrozo}\n`
    datos += fila.stmt + '\n\n'
    n += nTrozo
    last = String(fila.ultimo)
    process.stdout.write(`  datos ${tabla}: ${n}\r`)
    if (nTrozo < CHUNK) break
  }
  conteos[tabla] = n
  console.log(`  datos ${tabla}: ${n} filas`)
  if (n !== verificacion[tabla].filas) {
    console.error(`ABORT: ${tabla}: descargadas ${n} pero producción reporta ${verificacion[tabla].filas}`)
    process.exit(1)
  }
}
datos += 'RESET session_replication_role;\n'

// ---------- 4) Archivos + manifiesto ----------
const esquemaPath = path.join(OUT, 'esquema.sql')
const datosPath = path.join(OUT, 'datos.sql')
fs.writeFileSync(esquemaPath, ddl)
fs.writeFileSync(datosPath, datos)
const manifiesto = {
  generado: new Date().toISOString(),
  proyecto: REF,
  entorno: 'produccion',
  herramienta: 'scripts/backup-release17-produccion.mjs',
  tablas: TABLAS,
  verificacion,
  sha256: { 'esquema.sql': sha256(esquemaPath), 'datos.sql': sha256(datosPath) },
}
fs.writeFileSync(path.join(OUT, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2))
fs.writeFileSync(path.join(OUT, 'evidencia.txt'),
  `RESPALDO VERIFICABLE — release 17 (tablas críticas de inventario) — ${new Date().toISOString()}\n` +
  `Producción: ${REF} · Método: Management API HTTPS (SOLO LECTURA)\n` +
  `Tablas: ${TABLAS.join(', ')}\n` +
  TABLAS.map((t) => `  ${t}: ${verificacion[t].filas} filas · huella ${verificacion[t].huella}`).join('\n') + '\n' +
  `SHA-256 esquema.sql: ${manifiesto.sha256['esquema.sql']}\n` +
  `SHA-256 datos.sql:   ${manifiesto.sha256['datos.sql']}\n` +
  `Prueba de restauración: ${verify ? 'pendiente (se ejecuta a continuación)' : 'NO ejecutada en esta corrida'}\n`)
console.log(`\n== RESGUARDO LISTO ==\ncarpeta: ${OUT}`)
console.log(`SHA-256 esquema.sql: ${manifiesto.sha256['esquema.sql']}`)
console.log(`SHA-256 datos.sql:   ${manifiesto.sha256['datos.sql']}`)

if (!verify) {
  console.log('\nSiguiente paso: node scripts/verify-release17-backup-local.mjs "' + OUT + '" --contra-produccion')
  process.exit(0)
}

// ---------- 5) Prueba de restauración encadenada ----------
console.log('\n== Prueba de restauración (PostgreSQL desechable local) ==')
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-release17-backup-local.mjs'), OUT, '--contra-produccion'],
  { stdio: 'inherit', cwd: ROOT })
process.exit(r.status ?? 1)
