#!/usr/bin/env node
/**
 * Local-only integration contract for release 14 COD SQL.
 * Uses a newly-created PostgreSQL cluster bound to 127.0.0.1; never reads env
 * files or connects to Supabase. Requires local PostgreSQL 16+ binaries and
 * does not install tools. The release REVIEW_ONLY gate is removed only after
 * verifying its exact literal text so the rest of the SQL is exercised.
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import pg from 'pg'
import { convertBsToUsd } from '../src/utils/codCurrency.js'

const ROOT = process.cwd()
const RELEASE_DIR = 'supabase/release/main'
const migration = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '14_cod_financial_rpcs_review.sql'), 'utf8')
const preflight = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '14_cod_preflight_readonly.sql'), 'utf8')
const postflight = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '14_cod_postflight_readonly.sql'), 'utf8')
const gate = `DO $review_gate$\nBEGIN\n  RAISE EXCEPTION 'REVIEW_ONLY: 14_cod_financial_rpcs_review.sql requiere aprobacion, backup y prueba aislada';\nEND;\n$review_gate$;`
if (process.argv.length !== 3 || process.argv[2] !== '--verify-local') {
  throw new Error('Uso: node scripts/test-cod-main-release-local.mjs --verify-local')
}
if (!migration.includes(gate) || migration.split(gate).length !== 2) {
  throw new Error('El gate REVIEW_ONLY no coincide exactamente; no se modificará/ejecutará el paquete.')
}
console.log('Local only: no lee .env, no usa Supabase URL, Management API ni conexión remota.')

const check = (label, ok) => {
  if (!ok) throw new Error(`FAIL: ${label}`)
  console.log(`  ✓ ${label}`)
}
async function expectRejected(label, operation, expectedMessage) {
  try {
    await operation()
  } catch (error) {
    check(label, !expectedMessage || String(error.message).includes(expectedMessage))
    return
  }
  throw new Error(`FAIL: ${label}; esperaba rechazo${expectedMessage ? ` ${expectedMessage}` : ''}`)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

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
CREATE FUNCTION public.cod_test_sync_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $trigger$
DECLARE v_client uuid; v_balance numeric(12,4);
BEGIN
  v_client := COALESCE(NEW.cliente_id,OLD.cliente_id);
  SELECT GREATEST(0,COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd ELSE -monto_usd END),0))
    INTO v_balance FROM public.cuentas_por_cobrar WHERE cliente_id=v_client;
  UPDATE public.clientes SET saldo_pendiente=v_balance WHERE id=v_client;
  RETURN NULL;
END;
$trigger$;
CREATE TRIGGER cod_test_balance AFTER INSERT OR UPDATE OR DELETE ON public.cuentas_por_cobrar
  FOR EACH ROW EXECUTE FUNCTION public.cod_test_sync_balance();
`

const ids = {
  account: '8f3438c8-a601-4c20-8a11-000000000001',
  actor: '8f3438c8-a601-4c20-8a11-000000000002',
  seller: '8f3438c8-a601-4c20-8a11-000000000003',
  customer: '8f3438c8-a601-4c20-8a11-000000000004',
  dispatch: '8f3438c8-a601-4c20-8a11-000000000005',
  bsDispatch: '8f3438c8-a601-4c20-8a11-000000000008',
  mismatchDispatch: '8f3438c8-a601-4c20-8a11-000000000006',
  otherAccount: '8f3438c8-a601-4c20-8a11-000000000007',
  partialKey: '8f3438c8-a601-4c20-8a11-000000000101',
  overpayKey: '8f3438c8-a601-4c20-8a11-000000000103',
  mismatchKey: '8f3438c8-a601-4c20-8a11-000000000104',
  actorKey: '8f3438c8-a601-4c20-8a11-000000000106',
  evidenceKey: '8f3438c8-a601-4c20-8a11-000000000107',
  finalKey: '8f3438c8-a601-4c20-8a11-000000000108',
  finalShortKey: '8f3438c8-a601-4c20-8a11-000000000112',
  bsKey: '8f3438c8-a601-4c20-8a11-000000000109',
  bsInvalidKey: '8f3438c8-a601-4c20-8a11-000000000110',
  bsSecondKey: '8f3438c8-a601-4c20-8a11-000000000111',
}

async function run() {
  const tools = postgresTools()
  const scratch = path.join(ROOT, '.wrangler')
  fs.mkdirSync(scratch, { recursive: true })
  const clusterRoot = fs.mkdtempSync(path.join(scratch, 'pg-cod-main-release-'))
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
  try {
    const init = spawnSync(tools.initdb.replaceAll('\\', '/'),
      ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    if (init.error || init.status !== 0) throw init.error || new Error(`initdb falló: ${(init.stderr || '').slice(-1000)}`)
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
    if (!client) throw new Error(`No conectó al PostgreSQL local: ${fs.readFileSync(logPath, 'utf8').slice(-1200)}`)
    const identity = await client.query(`SELECT inet_server_addr()::text AS host,
      current_setting('server_version_num')::integer AS version_num,
      (SELECT system_identifier::text FROM pg_control_system()) AS cluster_id`)
    check(`PostgreSQL confirmado como cluster loopback 16+ (${JSON.stringify(identity.rows[0])})`, identity.rows[0].host === '127.0.0.1/32'
      && identity.rows[0].version_num >= 160000 && Boolean(identity.rows[0].cluster_id))
    console.log(`Cluster desechable en 127.0.0.1:${port}; PostgreSQL ${identity.rows[0].version_num}`)
    await client.query(schema)
    await client.query(migration.replace(gate, ''))
    const halfCentCases = [
      ['200.01', '2'], ['20000.01', '2'], ['20000000.01', '2'],
      ['20000.01', '3'], ['20000.01', '1.23456789'],
    ]
    for (const [amountBs, rate] of halfCentCases) {
      const postgres = await client.query(
        'SELECT round($1::numeric / $2::numeric, 2)::TEXT AS usd', [amountBs, rate],
      )
      const js = convertBsToUsd(amountBs, Number(rate))
      check(`conversión decimal JS coincide con PostgreSQL (${amountBs} Bs / ${rate})`,
        js === Number(postgres.rows[0].usd))
    }
    const funcs = await client.query(`SELECT
      to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL AS summary,
      to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL AS reconcile`)
    check('el SQL review instala resumen y conciliación', funcs.rows[0].summary && funcs.rows[0].reconcile)

    await client.query(`INSERT INTO public.usuarios(id,cuenta_id,nombre,rol) VALUES
      ($1,$2,'Fixture admin','administracion'),($3,$2,'Fixture seller','vendedor'),
      ($4,$5,'Other tenant','administracion')`,
    [ids.actor, ids.account, ids.seller, ids.otherAccount, ids.otherAccount])
    await client.query('INSERT INTO public.clientes(id,cuenta_id) VALUES($1,$2)', [ids.customer, ids.account])
    const forms = [
      { metodo: 'Zelle', monto: 0, source_marker: 'forma_pago' },
      { metodo: 'Cobro a destino', monto: 270, cobro_destino_pagado: false, conciliado_sin_abono: false,
        metodos_pagados: [{ metodo: 'Base pago', monto: 1 }] },
    ]
    const clientForms = [
      { metodo: 'Efectivo $', monto: 0, source_marker: 'forma_pago_cliente' },
      { metodo: 'Cobro a destino', monto: 270, cobro_destino_pagado: false, conciliado_sin_abono: false,
        metodos_pagados: [{ metodo: 'Base cliente', monto: 2 }] },
    ]
    const insertDispatch = (dispatch, number, paymentForms, paymentClientForms) => client.query(`INSERT INTO public.notas_despacho
      (id,numero,cuenta_id,estado,cliente_id,cliente_factura_id,total_usd,forma_pago,forma_pago_cliente)
      VALUES($1,$2,$3,'entregada',$4,$4,270,$5,$6)`,
    [dispatch, number, ids.account, ids.customer, JSON.stringify(paymentForms), JSON.stringify(paymentClientForms)])
    const summary = (account, dispatch) => client.query(
      'SELECT public.resumen_financiero_despacho($1,$2) AS result', [account, dispatch]).then(result => result.rows[0].result)
    const pay = (dispatch, key, payments, evidence = 'fixture comprobante verificado', account = ids.account, actor = ids.actor) =>
      client.query('SELECT public.registrar_pago_externo_cobro_idempotente($1,$2,$3,$4,$5,$6::jsonb,$7,$8) AS result',
        [account, dispatch, key, actor, 'Fixture admin', JSON.stringify(payments), evidence, '127.0.0.1'])
        .then(result => result.rows[0].result)

    await insertDispatch(ids.dispatch, 14101, forms, clientForms)
    await client.query(`INSERT INTO public.cuentas_por_cobrar
      (cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,descripcion,registrado_por)
      VALUES($1,$2,$3,'cargo',270,270,'cod','fixture COD cargo',$4)`, [ids.account, ids.customer, ids.dispatch, ids.seller])
    await client.query(`INSERT INTO public.cuentas_por_cobrar
      (cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,forma_pago_abono,descripcion,registrado_por)
      VALUES($1,$2,$3,'abono',96,174,'cod','Devolución','fixture COD devolución',$4)`, [ids.account, ids.customer, ids.dispatch, ids.seller])
    const initial = await summary(ids.account, ids.dispatch)
    check('saldo inicial $174: COD $270 − devolución $96; sin efectivo cobrado',
      initial.cod.estado === 'pendiente' && Number(initial.ledger.deuda_cod_usd) === 174
        && Number(initial.ledger.cobrado_usd) === 0 && Number(initial.ledger.compensado_usd) === 96)
    await expectRejected('resumen no filtra fuera del tenant', () => summary(ids.otherAccount, ids.dispatch), 'DESPACHO_NO_ENCONTRADO_O_SIN_PERMISO')
    await expectRejected('rechaza un exceso de dos centavos sobre el saldo neto',
      () => pay(ids.dispatch, ids.overpayKey, [{ metodo: 'Zelle', monto: 174.02, referencia: 'TX-OVER' }]),
      'COD_CONCILIACION_MONTO_NO_COINCIDE')
    await expectRejected('requiere evidencia verificable',
      () => pay(ids.dispatch, ids.evidenceKey, [{ metodo: 'Zelle', monto: 10, referencia: 'TX-10' }], ''),
      'COD_CONCILIACION_PARAMETROS_INVALIDOS')
    await expectRejected('rechaza operador ajeno al tenant',
      () => pay(ids.dispatch, ids.actorKey, [{ metodo: 'Zelle', monto: 10, referencia: 'TX-ACTOR' }], 'fixture evidence', ids.account, ids.otherAccount),
      'COD_CONCILIACION_ACTOR_NO_AUTORIZADO')

    const mismatchClientForms = [
      { metodo: 'Efectivo $', monto: 0, source_marker: 'forma_pago_cliente' },
      { metodo: 'Cobro a destino', monto: 269, cobro_destino_pagado: false },
    ]
    await insertDispatch(ids.mismatchDispatch, 14102, forms, mismatchClientForms)
    await client.query(`INSERT INTO public.cuentas_por_cobrar
      (cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,descripcion,registrado_por)
      VALUES($1,$2,$3,'cargo',270,270,'cod','fixture mismatch',$4)`, [ids.account, ids.customer, ids.mismatchDispatch, ids.seller])
    await expectRejected('falla cerrado si los COD de ambas columnas no coinciden',
      () => pay(ids.mismatchDispatch, ids.mismatchKey, [{ metodo: 'Zelle', monto: 10, referencia: 'TX-MISMATCH' }]),
      'COD_CONCILIACION_FORMA_PAGO_INVALIDA')

    const partial = await pay(ids.dispatch, ids.partialKey, [{ metodo: 'Zelle', monto: 100, referencia: 'TX-PARTIAL' }])
    check('pago parcial agrega $100 y deja $74 COD', partial.estado_cod === 'parcial' && Number(partial.saldo_restante_usd) === 74)
    check('el recálculo de comisión se difiere hasta pago final',
      Number((await client.query('SELECT calls FROM public.cod_recalc_calls WHERE despacho_id=$1', [ids.dispatch])).rows[0]?.calls || 0) === 0)
    const partialSummary = await summary(ids.account, ids.dispatch)
    check('RPC summary post-parcial: $74 deuda, $100 efectivo, $96 compensación',
      partialSummary.cod.estado === 'parcial' && Number(partialSummary.ledger.deuda_cod_usd) === 74
        && Number(partialSummary.ledger.cobrado_usd) === 100 && Number(partialSummary.ledger.compensado_usd) === 96)
    const [partialRow] = (await client.query('SELECT forma_pago,forma_pago_cliente FROM public.notas_despacho WHERE id=$1', [ids.dispatch])).rows
    const parse = value => typeof value === 'string' ? JSON.parse(value) : value
    const paymentPartial = parse(partialRow.forma_pago)
    const clientPartial = parse(partialRow.forma_pago_cliente)
    check('dos JSON parciales conservan marcador y método de cada fuente',
      paymentPartial[0].source_marker === 'forma_pago' && clientPartial[0].source_marker === 'forma_pago_cliente'
        && paymentPartial[1].conciliado_sin_abono === false && clientPartial[1].conciliado_sin_abono === false
        && Number(paymentPartial[1].metodos_pagados.at(-1).monto) === 100
        && Number(clientPartial[1].metodos_pagados.at(-1).monto) === 100)
    const replay = await pay(ids.dispatch, ids.partialKey, [{ metodo: 'Zelle', monto: 100, referencia: 'TX-PARTIAL' }])
    check('retry devuelve el resultado idempotente', replay.idempotent === true && replay.abono_ids.length === 1)
    check('retry no duplica asiento CxC', Number((await client.query("SELECT count(*)::int AS n FROM public.cuentas_por_cobrar WHERE despacho_id=$1 AND tipo='abono'", [ids.dispatch])).rows[0].n) === 2)
    await expectRejected('la misma clave no acepta payload distinto',
      () => pay(ids.dispatch, ids.partialKey, [{ metodo: 'Zelle', monto: 99, referencia: 'TX-OTHER' }]),
      'COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA')

    const shortFinal = await pay(ids.dispatch, ids.finalShortKey,
      [{ metodo: 'Efectivo $', monto: 73.99 }], 'fixture pago con un centavo pendiente')
    check('un centavo pendiente mantiene COD parcial y no completa saldo',
      shortFinal.estado_cod === 'parcial' && Number(shortFinal.saldo_restante_usd) === 0.01
        && Number(shortFinal.excedente_usd) === 0)
    check('no recalcula comisión mientras queda un centavo pendiente',
      Number((await client.query('SELECT calls FROM public.cod_recalc_calls WHERE despacho_id=$1', [ids.dispatch])).rows[0]?.calls || 0) === 0)
    const shortSummary = await summary(ids.account, ids.dispatch)
    check('summary reporta un centavo de deuda y estado parcial',
      shortSummary.cod.estado === 'parcial' && Number(shortSummary.ledger.deuda_cod_usd) === 0.01)

    const final = await pay(ids.dispatch, ids.finalKey, [{ metodo: 'Efectivo $', monto: 0.02 }], 'fixture pago final con un centavo extra')
    check('acepta un centavo de exceso y cierra el saldo', final.estado_cod === 'cobrado'
      && Number(final.saldo_restante_usd) === 0 && Number(final.excedente_usd) === 0.01)
    const finalSummary = await summary(ids.account, ids.dispatch)
    check('RPC summary post-final reporta $0 deuda, $174.01 cash y $96 compensado',
      finalSummary.cod.estado === 'cobrado' && finalSummary.cod.revisar === false
        && Number(finalSummary.ledger.deuda_cod_usd) === 0
        && Number(finalSummary.ledger.cobrado_usd) === 174.01
        && Number(finalSummary.ledger.compensado_usd) === 96)
    const [finalRow] = (await client.query('SELECT forma_pago,forma_pago_cliente FROM public.notas_despacho WHERE id=$1', [ids.dispatch])).rows
    const paymentFinal = parse(finalRow.forma_pago)
    const clientFinal = parse(finalRow.forma_pago_cliente)
    check('dos JSON finales coherentes y separados',
      paymentFinal[0].source_marker === 'forma_pago' && clientFinal[0].source_marker === 'forma_pago_cliente'
        && paymentFinal[1].cobro_destino_pagado === true && clientFinal[1].cobro_destino_pagado === true
        && paymentFinal[1].conciliado_sin_abono === false && clientFinal[1].conciliado_sin_abono === false
        && Number(paymentFinal[1].metodos_pagados.at(-1).monto) === 0.02
        && Number(clientFinal[1].metodos_pagados.at(-1).monto) === 0.02)
    check('registra el centavo excedente explícitamente en la auditoría',
      Number((await client.query("SELECT meta->>'excedente_usd' AS excedente FROM public.auditoria WHERE entidad_id=$1 AND accion='COD_CONCILIADO_CON_EVIDENCIA' ORDER BY id DESC LIMIT 1", [ids.dispatch])).rows[0].excedente) === 0.01)
    check('llama recalcular comisión exactamente una vez al final',
      Number((await client.query('SELECT calls FROM public.cod_recalc_calls WHERE despacho_id=$1', [ids.dispatch])).rows[0].calls) === 1)

    const idempotencyFk = await client.query(`SELECT conname, confdeltype FROM pg_constraint
      WHERE conrelid = 'public.cod_conciliacion_idempotencia'::regclass AND contype = 'f'`)
    check('FK de idempotencia hacia notas_despacho es ON DELETE RESTRICT',
      idempotencyFk.rows.some(row => row.conname === 'cod_conciliacion_idempotencia_despacho_id_fkey' && row.confdeltype === 'r'))
    let deleteError = null
    try {
      await client.query('DELETE FROM public.notas_despacho WHERE id=$1', [ids.dispatch])
    } catch (error) {
      deleteError = error
    }
    check('no se puede borrar un despacho con pagos registrados (SQLSTATE 23503 por FK de CxC o idempotencia)',
      deleteError?.code === '23503'
        && ['cuentas_por_cobrar_despacho_id_fkey', 'cod_conciliacion_idempotencia_despacho_id_fkey'].includes(deleteError?.constraint))
    // Aislar la regla de R14: sin asientos CxC, el único bloqueo posible es la FK
    // RESTRICT de cod_conciliacion_idempotencia. Todo se revierte con ROLLBACK.
    await client.query('BEGIN')
    await client.query('DELETE FROM public.cuentas_por_cobrar WHERE despacho_id=$1', [ids.dispatch])
    let isolatedError = null
    try {
      await client.query('DELETE FROM public.notas_despacho WHERE id=$1', [ids.dispatch])
    } catch (error) {
      isolatedError = error
    }
    await client.query('ROLLBACK')
    check('sin asientos CxC, el borrado lo bloquea solo la restricción RESTRICT de R14',
      isolatedError?.code === '23503'
        && isolatedError?.constraint === 'cod_conciliacion_idempotencia_despacho_id_fkey')
    const stillThere = await client.query(
      `SELECT (SELECT count(*)::int FROM public.notas_despacho WHERE id=$1) AS dispatches,
              (SELECT count(*)::int FROM public.cod_conciliacion_idempotencia WHERE despacho_id=$1) AS idempotency_rows`,
      [ids.dispatch])
    check('el despacho y sus registros de pago siguen intactos tras el rechazo',
      stillThere.rows[0].dispatches === 1 && stillThere.rows[0].idempotency_rows > 0)

    await insertDispatch(ids.bsDispatch, 14103, forms, clientForms)
    await client.query(`INSERT INTO public.cuentas_por_cobrar
      (cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,descripcion,registrado_por)
      VALUES($1,$2,$3,'cargo',270,270,'cod','fixture COD Bs',$4)`, [ids.account, ids.customer, ids.bsDispatch, ids.seller])
    const pagoBs = { metodo: 'Efectivo Bs', monto: 100, monto_bs: 20000, tasa_snapshot: 200,
      tasa_fuente: 'USDT', tasa_actualizada_en: '2026-10-02T12:00:00.000Z' }
    await expectRejected('rechaza snapshot Bs con equivalente USD manipulado',
      () => pay(ids.bsDispatch, ids.bsInvalidKey, [{ ...pagoBs, monto: 101 }]), 'COD_CONCILIACION_TASA_BS_INVALIDA')
    const cobroBs = await pay(ids.bsDispatch, ids.bsKey, [pagoBs])
    check('efectivo Bs calcula USD por la tasa snapshot del pago', cobroBs.pago_usd === 100)
    await pay(ids.bsDispatch, ids.bsSecondKey, [{ metodo: 'Efectivo Bs', monto: 60, monto_bs: 18000,
      tasa_snapshot: 300, tasa_fuente: 'USDT', tasa_actualizada_en: '2026-10-02T13:00:00.000Z' }])
    const bsRows = await client.query(`SELECT monto_usd,descripcion FROM public.cuentas_por_cobrar
      WHERE despacho_id=$1 AND tipo='abono'`, [ids.bsDispatch])
    check('cada asiento USD conserva su propio snapshot Bs/tasa/equivalente/fecha',
      bsRows.rows.length === 2
        && bsRows.rows.some(row => Number(row.monto_usd) === 100 && row.descripcion.includes('recibido=20000')
          && row.descripcion.includes('tasa=200') && row.descripcion.includes('equivalente_usd=100'))
        && bsRows.rows.some(row => Number(row.monto_usd) === 60 && row.descripcion.includes('recibido=18000')
          && row.descripcion.includes('tasa=300') && row.descripcion.includes('equivalente_usd=60'))
        && bsRows.rows.every(row => row.descripcion.includes('fuente=USDT') && row.descripcion.includes('confirmado_en=')))
    const bsForms = await client.query('SELECT forma_pago_cliente FROM public.notas_despacho WHERE id=$1', [ids.bsDispatch])
    const bsSnapshots = parse(bsForms.rows[0].forma_pago_cliente)[1].metodos_pagados.slice(-2)
    check('abonos parciales conservan snapshots independientes sin revaluar el anterior',
      Number(bsSnapshots[0].monto_bs) === 20000 && Number(bsSnapshots[0].tasa_snapshot) === 200
        && Number(bsSnapshots[0].equivalente_usd) === 100
        && Number(bsSnapshots[1].monto_bs) === 18000 && Number(bsSnapshots[1].tasa_snapshot) === 300
        && Number(bsSnapshots[1].equivalente_usd) === 60
        && bsSnapshots.every(snapshot => snapshot.tasa_fuente === 'USDT' && Boolean(snapshot.tasa_confirmada_en)))

    const balanceCheck = await client.query(`SELECT c.saldo_pendiente,
      COALESCE(SUM(CASE WHEN x.tipo='cargo' THEN x.monto_usd ELSE -x.monto_usd END),0) AS ledger_balance,
      count(x.id)::int AS ledger_rows
      FROM public.clientes c LEFT JOIN public.cuentas_por_cobrar x ON x.cliente_id=c.id
      WHERE c.id=$1 GROUP BY c.id`, [ids.customer])
    const finalClientBalance = Number(balanceCheck.rows[0].saldo_pendiente)
    check(`el trigger fixture sincroniza saldo final con CxC (balance=${finalClientBalance}, ledger=${balanceCheck.rows[0].ledger_balance}, rows=${balanceCheck.rows[0].ledger_rows})`,
      finalClientBalance === Number(balanceCheck.rows[0].ledger_balance))

    const summaryGrants = await client.query(`SELECT
      has_function_privilege('service_role','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE') AS service,
      has_function_privilege('authenticated','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE') AS auth,
      has_function_privilege('anon','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE') AS anon`)
    const reconcileGrants = await client.query(`SELECT
      has_function_privilege('service_role','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE') AS service,
      has_function_privilege('authenticated','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE') AS auth,
      has_function_privilege('anon','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE') AS anon`)
    check('RPCs solo ejecutables por service_role',
      summaryGrants.rows[0].service && !summaryGrants.rows[0].auth && !summaryGrants.rows[0].anon
        && reconcileGrants.rows[0].service && !reconcileGrants.rows[0].auth && !reconcileGrants.rows[0].anon)

    const preflightOutput = await client.query(preflight)
    check('preflight SQL puede ejecutarse read-only en el esquema de prueba', Boolean(preflightOutput.rows[0]?.cod_main_preflight))
    const postflightOutput = await client.query(postflight)
    check('postflight confirma contrato y preservación independiente de ambos campos',
      postflightOutput.rows[0]?.cod_main_postflight?.both_columns_updated_independently === true
        && postflightOutput.rows[0]?.cod_main_postflight?.rate_snapshot_contract_present === true)
    check('postflight exige saldo cero para liquidar y permite exceso máximo de un centavo explícito',
      postflightOutput.rows[0]?.cod_main_postflight?.cod_completion_requires_zero_debt === true
        && postflightOutput.rows[0]?.cod_main_postflight?.cod_allows_maximum_one_cent_overpayment === true
        && postflightOutput.rows[0]?.cod_main_postflight?.cod_records_overpayment_explicitly === true)
    completedSuccessfully = true
    console.log('PASS: COD principal; resumen, parcial/final, Bs/tasa snapshot, idempotencia y dos JSON independientes.')
  } finally {
    if (client) await client.end().catch(() => {})
    if (logOpen) { try { fs.closeSync(logFd) } catch {} }
    if (server) {
      const stoppedServer = spawnSync(process.platform === 'win32' ? tools.pgCtl.replaceAll('\\', '/') : tools.pgCtl,
        ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'],
        { encoding: 'utf8', windowsHide: true, timeout: 40_000 })
      if (stoppedServer.error || stoppedServer.status !== 0) {
        if (!fs.existsSync(path.join(cluster, 'postmaster.pid'))) stopped = true
        else console.error(`CLUSTER CONSERVADO PARA DIAGNÓSTICO: ${path.relative(ROOT, cluster)}; ${stoppedServer.stderr || stoppedServer.error?.message || ''}`)
      } else stopped = true
    } else if (fs.existsSync(cluster) && fs.readdirSync(cluster).length === 0) stopped = true
    if (stopped) {
      try {
        fs.rmSync(clusterRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      } catch (error) {
        console.error(`No se pudo borrar el clúster temporal ${path.relative(ROOT, clusterRoot)}: ${error.message}`)
        if (completedSuccessfully) throw error
      }
    }
  }
}

await run()
