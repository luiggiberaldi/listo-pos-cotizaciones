#!/usr/bin/env node
/**
 * Local-only integration contract for release 19 COD mixto (mixed credit+COD).
 * Uses a newly-created PostgreSQL cluster bound to 127.0.0.1; never reads env
 * files or connects to Supabase. Requires local PostgreSQL 16+ binaries and
 * does not install tools.
 *
 * Rehearses the REAL upgrade path:
 *   phase 1  install release 14 (14_cod_financial_rpcs_apply.sql) and pin the
 *            100%-COD flow (baseline snapshot)
 *   phase 2  upgrade to release 19 (19_cod_mixto_review.sql minus its gate);
 *            assert the 100%-COD snapshots are IDENTICAL (regression) and run
 *            the mixed-payment matrix (10 cases)
 *   phase 3  release-19 preflight/postflight read-only checks
 *   phase 4  rollback (19_cod_rollback_review.sql minus its gate); assert the
 *            release-14 semantics are restored byte-for-byte in behavior
 *
 * Usage: node scripts/test-cod-mixto-release-local.mjs --verify-local
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import pg from 'pg'

const ROOT = process.cwd()
const RELEASE_DIR = 'supabase/release/main'
const release14 = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '14_cod_financial_rpcs_apply.sql'), 'utf8')
const migration = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '19_cod_mixto_review.sql'), 'utf8')
const rollbackSql = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '19_cod_rollback_review.sql'), 'utf8')
const preflight = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '19_cod_preflight_readonly.sql'), 'utf8')
const postflight = fs.readFileSync(path.join(ROOT, RELEASE_DIR, '19_cod_postflight_readonly.sql'), 'utf8')

const gate18 = `DO $review_gate$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 19_cod_mixto_review.sql requiere aprobacion, backup y prueba aislada';
END;
$review_gate$;`
const gateRollback = `DO $review_gate$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 19_cod_rollback_review.sql requiere aprobacion explicita de rollback';
END;
$review_gate$;`

if (process.argv.length !== 3 || process.argv[2] !== '--verify-local') {
  throw new Error('Uso: node scripts/test-cod-mixto-release-local.mjs --verify-local')
}
if (!migration.includes(gate18) || migration.split(gate18).length !== 2) {
  throw new Error('El gate REVIEW_ONLY del review 19 no coincide exactamente; no se modificará/ejecutará el paquete.')
}
if (!rollbackSql.includes(gateRollback) || rollbackSql.split(gateRollback).length !== 2) {
  throw new Error('El gate REVIEW_ONLY del rollback 19 no coincide exactamente; no se ejecutará.')
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
const n2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100

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
-- La tabla cod_conciliacion_idempotencia la crea el propio release 14
-- (CREATE TABLE IF NOT EXISTS + comentario de contrato): ruta de upgrade fiel.
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
  otherAccount: '8f3438c8-a601-4c20-8a11-000000000007',
  d100a: '8f3438c8-a601-4c20-8a11-00000000a001',
  d100b: '8f3438c8-a601-4c20-8a11-00000000a002',
  dMix: '8f3438c8-a601-4c20-8a11-00000000a003',
  dPart: '8f3438c8-a601-4c20-8a11-00000000a004',
  dCredit: '8f3438c8-a601-4c20-8a11-00000000a005',
  dOver: '8f3438c8-a601-4c20-8a11-00000000a006',
  dFlag: '8f3438c8-a601-4c20-8a11-00000000a007',
  dAmb: '8f3438c8-a601-4c20-8a11-00000000a008',
  dSpill: '8f3438c8-a601-4c20-8a11-00000000a009',
  dCompA: '8f3438c8-a601-4c20-8a11-00000000a010',
  dCompB: '8f3438c8-a601-4c20-8a11-00000000a011',
  dSoloComp: '8f3438c8-a601-4c20-8a11-00000000a012',
  dNota: '8f3438c8-a601-4c20-8a11-00000000a013',
  dRef: '8f3438c8-a601-4c20-8a11-00000000a014',
}

async function run() {
  const tools = postgresTools()
  const scratch = path.join(ROOT, '.wrangler')
  fs.mkdirSync(scratch, { recursive: true })
  const clusterRoot = fs.mkdtempSync(path.join(scratch, 'pg-cod-mixto-'))
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

    await client.query(`INSERT INTO public.usuarios(id,cuenta_id,nombre,rol) VALUES
      ($1,$2,'Fixture admin','administracion'),($3,$2,'Fixture seller','vendedor'),
      ($4,$5,'Other tenant','administracion')`,
    [ids.actor, ids.account, ids.seller, ids.otherAccount, ids.otherAccount])
    await client.query('INSERT INTO public.clientes(id,cuenta_id) VALUES($1,$2)', [ids.customer, ids.account])

    // ── helpers de fixtures y RPCs ──
    // Cada despacho fixture tiene SU PROPIO cliente: el guarda v14 de "deuda total
    // del cliente" compara el pago contra el saldo neto del cliente, y un centavo
    // excedente de un caso anterior contaminaría los siguientes (aislamiento real).
    const clienteDe = {}
    let clienteSeq = 0
    const codEntry = (monto, extra = {}) => ({ metodo: 'Cobro a destino', monto,
      cobro_destino_pagado: false, conciliado_sin_abono: false, ...extra })
    const insertDispatch = async (dispatch, number, forms, total) => {
      const cliente = `00000000-0000-4000-8000-${String(++clienteSeq).padStart(12, '0')}`
      await client.query('INSERT INTO public.clientes(id,cuenta_id) VALUES($1,$2)', [cliente, ids.account])
      clienteDe[dispatch] = cliente
      await client.query(`INSERT INTO public.notas_despacho
        (id,numero,cuenta_id,estado,cliente_id,cliente_factura_id,total_usd,forma_pago,forma_pago_cliente)
        VALUES($1,$2,$3,'entregada',$4,$4,$5,$6,$7)`,
      [dispatch, number, ids.account, cliente, total, JSON.stringify(forms), JSON.stringify(forms)])
    }
    const cargo = (dispatch, monto, metodo) => client.query(`INSERT INTO public.cuentas_por_cobrar
      (cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,descripcion,registrado_por)
      VALUES($1,$2,$3,'cargo',$4,$4,$5,'fixture cargo',$6)`,
    [ids.account, clienteDe[dispatch], dispatch, monto, metodo, ids.seller])
    const abono = (dispatch, monto, { metodoPago = null, forma = null, descripcion = 'fixture abono' } = {}) =>
      client.query(`INSERT INTO public.cuentas_por_cobrar
        (cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,forma_pago_abono,descripcion,registrado_por)
        VALUES($1,$2,$3,'abono',$4,$4,$5,$6,$7,$8)`,
      [ids.account, clienteDe[dispatch], dispatch, monto, metodoPago, forma, descripcion, ids.seller])
    const summary = (dispatch, account = ids.account) => client.query(
      'SELECT public.resumen_financiero_despacho($1,$2) AS result', [account, dispatch]).then(result => result.rows[0].result)
    const pay = (dispatch, key, payments, evidence = 'fixture comprobante verificado', account = ids.account, actor = ids.actor) =>
      client.query('SELECT public.registrar_pago_externo_cobro_idempotente($1,$2,$3,$4,$5,$6::jsonb,$7,$8) AS result',
        [account, dispatch, key, actor, 'Fixture admin', JSON.stringify(payments), evidence, '127.0.0.1'])
        .then(result => result.rows[0].result)
    const recalcCalls = async dispatch => Number((await client.query(
      'SELECT calls FROM public.cod_recalc_calls WHERE despacho_id=$1', [dispatch])).rows[0]?.calls || 0)
    const snap = resumen => JSON.parse(JSON.stringify({ ledger: resumen.ledger, cod: resumen.cod }))
    // Proyección SOLO a las claves del contrato v14: la regresión exige que esos
    // valores sean idénticos; el release 19 puede añadir claves nuevas aparte.
    const V14_LEDGER = ['cargo_usd', 'abono_usd', 'deuda_usd', 'cobrado_usd', 'compensado_usd',
      'cargo_cod_usd', 'abono_cod_usd', 'deuda_cod_usd', 'saldo_a_favor_cliente_usd']
    const V14_COD = ['presente', 'monto_nominal_usd', 'flag_pagado_legacy', 'conciliado_sin_abono_legacy', 'estado', 'revisar']
    const project = s => ({
      ledger: Object.fromEntries(V14_LEDGER.map(k => [k, s.ledger[k]])),
      cod: Object.fromEntries(V14_COD.map(k => [k, s.cod[k]])),
    })

    // ═════════ FASE 1: release 14 real + flujo 100% COD (línea base) ═════════
    console.log('─ Fase 1: instalación del release 14 real y pin del flujo 100% COD ─')
    await client.query(release14)
    const funcs14 = await client.query(`SELECT
      to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL AS summary,
      to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL AS reconcile`)
    check('el apply del release 14 instala resumen y conciliación', funcs14.rows[0].summary && funcs14.rows[0].reconcile)
    const pre18 = await client.query(preflight)
    check('preflight 19 detecta contrato release 14 intacto antes del upgrade',
      pre18.rows[0]?.cod_mixto_preflight?.functions_present === true
        && pre18.rows[0]?.cod_mixto_preflight?.summary_contract_is_release14 === true
        && pre18.rows[0]?.cod_mixto_preflight?.reconcile_contract_is_release14 === true
        && pre18.rows[0]?.cod_mixto_preflight?.release19_markers_absent === true)

    const cod100Forms = [
      { metodo: 'Zelle', monto: 0, source_marker: 'forma_pago' },
      codEntry(270, { metodos_pagados: [{ metodo: 'Base pago', monto: 1 }] }),
    ]
    const cod100ClientForms = [
      { metodo: 'Efectivo $', monto: 0, source_marker: 'forma_pago_cliente' },
      codEntry(270, { metodos_pagados: [{ metodo: 'Base cliente', monto: 2 }] }),
    ]
    // Flujo 100% COD idéntico al contrato release 14 (condensado del arnés 14).
    async function runCod100Flow(dispatch, keyPrefix) {
      const steps = []
      await insertDispatch(dispatch, keyPrefix.numero, cod100Forms, 270)
      await cargo(dispatch, 270, 'cod')
      await abono(dispatch, 96, { metodoPago: 'cod', forma: 'Devolución', descripcion: 'fixture COD devolución' })
      steps.push(snap(await summary(dispatch)))
      await pay(dispatch, keyPrefix.k1, [{ metodo: 'Zelle', monto: 100, referencia: 'TX-PARTIAL' }])
      steps.push(snap(await summary(dispatch)))
      const final = await pay(dispatch, keyPrefix.k2, [{ metodo: 'Efectivo $', monto: 74.01 }], 'fixture pago final con un centavo extra')
      steps.push(snap(await summary(dispatch)))
      return { steps, final }
    }
    const base = await runCod100Flow(ids.d100a, { numero: 18101, k1: '8f3438c8-a601-4c20-8a11-00000000b001', k2: '8f3438c8-a601-4c20-8a11-00000000b002' })
    check('v14: inicial $174 deuda (COD $270 − devolución $96), pendiente, sin efectivo',
      base.steps[0].cod.estado === 'pendiente' && n2(base.steps[0].ledger.deuda_cod_usd) === 174
        && n2(base.steps[0].ledger.cobrado_usd) === 0 && n2(base.steps[0].ledger.compensado_usd) === 96)
    check('v14: pago parcial $100 deja $74 y estado parcial',
      base.steps[1].cod.estado === 'parcial' && n2(base.steps[1].ledger.deuda_cod_usd) === 74)
    check('v14: pago final $74.01 cierra con $0.01 de excedente y estado cobrado',
      base.steps[2].cod.estado === 'cobrado' && n2(base.steps[2].ledger.deuda_cod_usd) === 0
        && n2(base.steps[2].ledger.cobrado_usd) === 174.01 && n2(base.final.excedente_usd) === 0.01)
    check('v14: comisión difiere hasta el pago final (una sola llamada)',
      await recalcCalls(ids.d100a) === 1)

    // ═════════ FASE 2: upgrade release 19 + matriz mixta ═════════
    console.log('─ Fase 2: upgrade al release 19 y matriz de pagos mixtos ─')
    await client.query(migration.replace(gate18, ''))
    const v18 = await runCod100Flow(ids.d100b, { numero: 18102, k1: '8f3438c8-a601-4c20-8a11-00000000b003', k2: '8f3438c8-a601-4c20-8a11-00000000b004' })
    check('REGRESIÓN 100% COD: las claves del contrato v14 son idénticas en los 3 pasos v18',
      JSON.stringify(v18.steps.map(project)) === JSON.stringify(base.steps.map(project)))
    check('release 19 expone las claves nuevas de porciones en cada snapshot',
      v18.steps.every(s => typeof s.ledger.cargo_cxc_usd === 'number' && typeof s.ledger.deuda_cxc_usd === 'number'
        && typeof s.ledger.desborde_sin_marca_usd === 'number' && typeof s.cod.pago_mixto === 'boolean'
        && ('motivo_revision' in s.cod)))
    check('REGRESIÓN 100% COD: resultado final y excedente idénticos',
      n2(v18.final.excedente_usd) === 0.01 && v18.final.estado_cod === base.final.estado_cod)

    // Caso 2 — mixto feliz (#4099): cxc $1076.19 + COD $1076.79
    await insertDispatch(ids.dMix, 18103, [
      { metodo: 'Cta por cobrar', monto: 1076.19, diasVencimiento: 8 },
      codEntry(1076.79, { metodo_propuesto: [{ metodo: 'Efectivo $', monto: 1076.79 }] }),
    ], 2152.98)
    await cargo(ids.dMix, 1076.19, 'cxc')
    await cargo(ids.dMix, 1076.79, 'cod')
    const mix0 = await summary(ids.dMix)
    check('C2 mixto: pendiente, pago_mixto=true, deuda COD $1076.79 y deuda crédito $1076.19',
      mix0.cod.estado === 'pendiente' && mix0.cod.pago_mixto === true && mix0.cod.motivo_revision === null
        && n2(mix0.ledger.deuda_cod_usd) === 1076.79 && n2(mix0.ledger.deuda_cxc_usd) === 1076.19
        && n2(mix0.ledger.cargo_cxc_usd) === 1076.19)
    const mixPay = await pay(ids.dMix, '8f3438c8-a601-4c20-8a11-00000000b005',
      [{ metodo: 'Zelle', monto: 1076.79, referencia: 'TX-4099' }], 'cobro COD en entrega 20/10')
    check('C2 mixto: el botón cobra la porción COD y marca cobrado + comisión nace',
      mixPay.estado_cod === 'cobrado' && mixPay.transaccion_atomica === true && await recalcCalls(ids.dMix) === 1)
    const mix1 = await summary(ids.dMix)
    check('C2 mixto: COD en $0 con marca pagada; la parte crédito queda intacta en $1076.19',
      mix1.cod.estado === 'cobrado' && n2(mix1.ledger.deuda_cod_usd) === 0 && n2(mix1.ledger.deuda_cxc_usd) === 1076.19)
    const mixRetry = await pay(ids.dMix, '8f3438c8-a601-4c20-8a11-00000000b005',
      [{ metodo: 'Zelle', monto: 1076.79, referencia: 'TX-4099' }], 'cobro COD en entrega 20/10')
    check('C6 idempotencia: el reintento devuelve el resultado y no duplica asientos',
      mixRetry.idempotent === true && Number((await client.query(
        "SELECT count(*)::int AS n FROM public.cuentas_por_cobrar WHERE despacho_id=$1 AND tipo='abono'", [ids.dMix])).rows[0].n) === 1)
    await expectRejected('C6 idempotencia: la misma clave no acepta payload distinto',
      () => pay(ids.dMix, '8f3438c8-a601-4c20-8a11-00000000b005', [{ metodo: 'Zelle', monto: 99, referencia: 'TX-OTRO' }]),
      'COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA')
    const cxcRows = await client.query(`SELECT tipo, metodo_pago, monto_usd FROM public.cuentas_por_cobrar
      WHERE despacho_id=$1 AND tipo='cargo' ORDER BY metodo_pago`, [ids.dMix])
    check('C2 mixto: los dos cargos siguen intactos (ningún asiento tocó la parte crédito)',
      cxcRows.rows.length === 2 && cxcRows.rows.some(r => r.metodo_pago === 'cxc' && Number(r.monto_usd) === 1076.19)
        && cxcRows.rows.some(r => r.metodo_pago === 'cod' && Number(r.monto_usd) === 1076.79))

    // Caso 3 — mixto con pago COD parcial y luego el resto
    await insertDispatch(ids.dPart, 18104, [{ metodo: 'Cta por cobrar', monto: 500 }, codEntry(300)], 800)
    await cargo(ids.dPart, 500, 'cxc')
    await cargo(ids.dPart, 300, 'cod')
    const part1 = await pay(ids.dPart, '8f3438c8-a601-4c20-8a11-00000000b006', [{ metodo: 'Efectivo $', monto: 100 }])
    const partSum1 = await summary(ids.dPart)
    check('C3 mixto: pago parcial $100 → estado parcial, marca aún en falso, comisión diferida',
      part1.estado_cod === 'parcial' && partSum1.cod.estado === 'parcial'
        && n2(partSum1.ledger.deuda_cod_usd) === 200 && await recalcCalls(ids.dPart) === 0)
    const part2 = await pay(ids.dPart, '8f3438c8-a601-4c20-8a11-00000000b007', [{ metodo: 'Efectivo $', monto: 200 }])
    const partSum2 = await summary(ids.dPart)
    check('C3 mixto: el resto cierra la porción COD → cobrado, marca true, comisión nace una vez',
      part2.estado_cod === 'cobrado' && partSum2.cod.estado === 'cobrado' && await recalcCalls(ids.dPart) === 1)

    // Caso 4 — mixto con el CRÉDITO pagado por flujo CxC (abono común sin marca)
    await insertDispatch(ids.dCredit, 18105, [{ metodo: 'Cta por cobrar', monto: 500 }, codEntry(300)], 800)
    await cargo(ids.dCredit, 500, 'cxc')
    await cargo(ids.dCredit, 300, 'cod')
    await abono(ids.dCredit, 500, { descripcion: 'abono CxC fixture (crédito)' })
    const credit0 = await summary(ids.dCredit)
    check('C4 mixto: el abono común salda el crédito y NO toca la deuda COD',
      credit0.cod.estado === 'pendiente' && n2(credit0.ledger.deuda_cxc_usd) === 0
        && n2(credit0.ledger.deuda_cod_usd) === 300 && n2(credit0.ledger.desborde_sin_marca_usd) === 0)
    const creditPay = await pay(ids.dCredit, '8f3438c8-a601-4c20-8a11-00000000b008', [{ metodo: 'USDT', monto: 300, referencia: 'TX-COD-4' }])
    check('C4 mixto: el botón sigue cobrable y cobra la porción COD completa',
      creditPay.estado_cod === 'cobrado' && n2((await summary(ids.dCredit)).ledger.deuda_cod_usd) === 0)

    // Caso 5 — pago mayor a la deuda COD
    await insertDispatch(ids.dOver, 18106, [{ metodo: 'Cta por cobrar', monto: 100 }, codEntry(100)], 200)
    await cargo(ids.dOver, 100, 'cxc')
    await cargo(ids.dOver, 100, 'cod')
    await expectRejected('C5 mixto: rechaza un pago mayor a la deuda COD',
      () => pay(ids.dOver, '8f3438c8-a601-4c20-8a11-00000000b009', [{ metodo: 'Zelle', monto: 150, referencia: 'TX-OVER' }]),
      'COD_CONCILIACION_MONTO_NO_COINCIDE')

    // Caso 7 — marca "pagado" sin movimientos que la respalden (#3879/#2185)
    await insertDispatch(ids.dFlag, 18107, [{ metodo: 'Cta por cobrar', monto: 5308.75 },
      codEntry(490, { cobro_destino_pagado: true, metodos_pagados: [{ metodo: 'Zelle', monto: 490, referencia: '' }] })], 5798.75)
    await cargo(ids.dFlag, 5308.75, 'cxc')
    await cargo(ids.dFlag, 490, 'cod')
    const flag0 = await summary(ids.dFlag)
    check('C7 flag sin respaldo: manual_review con motivo flag_sin_respaldo',
      flag0.cod.estado === 'manual_review' && flag0.cod.revisar === true
        && flag0.cod.motivo_revision === 'flag_sin_respaldo' && n2(flag0.ledger.deuda_cod_usd) === 490)
    await expectRejected('C7 flag sin respaldo: el registro se niega (FLAG_SIN_SOPORTE)',
      () => pay(ids.dFlag, '8f3438c8-a601-4c20-8a11-00000000b010', [{ metodo: 'Zelle', monto: 490, referencia: 'TX-FLAG' }]),
      'COD_CONCILIACION_FLAG_SIN_SOPORTE')

    // Caso 8 — abonos comunes con desborde y marca de pagada (#3064)
    await insertDispatch(ids.dAmb, 18108, [{ metodo: 'Cta por cobrar', monto: 2187.78 },
      codEntry(2000, { cobro_destino_pagado: true })], 4187.78)
    await cargo(ids.dAmb, 2187.78, 'cxc')
    await cargo(ids.dAmb, 2000, 'cod')
    await abono(ids.dAmb, 2246.28, { descripcion: 'abono legado sin marca (#3064)' })
    const amb0 = await summary(ids.dAmb)
    check('C8 atribución ambigua: manual_review con motivo atribucion_ambigua y desborde $58.50',
      amb0.cod.estado === 'manual_review' && amb0.cod.motivo_revision === 'atribucion_ambigua'
        && n2(amb0.ledger.desborde_sin_marca_usd) === 58.5 && n2(amb0.ledger.deuda_cod_usd) === 1941.5)
    await expectRejected('C8 atribución ambigua: el registro se niega (ATRIBUCION_AMBIGUA)',
      () => pay(ids.dAmb, '8f3438c8-a601-4c20-8a11-00000000b011', [{ metodo: 'Zelle', monto: 1941.5, referencia: 'TX-AMB' }]),
      'COD_CONCILIACION_ATRIBUCION_AMBIGUA')

    // Caso 9 — desborde que salda TODO (#2832)
    await insertDispatch(ids.dSpill, 18109, [{ metodo: 'Cta por cobrar', monto: 15.9 }, codEntry(0.1)], 16)
    await cargo(ids.dSpill, 15.9, 'cxc')
    await cargo(ids.dSpill, 0.1, 'cod')
    await abono(ids.dSpill, 16, { descripcion: 'abono legado que cubre ambas porciones (#2832)' })
    const spill0 = await summary(ids.dSpill)
    check('C9 desborde: crédito saldado + desborde $0.10 al COD → todo saldado (cobrado)',
      spill0.cod.estado === 'cobrado' && n2(spill0.ledger.deuda_cod_usd) === 0
        && n2(spill0.ledger.deuda_cxc_usd) === 0 && n2(spill0.ledger.desborde_sin_marca_usd) === 0.1)

    // Caso 10 — compensación (devolución) en pago mixto: semántica fijada
    await insertDispatch(ids.dCompA, 18110, [{ metodo: 'Cta por cobrar', monto: 100 }, codEntry(100)], 200)
    await cargo(ids.dCompA, 100, 'cxc')
    await cargo(ids.dCompA, 100, 'cod')
    await abono(ids.dCompA, 60, { forma: 'Devolución', descripcion: 'compensación dentro del crédito' })
    const compA0 = await summary(ids.dCompA)
    check('C10a compensación ≤ crédito: salda crédito primero y deja el COD cobrable',
      compA0.cod.estado === 'pendiente' && n2(compA0.ledger.deuda_cxc_usd) === 40
        && n2(compA0.ledger.deuda_cod_usd) === 100)
    const compAPay = await pay(ids.dCompA, '8f3438c8-a601-4c20-8a11-00000000b012', [{ metodo: 'Efectivo $', monto: 100 }])
    check('C10a: el botón cobra el COD completo tras la compensación', compAPay.estado_cod === 'cobrado')

    await insertDispatch(ids.dCompB, 18111, [{ metodo: 'Cta por cobrar', monto: 100 }, codEntry(100)], 200)
    await cargo(ids.dCompB, 100, 'cxc')
    await cargo(ids.dCompB, 100, 'cod')
    await abono(ids.dCompB, 150, { forma: 'Devolución', descripcion: 'compensación que desborda al COD' })
    const compB0 = await summary(ids.dCompB)
    check('C10b compensación con desborde: manual_review (atribucion_ambigua) y deuda COD $50',
      compB0.cod.estado === 'manual_review' && compB0.cod.motivo_revision === 'atribucion_ambigua'
        && n2(compB0.ledger.deuda_cod_usd) === 50)
    await expectRejected('C10b: el registro se niega mientras el desborde sea ambiguo',
      () => pay(ids.dCompB, '8f3438c8-a601-4c20-8a11-00000000b013', [{ metodo: 'Efectivo $', monto: 50 }]),
      'COD_CONCILIACION_ATRIBUCION_AMBIGUA')

    // Caso 11 (regresión de etiqueta) — 100% COD saldado solo con compensación
    await insertDispatch(ids.dSoloComp, 18112, [codEntry(200)], 200)
    await cargo(ids.dSoloComp, 200, 'cod')
    await abono(ids.dSoloComp, 200, { metodoPago: 'cod', forma: 'Devolución', descripcion: 'compensación marcada' })
    const soloComp = await summary(ids.dSoloComp)
    check('C11 100% COD solo compensación: estado compensado (etiqueta v14 intacta)',
      soloComp.cod.estado === 'compensado' && n2(soloComp.ledger.compensado_usd) === 200)

    // Caso 12 — nota opcional y referencia con mínimo de 4 caracteres
    await insertDispatch(ids.dNota, 18113, [{ metodo: 'Cta por cobrar', monto: 100 }, codEntry(100)], 200)
    await cargo(ids.dNota, 100, 'cxc')
    await cargo(ids.dNota, 100, 'cod')
    const notaPay = await pay(ids.dNota, '8f3438c8-a601-4c20-8a11-00000000b014', [{ metodo: 'Efectivo $', monto: 100 }], '')
    const notaRows = await client.query(`SELECT descripcion FROM public.cuentas_por_cobrar
      WHERE despacho_id=$1 AND tipo='abono'`, [ids.dNota])
    check('C12 nota opcional: se registra sin nota y el asiento queda como nota: (sin nota)',
      notaPay.estado_cod === 'cobrado' && notaRows.rows.length === 1
        && notaRows.rows[0].descripcion.includes('nota: (sin nota)'))
    await expectRejected('C12 nota opcional: una nota de más de 500 caracteres se rechaza',
      () => pay(ids.dNota, '8f3438c8-a601-4c20-8a11-00000000b015', [{ metodo: 'Efectivo $', monto: 1 }], 'x'.repeat(501)),
      'COD_CONCILIACION_PARAMETROS_INVALIDOS')
    await insertDispatch(ids.dRef, 18114, [{ metodo: 'Cta por cobrar', monto: 50 }, codEntry(50)], 100)
    await cargo(ids.dRef, 50, 'cxc')
    await cargo(ids.dRef, 50, 'cod')
    const refPay = await pay(ids.dRef, '8f3438c8-a601-4c20-8a11-00000000b018', [{ metodo: 'Punto de venta', monto: 50, referencia: '1234' }], '')
    check('C12 referencia mínima: 4 caracteres exactos son válidos', refPay.estado_cod === 'cobrado')
    await expectRejected('C12 referencia mínima: rechaza referencia de menos de 4 caracteres',
      () => pay(ids.dRef, '8f3438c8-a601-4c20-8a11-00000000b016', [{ metodo: 'Zelle', monto: 50, referencia: 'TX9' }]),
      'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS')
    await expectRejected('C12 referencia mínima: rechaza referencia vacía en medios no efectivo',
      () => pay(ids.dRef, '8f3438c8-a601-4c20-8a11-00000000b017', [{ metodo: 'USDT', monto: 50, referencia: ' ' }]),
      'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS')

    // Aislamiento de tenant
    await expectRejected('resumen no filtra fuera del tenant', () => summary(ids.dMix, ids.otherAccount),
      'DESPACHO_NO_ENCONTRADO_O_SIN_PERMISO')

    // ═════════ FASE 3: preflight/postflight 19 ═════════
    console.log('─ Fase 3: verificación solo lectura del release 19 instalado ─')
    const post18 = await client.query(postflight)
    const p = post18.rows[0]?.cod_mixto_postflight
    check('postflight 19: contratos v19, guardas nuevas y atribución presente en ambas funciones',
      p?.contracts_are_release19 === true && p?.new_guards_present === true && p?.attribution_present_both === true)
    check('postflight 19: permisos solo service_role, política de un centavo y cierre con deuda cero intactos',
      p?.grants_service_only === true && p?.cod_allows_maximum_one_cent_overpayment === true
        && p?.cod_completion_requires_zero_debt === true && p?.cod_records_overpayment_explicitly === true)
    check('postflight 19: abonos del flujo atómico siguen etiquetados metodo_pago=cod',
      p?.cod_payments_tagged === true && p?.idempotency_intact === true)

    // ═════════ FASE 4: rollback → semántica release 14 restaurada ═════════
    console.log('─ Fase 4: rollback y restauración de la semántica release 14 ─')
    await client.query(rollbackSql.replace(gateRollback, ''))
    const creditAfter = await summary(ids.dCredit)
    check('rollback: el mixto vuelve al comportamiento v14 (manual_review por doble cargo)',
      creditAfter.cod.estado === 'manual_review')
    const postRollback = await client.query(postflight)
    check('rollback: los contratos vuelven a release 14 (postflight 19 en falso)',
      postRollback.rows[0]?.cod_mixto_postflight?.contracts_are_release19 === false)
    const baseAfterRollback = await summary(ids.d100b)
    check('rollback: el flujo 100% COD sigue saldado y coherente tras restaurar cuerpos',
      baseAfterRollback.cod.estado === 'cobrado' && n2(baseAfterRollback.ledger.deuda_cod_usd) === 0)

    completedSuccessfully = true
    console.log('PASS: release 19 COD mixto — regresión 100% COD idéntica, matriz mixta 12/12 (nota opcional, referencia mínima 4) y rollback restaurado.')
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
