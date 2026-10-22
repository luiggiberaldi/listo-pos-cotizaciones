#!/usr/bin/env node
// scripts/verify-release17-backup-local.mjs — PRUEBA DE RESTAURACIÓN del respaldo del
// release 17 en un PostgreSQL DESDECHABLE local. No toca producción salvo la re-lectura
// opcional de huellas (--contra-produccion, SOLO LECTURA).
//
// Qué hace:
//   1. Verifica que los archivos del respaldo coincidan con su SHA-256 del manifiesto.
//   2. Crea un clúster PostgreSQL desechable y restaura esquema.sql + datos.sql
//      (ON_ERROR_STOP: cualquier error SQL = FAIL).
//   3. Compara por CONTENIDO cada tabla (conteo + md5 de las filas serializadas a JSON,
//      ordenadas por id, TimeZone=UTC) contra el manifiesto.
//   4. Con --contra-produccion, además vuelve a consultar las huellas en producción y
//      exige coincidencia triple (producción = manifiesto = restauración).
//   5. Deja el resumen en evidencia.txt y borra el clúster.
//
// Uso: node scripts/verify-release17-backup-local.mjs <carpeta_respaldo> [--contra-produccion]
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const DIR = args.find((a) => !a.startsWith('--'))
const CONTRA_PRODUCCION = args.includes('--contra-produccion')
if (!DIR || !fs.existsSync(path.join(DIR, 'manifiesto.json'))) {
  console.error('Uso: node scripts/verify-release17-backup-local.mjs <carpeta_respaldo> [--contra-produccion]')
  process.exit(1)
}
const manifiesto = JSON.parse(fs.readFileSync(path.join(DIR, 'manifiesto.json'), 'utf8'))
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function postgresTools() {
  const names = process.platform === 'win32' ? ['initdb.exe', 'pg_ctl.exe', 'psql.exe'] : ['initdb', 'pg_ctl', 'psql']
  const dirs = [process.env.PG_BIN, process.env.PG_HOME && path.join(process.env.PG_HOME, 'bin')].filter(Boolean)
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    dirs.push(...['18', '17', '16'].map((v) => path.join(pf, 'PostgreSQL', v, 'bin')))
  } else dirs.push('/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin')
  for (const dir of dirs) {
    const tools = names.map((n) => path.join(dir, n))
    if (tools.every((f) => fs.existsSync(f))) return { initdb: tools[0], pgCtl: tools[1], psql: tools[2] }
  }
  throw new Error('PostgreSQL 16+ local no disponible; define PG_BIN/PG_HOME.')
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close((e) => (e ? reject(e) : resolve(p))) })
  })
}
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const checksumSql = (tabla) => `SET TimeZone TO 'UTC';\nSET DateStyle TO 'ISO, MDY';\nSELECT count(*)::text || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY t.id), ''))\nFROM public."${tabla.replace(/"/g, '""')}" t`

const tools = postgresTools()
const CLUSTER = path.join(DIR, '_restore_test_cluster')
const DB = 'restauracion_test'
const pgEnv = { ...process.env, PGSSLMODE: 'disable' }
const conn = ['-h', '127.0.0.1', '-p', String(await freePort()), '-U', 'postgres']
const run = (cmd, args2, timeout = 60000) => spawnSync(cmd, args2, { encoding: 'utf8', timeout, env: pgEnv })
const psqlRun = (dbArgs, timeout) => run(tools.psql, [...conn, '-d', DB, ...dbArgs], timeout)
const fallos = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) fallos.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

try {
  // ── 1. Integridad de los archivos ──────────────────────────────────────────
  log('verificando SHA-256 de los archivos del respaldo…')
  for (const [archivo, esperado] of Object.entries(manifiesto.sha256)) {
    const p = path.join(DIR, archivo)
    const ok = fs.existsSync(p) && sha256(p) === esperado
    check(`SHA-256 de ${archivo}`, ok, `esperado ${esperado}, obtenido ${fs.existsSync(p) ? sha256(p) : '(no existe)'}`)
  }
  if (fallos.length) throw new Error('los archivos del respaldo no coinciden con el manifiesto')

  // ── 2. Clúster desechable + restauración estricta ──────────────────────────
  log('creando clúster PostgreSQL desechable…')
  if (fs.existsSync(CLUSTER)) fs.rmSync(CLUSTER, { recursive: true, force: true })
  let r = run(tools.initdb, ['-D', CLUSTER, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], 120000)
  if (r.status !== 0) throw new Error('initdb falló: ' + (r.stderr || '').slice(-500))
  r = run(tools.pgCtl, ['-D', CLUSTER, '-l', path.join(DIR, '_restore_test.log'), '-o', `-p ${conn[3]} -c listen_addresses=127.0.0.1`, 'start'], 60000)
  if (r.status !== 0) throw new Error('pg_ctl start falló: ' + (r.stderr || '').slice(-500))
  run(tools.psql, [...conn, '-d', 'postgres', '-c', `CREATE DATABASE ${DB};`], 60000)

  for (const [fase, archivo, to] of [['esquema', 'esquema.sql', 180000], ['datos', 'datos.sql', 600000]]) {
    log(`restaurando ${archivo}…`)
    const rr = psqlRun(['-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(DIR, archivo)], to)
    if (rr.error && rr.error.code === 'ETIMEDOUT') throw new Error(`${archivo} excedió ${to / 1000}s`)
    check(`restauración estricta de ${archivo} sin errores SQL`, rr.status === 0, (rr.stderr || rr.stdout || '').slice(-400))
    if (rr.status !== 0) break
  }

  // ── 3. Comparación por CONTENIDO: restauración vs manifiesto ──────────────
  log('comparando contenido tabla por tabla…')
  for (const tabla of manifiesto.tablas) {
    const rr = psqlRun(['-t', '-A', '-c', checksumSql(tabla)], 120000)
    const linea = (rr.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+\|[0-9a-f]{32}$/.test(s)).pop()
    const [filas, huella] = linea ? linea.split('|') : [null, null]
    const esp = manifiesto.verificacion[tabla]
    check(`${tabla}: contenido restaurado idéntico (${esp.filas} filas)`,
      Number(filas) === Number(esp.filas) && huella === esp.huella,
      `manifiesto ${esp.filas}/${esp.huella} vs restauración ${filas}/${huella}`)
  }

  // ── 4. Triple verificación contra producción viva (opcional, solo lectura) ─
  if (CONTRA_PRODUCCION) {
    log('re-verificando huellas contra producción viva (SOLO LECTURA)…')
    const env = {}
    for (const raw of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const line = raw.trim(); const i = line.indexOf('=')
      if (i > 0 && !line.startsWith('#')) env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['\"]|['\"]$/g, '')
    }
    const TOKEN = env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN
    const REF = fs.readFileSync(path.join(ROOT, '.supabase/project-ref'), 'utf8').trim()
    if (REF !== manifiesto.proyecto) throw new Error(`el proyecto vivo (${REF}) no es el del manifiesto (${manifiesto.proyecto})`)
    const API = `https://api.supabase.com/v1/projects/${REF}/database/query`
    for (const tabla of manifiesto.tablas) {
      const resp = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `SET TimeZone TO 'UTC';\nSET DateStyle TO 'ISO, MDY';\nSELECT count(*)::int AS filas, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY t.id), '')) AS huella FROM public."${tabla}" t` }),
      })
      const rows = JSON.parse(await resp.text())
      const vivo = rows[rows.length - 1]
      const esp = manifiesto.verificacion[tabla]
      check(`${tabla}: producción viva coincide con el manifiesto (${esp.filas} filas)`,
        Number(vivo?.filas) === Number(esp.filas) && vivo?.huella === esp.huella,
        `manifiesto ${esp.filas}/${esp.huella} vs vivo ${vivo?.filas}/${vivo?.huella}`)
    }
  }

  // ── 5. Evidencia y limpieza ────────────────────────────────────────────────
  const veredicto = fallos.length === 0 ? 'PASS' : 'FAIL'
  const resumen = [
    `PRUEBA DE RESTAURACIÓN — ${new Date().toISOString()}`,
    `Veredicto: ${veredicto} (${manifiesto.tablas.length} tablas críticas del release 17)`,
    `Triple verificación: ${CONTRA_PRODUCCION ? 'sí (producción = manifiesto = restauración local)' : 'no (solo manifiesto = restauración local)'}`,
    ...fallos.map((f) => `  FALLO: ${f}`),
  ].join('\n')
  fs.appendFileSync(path.join(DIR, 'evidencia.txt'), '\n' + resumen + '\n')
  console.log('\n' + resumen)

  log('deteniendo y borrando clúster…')
  run(tools.pgCtl, ['-D', CLUSTER, '-m', 'fast', 'stop'], 60000)
  fs.rmSync(CLUSTER, { recursive: true, force: true })
  process.exit(veredicto === 'PASS' ? 0 : 1)
} catch (e) {
  console.error('ERROR:', e.message)
  try { run(tools.pgCtl, ['-D', CLUSTER, '-m', 'immediate', 'stop'], 30000) } catch {}
  try { fs.rmSync(CLUSTER, { recursive: true, force: true }) } catch {}
  process.exit(1)
}
