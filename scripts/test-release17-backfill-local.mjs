#!/usr/bin/env node
/**
 * scripts/test-release17-backfill-local.mjs — ensayo del backfill del release 17
 * en un PostgreSQL DESDECHABLE en 127.0.0.1. No lee .env, no usa Supabase URL,
 * Management API ni conexión remota. Requiere PostgreSQL 16+ local (PG_BIN/PG_HOME
 * o C:\Program Files\PostgreSQL\<ver>\bin); no instala herramientas.
 *
 * Verifica la decisión 2026-10-21 del usuario:
 *   * Solo los despachos "en vuelo" NO excluidos descuentan stock.
 *   * Los obsoletos #1930, #1933, #2144 NO se tocan en absoluto: ni egreso,
 *     ni sello, ni movimiento (y su mercancía queda en el conteo exacto).
 *   * Las entregadas solo se sellan, sin tocar stock.
 *   * Los ítems externos y de préstamo no cuentan.
 *   * Re-ejecución sin doble efecto (idempotencia).
 *   * La consulta de verificación del instalador acepta los obsoletos y nada más.
 *
 * Uso: node scripts/test-release17-backfill-local.mjs --verify-local
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import pg from 'pg'

const ROOT = process.cwd()
const BACKFILL_PATH = path.join(ROOT, 'supabase/release/main/17_egreso_inventario_backfill.sql')
const backfill = fs.readFileSync(BACKFILL_PATH, 'utf8')

if (process.argv.length !== 3 || process.argv[2] !== '--verify-local') {
  throw new Error('Uso: node scripts/test-release17-backfill-local.mjs --verify-local')
}
console.log('Local only: no lee .env, no usa Supabase URL, Management API ni conexión remota.')

const check = (label, ok, detail = '') => {
  if (!ok) throw new Error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✓ ${label}`)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function postgresTools() {
  const names = process.platform === 'win32' ? ['initdb.exe', 'pg_ctl.exe', 'postgres.exe'] : ['initdb', 'pg_ctl', 'postgres']
  const dirs = [process.env.PG_BIN, process.env.PG_HOME && path.join(process.env.PG_HOME, 'bin')].filter(Boolean)
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    dirs.push(...['18', '17', '16'].map((version) => path.join(pf, 'PostgreSQL', version, 'bin')))
  } else dirs.push('/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin')
  for (const dir of dirs) {
    const tools = names.map((name) => path.join(dir, name))
    if (tools.every((file) => fs.existsSync(file))) return { initdb: tools[0], pgCtl: tools[1], postgres: tools[2] }
  }
  throw new Error('PostgreSQL 16+ local no disponible; define PG_BIN/PG_HOME. No se instalan herramientas.')
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

// Esquema mínimo que consume el backfill (mismas columnas que usa el SQL real).
const schema = `
CREATE TABLE public.productos(
  id uuid PRIMARY KEY, nombre text NOT NULL,
  stock_actual numeric(12,2) NOT NULL DEFAULT 0, stock_minimo numeric(12,2) NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true, cuenta_id uuid,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.notas_despacho(
  id uuid PRIMARY KEY, numero integer NOT NULL UNIQUE, cuenta_id uuid, estado text NOT NULL,
  egreso_lote_id uuid, alerta_stock boolean NOT NULL DEFAULT false, alerta_stock_items jsonb
);
CREATE TABLE public.notas_despacho_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), despacho_id uuid NOT NULL REFERENCES public.notas_despacho(id),
  producto_id uuid REFERENCES public.productos(id), nombre_snap text, cantidad numeric(12,2) NOT NULL,
  origen text, es_prestamo boolean NOT NULL DEFAULT false
);
CREATE TABLE public.inventario_movimientos(
  id bigserial PRIMARY KEY, lote_id uuid, tipo text NOT NULL, motivo text NOT NULL, motivo_tipo text,
  producto_id uuid, producto_nombre text, cantidad numeric(12,2) NOT NULL,
  stock_anterior numeric(12,2), stock_nuevo numeric(12,2),
  usuario_id uuid, usuario_nombre text, usuario_color text, cuenta_id uuid
);
`

const ids = {
  cuenta: '8f3438c8-a601-4c20-8a11-0000000000c1',
  operador: 'b40a90d3-e9a8-41f2-b631-edd4ea14ad78', // el que trae el backfill por defecto
  p1: 'a0000000-0000-4000-8000-000000000001', // CABILLA 10
  p2: 'a0000000-0000-4000-8000-000000000002', // CABILLA 12
  p3: 'a0000000-0000-4000-8000-000000000003', // CABILLA 16
  p4: 'a0000000-0000-4000-8000-000000000004', // CABILLA 20
  p5: 'a0000000-0000-4000-8000-000000000005', // MALLA 6x6
  p6: 'a0000000-0000-4000-8000-000000000006', // LOSACERO
  p7: 'a0000000-0000-4000-8000-000000000007', // TUBO PULIDO
  p8: 'a0000000-0000-4000-8000-000000000008', // CODO 45
  p9: 'a0000000-0000-4000-8000-000000000009', // TUBO PVC 2
  p10: 'a0000000-0000-4000-8000-00000000000a', // YEE
}
const d = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Despachos "en vuelo" espejo de producción al 2026-10-21 (mismos números).
const fixtures = [
  // [id, numero, estado, items: [producto, cantidad, origen?, prestamo?]]
  [d(1930), 1930, 'despachada', [[ids.p2, 60]]],                                  // OBSOLETO
  [d(1933), 1933, 'despachada', [[ids.p7, 3]]],                                   // OBSOLETO
  [d(2144), 2144, 'despachada', [[ids.p8, 2], [ids.p9, 1], [ids.p10, 5]]],        // OBSOLETO (8 uds)
  [d(4019), 4019, 'despachada', [[ids.p6, 15], [ids.p1, 7, 'externo'], [ids.p3, 2, 'inventario', true]]], // DESCUENTA 15
  [d(4161), 4161, 'despachada', [[ids.p1, 3750], [ids.p2, 890], [ids.p3, 1510], [ids.p4, 150], [ids.p5, 15]]], // DESCUENTA 6.315
  [d(9001), 9001, 'entregada', [[ids.p1, 50]]],                                   // SOLO SE SELLA
]
const EXCLUIDOS = [1930, 1933, 2144]
const ESPERADO_DESCUENTO = 15 + 6315 // solo #4019 + #4161

async function run() {
  const tools = postgresTools()
  const scratch = path.join(ROOT, '.wrangler')
  fs.mkdirSync(scratch, { recursive: true })
  const clusterRoot = fs.mkdtempSync(path.join(scratch, 'pg-release17-backfill-'))
  const cluster = path.join(clusterRoot, 'data')
  fs.mkdirSync(cluster)
  const logPath = path.join(clusterRoot, 'postgres.log')
  const port = await reservePort()
  let client, server, logFd, completedSuccessfully = false, stopped = false
  try {
    const init = spawnSync(tools.initdb.replaceAll('\\', '/'),
      ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    if (init.error || init.status !== 0) throw init.error || new Error(`initdb falló: ${(init.stderr || '').slice(-1000)}`)
    logFd = fs.openSync(logPath, 'a')
    server = spawn(tools.postgres.replaceAll('\\', '/'), ['-D', cluster, '-h', '127.0.0.1', '-p', String(port)],
      { windowsHide: true, stdio: ['ignore', logFd, logFd], detached: process.platform === 'win32' })
    if (process.platform === 'win32') server.unref()
    fs.closeSync(logFd)
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break
      client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', ssl: false, connectionTimeoutMillis: 700 })
      try { await client.connect(); break } catch {
        await client.end().catch(() => {})
        client = null
        await delay(250)
      }
    }
    if (!client) throw new Error(`No conectó al PostgreSQL local: ${fs.readFileSync(logPath, 'utf8').slice(-1200)}`)
    const identity = await client.query(`SELECT inet_server_addr()::text AS host,
      current_setting('server_version_num')::integer AS version_num`)
    check(`PostgreSQL loopback 16+ (${JSON.stringify(identity.rows[0])})`,
      identity.rows[0].host === '127.0.0.1/32' && identity.rows[0].version_num >= 160000)
    console.log(`Cluster desechable en 127.0.0.1:${port}`)

    await client.query(schema)
    // Fixtures: productos con stock "exacto" previo, despachos en vuelo + 1 entregada.
    for (const [key, stock] of Object.entries({ p1: 10000, p2: 5000, p3: 3000, p4: 1000, p5: 500, p6: 200, p7: 100, p8: 50, p9: 80, p10: 40 })) {
      await client.query(`INSERT INTO public.productos(id, nombre, stock_actual, cuenta_id)
        VALUES($1, $2, $3, $4)`, [ids[key], `Producto ${key}`, stock, ids.cuenta])
    }
    for (const [id, numero, estado, items] of fixtures) {
      await client.query(`INSERT INTO public.notas_despacho(id, numero, cuenta_id, estado) VALUES($1,$2,$3,$4)`,
        [id, numero, ids.cuenta, estado])
      for (const [producto, cantidad, origen, prestamo] of items) {
        await client.query(`INSERT INTO public.notas_despacho_items(despacho_id, producto_id, nombre_snap, cantidad, origen, es_prestamo)
          VALUES($1,$2,'item',$3,$4,$5)`,
          [id, producto, cantidad, origen || 'inventario', prestamo || false])
      }
    }

    const stockTotal = async () => Number((await client.query('SELECT COALESCE(SUM(stock_actual),0)::numeric AS s FROM public.productos')).rows[0].s)
    const stockDe = async (key) => Number((await client.query('SELECT stock_actual::numeric AS s FROM public.productos WHERE id=$1', [ids[key]])).rows[0].s)
    const movimientos = async () => (await client.query(`SELECT count(*)::int AS n, COALESCE(SUM(cantidad),0)::numeric AS u
      FROM public.inventario_movimientos WHERE motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%'`)).rows[0]

    const stock0 = await stockTotal()

    // ── 1. El backfill tal cual (operador por defecto) ────────────────────────
    console.log('\n== Ejecución 1 del backfill ==')
    await client.query(backfill)
    const stock1 = await stockTotal()
    check(`el stock total baja exactamente ${ESPERADO_DESCUENTO} unidades (${stock0} → ${stock1})`,
      stock0 - stock1 === ESPERADO_DESCUENTO, `delta=${stock0 - stock1}`)
    const mov1 = await movimientos()
    check('kardex de migración: 6 líneas y 6.330 unidades (solo #4019 y #4161)',
      mov1.n === 6 && Number(mov1.u) === ESPERADO_DESCUENTO, JSON.stringify(mov1))

    check('#1930 obsoleto: 60 unidades de CABILLA 12 intactas', (await stockDe('p2')) === 5000 - 890)
    check('#1933 obsoleto: 3 unidades de TUBO PULIDO intactas', (await stockDe('p7')) === 100)
    check('#2144 obsoleto: sus 8 unidades intactas (CODO 2, PVC 1, YEE 5)',
      (await stockDe('p8')) === 50 && (await stockDe('p9')) === 80 && (await stockDe('p10')) === 40)
    check('#4019 descuenta solo LOSACERO 15 (ítem externo y préstamo NO cuentan)',
      (await stockDe('p6')) === 200 - 15 && (await stockDe('p1')) === 10000 - 3750 && (await stockDe('p3')) === 3000 - 1510)
    check('#4161 descuenta 6.315 unidades (3.750+890+1.510+150+15)',
      (await stockDe('p4')) === 1000 - 150 && (await stockDe('p5')) === 500 - 15)

    for (const numero of EXCLUIDOS) {
      const row = (await client.query('SELECT egreso_lote_id FROM public.notas_despacho WHERE numero=$1', [numero])).rows[0]
      check(`#${numero} obsoleto: sin lote de egreso y sin movimiento alguno`,
        row.egreso_lote_id === null && (await client.query(
          `SELECT count(*)::int AS n FROM public.inventario_movimientos WHERE motivo LIKE '%' || $1 || '%'`, [`#${numero}`])).rows[0].n === 0)
    }
    for (const numero of [4019, 4161]) {
      const row = (await client.query('SELECT egreso_lote_id FROM public.notas_despacho WHERE numero=$1', [numero])).rows[0]
      check(`#${numero}: sellado con lote de egreso`, row.egreso_lote_id !== null)
    }
    const entregada = (await client.query('SELECT egreso_lote_id FROM public.notas_despacho WHERE numero=9001')).rows[0]
    const movEntregada = (await client.query(`SELECT count(*)::int AS n FROM public.inventario_movimientos
      WHERE lote_id=$1`, [entregada.egreso_lote_id])).rows[0].n
    check('entregada legada: solo sellada, 0 movimientos', entregada.egreso_lote_id !== null && movEntregada === 0)

    // ── 2. La verificación del instalador acepta los obsoletos y nada más ─────
    const post4 = await client.query(`SELECT COALESCE(array_agg(nd.numero ORDER BY nd.numero), '{}') AS numeros
      FROM public.notas_despacho nd
      WHERE nd.estado IN ('despachada','entregada') AND nd.egreso_lote_id IS NULL`)
    const sinLote = post4.rows[0].numeros.map(Number)
    check(`la consulta del instalador ve solo los obsoletos sin lote: ${JSON.stringify(sinLote)}`,
      JSON.stringify(sinLote) === JSON.stringify(EXCLUIDOS), JSON.stringify(sinLote))

    // ── 3. Re-ejecución: idempotencia total ──────────────────────────────────
    console.log('\n== Re-ejecución (idempotencia) ==')
    await client.query(backfill)
    const stock2 = await stockTotal()
    const mov2 = await movimientos()
    check('re-ejecutar no cambia el stock', stock2 === stock1, `${stock1} → ${stock2}`)
    check('re-ejecutar no duplica movimientos', mov2.n === mov1.n && Number(mov2.u) === Number(mov1.u), JSON.stringify(mov2))

    // ── 4. Paridad con la inyección de operador del instalador ───────────────
    const opId = '00000000-0000-0000-0000-000000000000'
    const inyectado = backfill
      .replace(/v_usuario_id\s+uuid\s+:=\s+'[0-9a-fA-F-]{36}'::uuid/, `v_usuario_id     uuid := '${opId}'::uuid`)
      .replace(/v_usuario_nombre\s+text\s+:=\s+'[^']*'/, `v_usuario_nombre text := 'MIGRACIÓN release 17'`)
    check('la inyección de operador del instalador aplica sobre el backfill',
      inyectado !== backfill && inyectado.includes(`'${opId}'::uuid`))

    completedSuccessfully = true
    console.log(`\nPASS: backfill release 17 — solo #4019 y #4161 descuentan (${ESPERADO_DESCUENTO} uds); #1930/#1933/#2144 intactos; entregada solo sellada; idempotente.`)
  } finally {
    if (client) await client.end().catch(() => {})
    if (server) {
      const stop = spawnSync(tools.pgCtl.replaceAll('\\', '/'), ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'],
        { encoding: 'utf8', windowsHide: true, timeout: 40_000 })
      stopped = !stop.error && stop.status === 0
      if (!stopped && !fs.existsSync(path.join(cluster, 'postmaster.pid'))) stopped = true
      if (!stopped) console.error(`CLUSTER CONSERVADO PARA DIAGNÓSTICO: ${path.relative(ROOT, cluster)}`)
    }
    if (stopped) {
      try { fs.rmSync(clusterRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
      catch (error) {
        console.error(`No se pudo borrar el clúster temporal ${path.relative(ROOT, clusterRoot)}: ${error.message}`)
        if (completedSuccessfully) throw error
      }
    }
  }
}

await run()
