#!/usr/bin/env node
/**
 * scripts/test-release17-rollback-local.mjs — ENSAYO GENERAL DEL PLAN B en un
 * PostgreSQL DESDECHABLE local. No toca producción salvo dos lecturas inocuas:
 * el respaldo ya verificado y la captura de las 6 pre-imágenes (lo mismo que
 * captura el instalador en la ventana).
 *
 * Recorrido completo (usa los COMANDOS REALES, no copias):
 *   1. Restaura el respaldo verificado de producción (esquema.sql + datos.sql).
 *   2. Anota las huellas de partida (stock, tablas) — el "estado exacto" previo.
 *   3. Instala el Release 17 (apply + backfill con operador fijado, como el instalador).
 *   4. Comprueba el efecto: el stock baja 6.330 unidades (solo #4019 y #4161).
 *   5. Corre el comando de reversión en PRUEBA EN SECO → debe decir LISTO PARA REVERTIR.
 *   6. Corre el comando de reversión real (--apply) → debe terminar PASS.
 *   7. Comprueba el RETORNO EXACTO al punto de partida: stocks idénticos, sellos
 *      limpios, kardex antiguo intacto (la inversión queda como evidencia nueva),
 *      funciones restauradas, y los obsoletos #1930/#1933/#2144 sin tocar.
 *
 * Uso: node scripts/test-release17-rollback-local.mjs --verify-local [--respaldo <carpeta>]
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const args = process.argv.slice(2)
if (!args.includes('--verify-local')) {
  throw new Error('Uso: node scripts/test-release17-rollback-local.mjs --verify-local [--respaldo <carpeta>]')
}
const argDir = args.indexOf('--respaldo') >= 0 ? args[args.indexOf('--respaldo') + 1] : null
const BACKUP_DIR = argDir || (() => {
  const base = 'C:/Users/luigg/Desktop/construacero-backups'
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('release17-')).sort() : []
  if (!dirs.length) throw new Error('No hay carpeta de respaldo release17-*; pasa --respaldo <carpeta>')
  return path.join(base, dirs[dirs.length - 1])
})()
if (!fs.existsSync(path.join(BACKUP_DIR, 'manifiesto.json'))) throw new Error(`Respaldo sin manifiesto.json: ${BACKUP_DIR}`)
console.log(`Respaldo de partida: ${BACKUP_DIR}`)

const APPLY_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_aprobacion_apply.sql')
const BACKFILL_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_backfill.sql')
const ROLLBACK_CMD = path.join(ROOT, 'scripts/rollback-release17-produccion.mjs')
const PREIMG_DIR = path.join(ROOT, 'tmp/release17-rollback-rehearsal/preimagenes')
const OPERADOR_ID = '00000000-0000-0000-0000-000000000000' // cuenta técnica Desarrollador (decisión 21-oct)

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) throw new Error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

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

// Huellas de contenido: igual que el respaldo, con las salvedades documentadas
// (actualizado_en cambia al tocar; las 3 columnas del release se conservan como
// evidencia al revertir; el kardex nuevo queda como movimientos de evidencia).
const HUELLAS = {
  productos: `SELECT count(*)::text || '|' || md5(coalesce(string_agg((to_jsonb(t) - 'actualizado_en')::text, E'\\n' ORDER BY t.id), '')) FROM public.productos t`,
  notas_despacho: `SELECT count(*)::text || '|' || md5(coalesce(string_agg((to_jsonb(t) - 'egreso_lote_id' - 'alerta_stock' - 'alerta_stock_items')::text, E'\\n' ORDER BY t.id), '')) FROM public.notas_despacho t`,
  notas_despacho_items: `SELECT count(*)::text || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY t.id), '')) FROM public.notas_despacho_items t`,
  // Nota: patrones ASCII a propósito — la línea de comandos de Windows pierde acentos.
  kardex_antiguo: `SELECT count(*)::text || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.inventario_movimientos t WHERE t.motivo NOT LIKE 'MIGR%' AND t.motivo NOT LIKE 'ROLLBACK release 17%'`,
}
const PREIMAGENES = [
  { name: 'aprobar_despacho_inventario_atomico', args: 'uuid,uuid,text,text,boolean', file: 'aprobar_despacho_inventario_atomico.live.sql' },
  { name: 'confirmar_entrega_inventario_atomica', args: 'uuid,uuid,text,text,numeric,boolean', file: 'confirmar_entrega_inventario_atomica.live.sql' },
  { name: 'revertir_entrega_inventario_atomica', args: 'uuid,text,uuid,text,text', file: 'revertir_entrega_inventario_atomica.live.sql' },
  { name: 'editar_despacho_profundidad', args: 'uuid,jsonb,uuid,text,text,text', file: 'editar_despacho_profundidad_6args.live.sql' },
  { name: 'editar_despacho_profundidad', args: 'uuid,jsonb,uuid,text,text', file: 'editar_despacho_profundidad_5args.live.sql' },
  { name: 'editar_despacho_profundidad', args: 'uuid,jsonb', file: 'editar_despacho_profundidad_2args.live.sql' },
]

const tools = postgresTools()
const CLUSTER = path.join(ROOT, '.wrangler', `pg-release17-rollback-${Date.now()}`)
const DB = 'ensayo_rollback'
const port = await freePort()
const pgEnv = { ...process.env, PGSSLMODE: 'disable', PGCLIENTENCODING: 'UTF8' }
const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres']
const run = (cmd, a, timeout = 60000) => spawnSync(cmd, a, { encoding: 'utf8', timeout, env: pgEnv })
const psql = (dbArgs, timeout) => run(tools.psql, [...conn, '-d', DB, ...dbArgs], timeout)
const huella = (sql) => {
  const r = psql(['-t', '-A', '-c', `SET TimeZone TO 'UTC';\nSET DateStyle TO 'ISO, MDY';\n${sql}`], 120000)
  const linea = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+\|[0-9a-f]{32}$/.test(s)).pop()
  if (!linea) throw new Error(`huella ilegible: ${(r.stderr || r.stdout || '').slice(-300)}`)
  return linea
}
const escalar = (sql) => (psql(['-t', '-A', '-c', sql], 120000).stdout || '').trim()

let completed = false
try {
  // ── 1. Clúster desechable + restauración del respaldo verificado ───────────
  console.log('\n== 1. Restauración del respaldo verificado ==')
  fs.mkdirSync(CLUSTER, { recursive: true })
  let r = run(tools.initdb, ['-D', path.join(CLUSTER, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], 120000)
  if (r.status !== 0) throw new Error('initdb falló: ' + (r.stderr || '').slice(-400))
  r = run(tools.pgCtl, ['-D', path.join(CLUSTER, 'data'), '-l', path.join(CLUSTER, 'pg.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`, 'start'], 60000)
  if (r.status !== 0) throw new Error('pg_ctl start falló: ' + (r.stderr || '').slice(-400))
  run(tools.psql, [...conn, '-d', 'postgres', '-c', `CREATE DATABASE ${DB};`], 60000)
  // roles stub para los GRANT/REVOKE del apply
  for (const rol of ['anon', 'authenticated', 'service_role']) {
    run(tools.psql, [...conn, '-d', DB, '-c', `CREATE ROLE ${rol} NOLOGIN;`], 30000)
  }
  // Las 4 funciones OBSOLETAS que el apply solo revoca/comenta (existen en
  // producción desde releases anteriores; la copia de datos no las incluye).
  const stubs = path.join(CLUSTER, 'stubs_obsoletas.sql')
  fs.writeFileSync(stubs, `
CREATE FUNCTION public.obtener_stock_comprometido() RETURNS numeric LANGUAGE plpgsql AS $s$ BEGIN RETURN 0; END $s$;
CREATE FUNCTION public.obtener_stock_comprometido_detalle(p_producto_id uuid) RETURNS TABLE(producto_id uuid) LANGUAGE plpgsql AS $s$ BEGIN RETURN; END $s$;
CREATE FUNCTION public.crear_nota_despacho(p_cliente_id uuid, p_notas text) RETURNS uuid LANGUAGE plpgsql AS $s$ BEGIN RETURN NULL; END $s$;
CREATE FUNCTION public.anular_despacho_atomico(p_despacho_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_motivo text) RETURNS void LANGUAGE plpgsql AS $s$ BEGIN RETURN; END $s$;
`)
  const rs = psql(['-v', 'ON_ERROR_STOP=1', '-q', '-f', stubs], 60000)
  check('stubs de las 4 funciones obsoletas creados (estado previo de producción)', rs.status === 0, (rs.stderr || '').slice(-300))
  for (const [archivo, to] of [['esquema.sql', 180000], ['datos.sql', 600000]]) {
    const rr = psql(['-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(BACKUP_DIR, archivo)], to)
    check(`restauración estricta de ${archivo}`, rr.status === 0, (rr.stderr || '').slice(-300))
  }

  // ── 2. Huellas de partida (el "estado exacto" previo) ──────────────────────
  console.log('\n== 2. Estado exacto de partida ==')
  const base = {}
  for (const [k, sql] of Object.entries(HUELLAS)) { base[k] = huella(sql); console.log(`  ${k}: ${base[k]}`) }
  const stockBase = Number(escalar('SELECT COALESCE(SUM(stock_actual),0) FROM public.productos'))
  const movBase = Number(escalar('SELECT count(*) FROM public.inventario_movimientos'))
  console.log(`  stock total: ${stockBase} · movimientos kardex: ${movBase}`)

  // ── 3. Instalar el Release 17 (apply + backfill) como el instalador ────────
  console.log('\n== 3. Instalación del Release 17 (apply + backfill) ==')
  r = psql(['-v', 'ON_ERROR_STOP=1', '-q', '-f', APPLY_PATH], 180000)
  check('apply del release 17 ejecutado sin errores', r.status === 0, (r.stderr || '').slice(-300))
  const backfill = fs.readFileSync(BACKFILL_PATH, 'utf8')
    .replace(/v_usuario_id\s+uuid\s+:=\s+'[0-9a-fA-F-]{36}'::uuid/, `v_usuario_id     uuid := '${OPERADOR_ID}'::uuid`)
  const bfPath = path.join(CLUSTER, 'backfill_ensayo.sql')
  fs.writeFileSync(bfPath, backfill)
  r = psql(['-v', 'ON_ERROR_STOP=1', '-q', '-f', bfPath], 180000)
  check('backfill (con exclusión de obsoletos) ejecutado sin errores', r.status === 0, (r.stderr || '').slice(-300))

  const stockTrasApply = Number(escalar('SELECT COALESCE(SUM(stock_actual),0) FROM public.productos'))
  check(`el stock baja exactamente 6.330 unidades (${stockBase} → ${stockTrasApply})`, stockBase - stockTrasApply === 6330, `delta=${stockBase - stockTrasApply}`)
  check('#1930/#1933/#2144 siguen sin lote tras el backfill',
    escalar(`SELECT count(*) FROM public.notas_despacho WHERE numero IN (1930,1933,2144) AND egreso_lote_id IS NULL`) === '3')
  check('#4019 y #4161 quedan con lote de migración',
    escalar(`SELECT count(*) FROM public.notas_despacho nd WHERE nd.numero IN (4019,4161) AND nd.egreso_lote_id = md5('migra-egreso-17-' || nd.id)::uuid`) === '2')

  // ── 4. Captura de pre-imágenes desde producción (lo que hará el instalador) ─
  console.log('\n== 4. Captura de pre-imágenes (lectura de producción, como el instalador) ==')
  fs.mkdirSync(PREIMG_DIR, { recursive: true })
  const env = {}
  for (const raw of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); const i = line.indexOf('=')
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['\"]|['\"]$/g, '')
  }
  const TOKEN = env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN
  const REF = fs.readFileSync(path.join(ROOT, '.supabase/project-ref'), 'utf8').trim()
  const API = `https://api.supabase.com/v1/projects/${REF}/database/query`
  for (const p of PREIMAGENES) {
    const resp = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `SELECT pg_get_functiondef(pr.oid) AS def FROM pg_proc pr WHERE pr.oid = to_regprocedure('public.${p.name}(${p.args})')` }),
    })
    const rows = JSON.parse(await resp.text())
    const def = rows[0]?.def
    check(`pre-imagen capturada: ${p.file}`, Boolean(def))
    fs.writeFileSync(path.join(PREIMG_DIR, p.file), def + '\n')
  }

  // ── 5. Comando de reversión: PRUEBA EN SECO ────────────────────────────────
  console.log('\n== 5. Comando de reversión real — prueba en seco ==')
  const uri = `postgresql://postgres@127.0.0.1:${port}/${DB}`
  const dry = run(process.execPath, [ROLLBACK_CMD, '--local-pg', uri, '--preimagenes', PREIMG_DIR], 300000)
  console.log((dry.stdout || '').split(/\r?\n/).slice(-6).join('\n'))
  check('prueba en seco del comando de reversión: LISTO PARA REVERTIR y exit 0',
    dry.status === 0 && (dry.stdout || '').includes('LISTO PARA REVERTIR'), `exit=${dry.status}`)

  // ── 6. Comando de reversión real (--apply) ─────────────────────────────────
  console.log('\n== 6. Comando de reversión real --apply ==')
  const apply = run(process.execPath, [ROLLBACK_CMD, '--local-pg', uri, '--preimagenes', PREIMG_DIR, '--apply'], 300000)
  if (apply.status !== 0) {
    console.log('--- salida completa del comando de reversión (falló) ---')
    console.log(apply.stdout || '')
    console.log('--- stderr ---')
    console.log(apply.stderr || '')
  }
  console.log((apply.stdout || '').split(/\r?\n/).slice(-8).join('\n'))
  check('reversión real: PASS y exit 0', apply.status === 0 && (apply.stdout || '').includes('RESULTADO: PASS'), `exit=${apply.status}`)

  // ── 7. Retorno EXACTO al punto de partida ──────────────────────────────────
  console.log('\n== 7. Retorno exacto al punto de partida ==')
  for (const [k, sql] of Object.entries(HUELLAS)) {
    const ahora = huella(sql)
    check(`${k} idéntico al estado de partida`, ahora === base[k], `partida ${base[k]} vs ahora ${ahora}`)
  }
  const stockFinal = Number(escalar('SELECT COALESCE(SUM(stock_actual),0) FROM public.productos'))
  check(`stock total vuelve exacto al de partida (${stockBase})`, stockFinal === stockBase, `final=${stockFinal}`)
  const movFinal = Number(escalar('SELECT count(*) FROM public.inventario_movimientos'))
  check(`kardex: +12 movimientos de evidencia (6 migración + 6 rollback), nada borrado (${movBase} → ${movFinal})`, movFinal === movBase + 12, `final=${movFinal}`)
  check('inversión cuadrada por producto (migración = rollback)',
    escalar(`SELECT count(*) FROM (SELECT producto_id, SUM(cantidad) u FROM public.inventario_movimientos WHERE motivo LIKE 'MIGR%' GROUP BY 1
      EXCEPT SELECT producto_id, SUM(cantidad) FROM public.inventario_movimientos WHERE motivo LIKE 'ROLLBACK release 17%' GROUP BY 1) x`) === '0')
  check('obsoletos #1930/#1933/#2144: intactos de principio a fin (sin lote y sin movimientos de migración/reversión)',
    escalar(`SELECT count(*) FROM public.notas_despacho WHERE numero IN (1930,1933,2144) AND egreso_lote_id IS NULL`) === '3'
      && escalar(`SELECT count(*) FROM public.inventario_movimientos
        WHERE (motivo LIKE 'MIGR%' OR motivo LIKE 'ROLLBACK release 17%')
          AND (motivo LIKE '%#1930%' OR motivo LIKE '%#1933%' OR motivo LIKE '%#2144%')`) === '0')
  check('función nueva eliminada y 6 cuerpos restaurados (verificado por el propio comando)',
    escalar(`SELECT to_regprocedure('public.revertir_despacho_inventario_atomica(uuid,text,uuid,text,text)') IS NULL`) === 't')
  check('las 3 columnas del release se conservan como evidencia (decisión del paquete)',
    escalar(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='notas_despacho' AND column_name IN ('egreso_lote_id','alerta_stock','alerta_stock_items')`) === '3')

  completed = true
  console.log('\nPASS: ensayo general del plan B — instalación + reversión con el comando real; retorno exacto al punto de partida.')
} finally {
  const stop = run(tools.pgCtl, ['-D', path.join(CLUSTER, 'data'), '-m', 'fast', 'stop'], 60000)
  if (stop.status === 0 || !fs.existsSync(path.join(CLUSTER, 'data', 'postmaster.pid'))) {
    try { fs.rmSync(CLUSTER, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch (e) {
      console.error(`No se pudo borrar el clúster temporal: ${e.message}`)
    }
  } else {
    console.error(`CLUSTER CONSERVADO PARA DIAGNÓSTICO: ${path.relative(ROOT, CLUSTER)}`)
  }
  if (!completed) process.exitCode = 1
}
