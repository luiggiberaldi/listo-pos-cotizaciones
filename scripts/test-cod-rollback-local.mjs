#!/usr/bin/env node
// scripts/test-cod-rollback-local.mjs
// Ensayo del ROLLBACK del release 14 COD en un PostgreSQL desechable (local, sin red):
//   1. Verifica que 14_cod_financial_rpcs_apply.sql coincide con el SHA registrado
//      (el mismo paquete aplicado en producción 2026-10-18).
//   2. Aplica el paquete sobre el fixture de esquema del harness COD.
//   3. Siembra historial financiero: abono en CxC, fila de auditoría y fila de
//      cod_conciliacion_idempotencia.
//   4. Ensayar los guards: comentario de propietario alterado => el rollback se
//      niega con ROLLBACK_14_COD_*_OWNER_MISMATCH y NO retira nada.
//   5. Ejecuta 14_cod_rollback_review.sql (sin su gate REVIEW_ONLY): retira las
//      dos funciones.
//   6. Verifica que el historial financiero RETIENE (tabla de idempotencia con su
//      fila, abonos del ledger y auditoría intactos) y que el rollback es
//      re-ejecutable (segunda corrida también pasa).
//
// Uso: npm run verify:cod:rollback-local
// Local only: no lee .env, no usa Supabase URL, Management API ni conexión remota.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import pg from 'pg'

const ROOT = process.cwd()
const RELEASE_DIR = 'supabase/release/main'
// SHA-256 registrado en docs/plans/2026-10-18-solucion-definitiva-conciliacion-cod-corregido.md
// (§7, Tarea 2): el artefacto exacto aplicado en producción.
const APPLY_SHA = '4e4a2e09083b67ab30ad6b609028ccdaf000ab906125a52f083f483d700b760e'
const COMMENT_SUMMARY = 'Main COD release 14: read-only tenant-scoped summary derived from CxC ledger.'
const COMMENT_RECONCILE = 'Main COD release 14: atomic idempotent COD payment; independently preserves payment JSON and per-Bs-payment rate snapshots.'

const applyPath = path.join(ROOT, RELEASE_DIR, '14_cod_financial_rpcs_apply.sql')
const rollbackPath = path.join(ROOT, RELEASE_DIR, '14_cod_rollback_review.sql')

const shaApply = createHash('sha256').update(fs.readFileSync(applyPath)).digest('hex')
if (shaApply !== APPLY_SHA) {
  throw new Error(`El paquete aplicable no coincide con el SHA registrado (${shaApply}); no se ejecutara el ensayo.`)
}

const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)

// Quitar el gate REVIEW_ONLY con la misma filosofia que el harness principal:
// derivar el bloque del propio archivo, exigir una sola aparicion y no tocar mas nada.
function quitarGate(texto, etiqueta) {
  const norm = texto.split(CRLF).join(LF)
  const lineas = norm.split(LF)
  const inicio = lineas.findIndex(l => l.trim() === 'DO $review_gate$')
  const fin = lineas.findIndex((l, i) => i > inicio && l.trim() === '$review_gate$;')
  if (inicio < 0 || fin !== inicio + 4) throw new Error(`Gate REVIEW_ONLY inesperado en ${etiqueta}`)
  const gate = lineas.slice(inicio, fin + 1).join(LF)
  if (norm.split(gate).length !== 2) throw new Error(`El gate REVIEW_ONLY no coincide exactamente en ${etiqueta}; no se modificara el paquete.`)
  return norm.split(gate).join('')
}

const applySql = fs.readFileSync(applyPath, 'utf8')
const rollbackSql = quitarGate(fs.readFileSync(rollbackPath, 'utf8'), '14_cod_rollback_review.sql')

function check(label, ok) {
  if (!ok) throw new Error(`FAIL: ${label}`)
  console.log(`  ok ${label}`)
}

function postgresTools() {
  const names = process.platform === 'win32' ? ['initdb.exe', 'pg_ctl.exe', 'postgres.exe'] : ['initdb', 'pg_ctl', 'postgres']
  const dirs = [process.env.PG_BIN, process.env.PG_HOME && path.join(process.env.PG_HOME, 'bin')].filter(Boolean)
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    dirs.push(...['18', '17', '16'].map(version => path.join(pf, 'PostgreSQL', version, 'bin')))
  } else dirs.push('/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin')
  for (const dir of dirs) {
    const tools = names.map(name => path.join(dir, name))
    if (tools.every(file => fs.existsSync(file))) return { initdb: tools[0], pgCtl: tools[1], postgres: tools[2] }
  }
  throw new Error('PostgreSQL 16+ local no disponible; define PG_BIN/PG_HOME. No se instalan herramientas.')
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Mismo fixture de esquema que el harness principal: entorno identico al del
// ensayo forward (verify:cod:release-local).
const schema = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.usuarios(
  id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, nombre text NOT NULL,
  rol text NOT NULL, activo boolean NOT NULL DEFAULT true
);
CREATE TABLE public.clientes(
  id uuid PRIMARY KEY, cuenta_id uuid NOT NULL,
  saldo_pendiente numeric(12,4) NOT NULL DEFAULT 0
);
CREATE TABLE public.notas_despacho(
  id uuid PRIMARY KEY, numero integer NOT NULL UNIQUE, cuenta_id uuid NOT NULL,
  estado text NOT NULL, cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  cliente_factura_id uuid, total_usd numeric(12,4) NOT NULL DEFAULT 0,
  forma_pago text, forma_pago_cliente text
);
CREATE TABLE public.cuentas_por_cobrar(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cuenta_id uuid NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  despacho_id uuid REFERENCES public.notas_despacho(id),
  tipo text NOT NULL CHECK (tipo IN ('cargo','abono','credito','devolucion_credito','consumo_credito')),
  monto_usd numeric(12,4) NOT NULL CHECK (monto_usd > 0), saldo_usd numeric(12,4) NOT NULL,
  metodo_pago text, forma_pago_abono text, referencia text, descripcion text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES public.usuarios(id)
);
CREATE TABLE public.despacho_devoluciones(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), despacho_id uuid NOT NULL REFERENCES public.notas_despacho(id),
  total_devuelto_usd numeric(12,4) NOT NULL DEFAULT 0
);
CREATE TABLE public.despacho_devolucion_intercambios(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), despacho_id uuid NOT NULL REFERENCES public.notas_despacho(id),
  total_usd numeric(12,4) NOT NULL DEFAULT 0
);
CREATE TABLE public.auditoria(
  id bigserial PRIMARY KEY, usuario_id uuid, usuario_nombre text NOT NULL, usuario_rol text NOT NULL,
  categoria text NOT NULL, accion text NOT NULL, descripcion text NOT NULL, entidad_tipo text NOT NULL,
  entidad_id uuid NOT NULL, meta jsonb NOT NULL DEFAULT '{}', ip_origen text, cuenta_id uuid NOT NULL
);
CREATE TABLE public.cod_recalc_calls(despacho_id uuid PRIMARY KEY, calls integer NOT NULL DEFAULT 0);
CREATE FUNCTION public.recalcularcomisiondespacho_238b(p_despachoid uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $stub$
BEGIN
  INSERT INTO public.cod_recalc_calls(despacho_id,calls) VALUES(p_despachoid,1)
  ON CONFLICT(despacho_id) DO UPDATE SET calls=public.cod_recalc_calls.calls+1;
  RETURN p_despachoid;
END;
$stub$;
`

const ids = {
  account: '8f3438c8-a601-4c20-8a11-00000000ab01',
  actor: '8f3438c8-a601-4c20-8a11-00000000ab02',
  customer: '8f3438c8-a601-4c20-8a11-00000000ab03',
  dispatch: '8f3438c8-a601-4c20-8a11-00000000ab04',
  idemKey: '8f3438c8-a601-4c20-8a11-00000000ab05',
}

async function run() {
  const tools = postgresTools()
  const scratch = path.join(ROOT, '.wrangler')
  fs.mkdirSync(scratch, { recursive: true })
  const clusterRoot = fs.mkdtempSync(path.join(scratch, 'pg-cod-rollback-'))
  const cluster = path.join(clusterRoot, 'data')
  fs.mkdirSync(cluster)
  const logPath = path.join(clusterRoot, 'postgres.log')
  const port = await reservePort()
  let client
  let server
  let logFd
  let logOpen = false
  let completedSuccessfully = false
  let stopped = false

  async function expectRejected(label, operation, expectedMessage) {
    try {
      await operation()
    } catch (error) {
      check(label, !expectedMessage || String(error.message).includes(expectedMessage))
      await client.query('ROLLBACK').catch(() => {})
      return
    }
    throw new Error(`FAIL: ${label}; esperaba rechazo ${expectedMessage || ''}`)
  }

  try {
    const init = spawnSync(tools.initdb.replaceAll('\\', '/'),
      ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    if (init.error || init.status !== 0) throw init.error || new Error(`initdb fallo: ${(init.stderr || '').slice(-1000)}`)
    logFd = fs.openSync(logPath, 'a')
    server = spawn(process.platform === 'win32' ? tools.postgres.replaceAll('\\', '/') : tools.postgres,
      ['-D', cluster, '-h', '127.0.0.1', '-p', String(port)],
      { windowsHide: true, stdio: ['ignore', logFd, logFd], detached: process.platform === 'win32' })
    if (process.platform === 'win32') server.unref()
    fs.closeSync(logFd)
    logOpen = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break
      client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', ssl: false, connectionTimeoutMillis: 700 })
      try { await client.connect(); break } catch {
        await client.end().catch(() => {})
        client = null
        await delay(250)
      }
    }
    if (!client) throw new Error(`No conecto al PostgreSQL local: ${fs.readFileSync(logPath, 'utf8').slice(-1200)}`)
    const identity = await client.query(`SELECT inet_server_addr()::text AS host,
      current_setting('server_version_num')::integer AS version_num,
      (SELECT system_identifier::text FROM pg_control_system()) AS cluster_id`)
    check(`cluster desechable loopback 16+ confirmado (${JSON.stringify(identity.rows[0])})`, identity.rows[0].host === '127.0.0.1/32'
      && identity.rows[0].version_num >= 160000 && Boolean(identity.rows[0].cluster_id))
    console.log(`Cluster desechable en 127.0.0.1:${port}; aplicando paquete COD...`)

    await client.query(schema)
    await client.query(applySql)
    const funcs = await client.query(`SELECT
      to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL AS summary,
      to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL AS reconcile,
      to_regclass('public.cod_conciliacion_idempotencia') IS NOT NULL AS tabla`)
    check('el paquete aplica: resumen, conciliacion y tabla de idempotencia presentes',
      funcs.rows[0].summary && funcs.rows[0].reconcile && funcs.rows[0].tabla)

    await client.query(`INSERT INTO public.usuarios(id,cuenta_id,nombre,rol) VALUES($1,$2,'Fixture admin','administracion')`,
      [ids.actor, ids.account])
    await client.query('INSERT INTO public.clientes(id,cuenta_id) VALUES($1,$2)', [ids.customer, ids.account])
    await client.query(`INSERT INTO public.notas_despacho(id,numero,cuenta_id,estado,cliente_id,total_usd,forma_pago,forma_pago_cliente)
      VALUES($1,19001,$2,'entregada',$3,270,'[{"metodo":"Cobro a destino","monto":270}]','[{"metodo":"Cobro a destino","monto":270}]')`,
      [ids.dispatch, ids.account, ids.customer])
    await client.query(`INSERT INTO public.cuentas_por_cobrar(cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,forma_pago_abono,descripcion,registrado_por)
      VALUES($1,$2,$3,'abono',100,170,'cod','Efectivo $','Pago externo COD — evidencia: ensayo rollback',$4)`,
      [ids.account, ids.customer, ids.dispatch, ids.actor])
    await client.query(`INSERT INTO public.auditoria(usuario_id,usuario_nombre,usuario_rol,categoria,accion,descripcion,entidad_tipo,entidad_id,meta,ip_origen,cuenta_id)
      VALUES($1,'Fixture admin','administracion','COTIZACION','COD_CONCILIADO_CON_EVIDENCIA','Cobro COD registrado en ledger para despacho #19001','despacho',$2,'{"ensayo":true}',NULL,$3)`,
      [ids.actor, ids.dispatch, ids.account])
    await client.query(`INSERT INTO public.cod_conciliacion_idempotencia(cuenta_id,idempotency_key,despacho_id,payload_hash,resultado)
      VALUES($1,$2,$3,'hash-fixture-rollback','{"ok":true,"estado_cod":"cobrado"}'::jsonb)`,
      [ids.account, ids.idemKey, ids.dispatch])
    check('historial financiero sembrado (abono CxC, auditoria, fila de idempotencia)', true)

    // Guard 1: comentario de resumen alterado => el rollback se niega y no retira nada.
    await client.query(`COMMENT ON FUNCTION public.resumen_financiero_despacho(UUID,UUID) IS 'TAMPERED POR ENSAYO'`)
    await expectRejected('guard SUMMARY_OWNER_MISMATCH bloquea el rollback si el comentario no coincide',
      () => client.query(rollbackSql), 'ROLLBACK_14_COD_SUMMARY_OWNER_MISMATCH')
    await client.query(`COMMENT ON FUNCTION public.resumen_financiero_despacho(UUID,UUID) IS '${COMMENT_SUMMARY}'`)
    let sigue = await client.query(`SELECT to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL AS s`)
    check('el rollback rechazado no retiro ninguna funcion', sigue.rows[0].s === true)

    // Guard 2: comentario de conciliacion alterado => idem.
    await client.query(`COMMENT ON FUNCTION public.registrar_pago_externo_cobro_idempotente(UUID,UUID,UUID,UUID,TEXT,JSONB,TEXT,TEXT) IS 'TAMPERED POR ENSAYO'`)
    await expectRejected('guard RECONCILE_OWNER_MISMATCH bloquea el rollback si el comentario no coincide',
      () => client.query(rollbackSql), 'ROLLBACK_14_COD_RECONCILE_OWNER_MISMATCH')
    await client.query(`COMMENT ON FUNCTION public.registrar_pago_externo_cobro_idempotente(UUID,UUID,UUID,UUID,TEXT,JSONB,TEXT,TEXT) IS '${COMMENT_RECONCILE}'`)
    sigue = await client.query(`SELECT to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL AS r`)
    check('el segundo rollback rechazado tampoco retiro ninguna funcion', sigue.rows[0].r === true)

    // Rollback real.
    await client.query(rollbackSql)
    const estado = await client.query(`SELECT
      to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL AS summary,
      to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL AS reconcile,
      to_regclass('public.cod_conciliacion_idempotencia') IS NOT NULL AS tabla,
      to_regprocedure('public.recalcularcomisiondespacho_238b(uuid)') IS NOT NULL AS stub`)
    check('el rollback retira ambas funciones y retiene la tabla de idempotencia',
      !estado.rows[0].summary && !estado.rows[0].reconcile && estado.rows[0].tabla && estado.rows[0].stub)

    const hist = await client.query('SELECT payload_hash, resultado FROM public.cod_conciliacion_idempotencia WHERE idempotency_key=$1', [ids.idemKey])
    check('la fila de idempotencia se conserva intacta (historial financiero)',
      hist.rows.length === 1 && hist.rows[0].payload_hash === 'hash-fixture-rollback' && hist.rows[0].resultado?.estado_cod === 'cobrado')
    const cxc = await client.query(`SELECT count(*)::int AS n FROM public.cuentas_por_cobrar WHERE tipo='abono'`)
    check('los abonos del ledger no se eliminan', cxc.rows[0].n === 1)
    const aud = await client.query(`SELECT count(*)::int AS n FROM public.auditoria WHERE accion='COD_CONCILIADO_CON_EVIDENCIA'`)
    check('las filas de auditoria no se eliminan', aud.rows[0].n === 1)
    const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.cod_conciliacion_idempotencia'::regclass`)
    check('la tabla retenida conserva RLS activo', rls.rows[0].relrowsecurity === true)

    // El rollback es re-ejecutable en una emergencia (DROP IF EXISTS + guards sin funciones).
    await client.query(rollbackSql)
    check('el rollback es re-ejecutable sin errores (segunda corrida)', true)

    completedSuccessfully = true
    console.log('PASS: rollback 14 COD ensayado en PostgreSQL desechable; funciones retiradas, historial financiero retenido, guards verificados y rollback re-ejecutable.')
  } finally {
    if (client) await client.end().catch(() => {})
    if (logOpen) { try { fs.closeSync(logFd) } catch {} }
    if (server) {
      const stoppedServer = spawnSync(process.platform === 'win32' ? tools.pgCtl.replaceAll('\\', '/') : tools.pgCtl,
        ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'],
        { encoding: 'utf8', windowsHide: true, timeout: 40_000 })
      if (stoppedServer.error || stoppedServer.status !== 0) {
        if (!fs.existsSync(path.join(cluster, 'postmaster.pid'))) stopped = true
        else console.error(`CLUSTER CONSERVADO PARA DIAGNOSTICO: ${path.relative(ROOT, cluster)}; ${stoppedServer.stderr || stoppedServer.error?.message || ''}`)
      } else stopped = true
    } else if (fs.existsSync(cluster) && fs.readdirSync(cluster).length === 0) stopped = true
    if (stopped) {
      try {
        fs.rmSync(clusterRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      } catch (error) {
        console.error(`No se pudo borrar el cluster temporal ${path.relative(ROOT, clusterRoot)}: ${error.message}`)
        if (completedSuccessfully) throw error
      }
    }
  }
}

await run()
