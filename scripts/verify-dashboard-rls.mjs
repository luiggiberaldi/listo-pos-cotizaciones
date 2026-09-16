import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PGlite } = require('C:/Users/luigg/.workbuddy-ai/binaries/node/workspace/node_modules/@electric-sql/pglite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withOptionalReleaseTable = !process.argv.includes('--without-optional');
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`;
const outputName = withOptionalReleaseTable ? 'sql-verification' : 'sql-verification-without-optional';
const output = path.join(root, `outputs/auditoria-inicio-roles/${outputName}.json`);
const runOutput = path.join(root, `outputs/auditoria-inicio-roles/${outputName}-${runId}.json`);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const account = uuid(1);
const otherAccount = uuid(2);
const zero = '00000000-0000-0000-0000-000000000000';
const actors = [
  ['sellerA', 'vendedor'], ['sellerB', 'vendedor'], ['noCommission', 'vendedor_sin_comision'],
  ['supervisor', 'supervisor'], ['boss', 'jefe'], ['admin', 'administracion'],
  ['logistics', 'logistica'], ['developer', 'desarrollador'], ['foreignSeller', 'vendedor'],
].map(([name, role], index) => ({ name, role, id: uuid(100 + index), account: index === 8 ? otherAccount : account, index: index + 1, token: sha(`synthetic-dashboard-token-${name}`) }));
const byName = Object.fromEntries(actors.map((actor) => [actor.name, actor]));
const virtual = { name: 'virtualDeveloper', role: 'desarrollador', id: zero, account, token: sha('synthetic-virtual-session') };
const tables = ['notas_despacho', 'cotizaciones', 'notas_despacho_items', 'cotizacion_items', 'comisiones', 'clientes', 'cuentas_por_cobrar', 'productos', 'usuarios', ...(withOptionalReleaseTable ? ['comision_liberaciones'] : [])];
const results = [];
const evidence = {
  generatedAt: new Date().toISOString(), mode: 'Sequential local in-memory PGlite; no network or real credentials',
  node: process.version,
  pgliteVersion: require('C:/Users/luigg/.workbuddy-ai/binaries/node/workspace/node_modules/@electric-sql/pglite/package.json').version,
  limitation: 'Minimal synthetic schema plus actual migrations 132 (helper/read baseline), optional 183/188/199 (release table, columns and legacy policies), 240, and 241. This does not prove that the entire historical migration chain applies, nor Supabase/PostgREST/deployment/concurrent behavior. Counts are named cases; some cases contain multiple SQL assertions.',
  withOptionalReleaseTable, runOutput,
  migrations: {}, results, summary: {},
};
const db = new PGlite();
async function test(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'failed', error: error.message, code: error.code, detail: error.detail });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function asRole(actor, sql, { role = 'authenticated', headers = {}, metadata = {}, accountOverride, noToken = false, rawHeaders } = {}) {
  await db.exec('RESET ROLE');
  const claims = { role, sub: accountOverride ?? actor?.account ?? account, app_metadata: metadata };
  const requestHeaders = { ...(actor && !noToken ? { 'x-operator-session': actor.token, 'x-operator-id': actor.id } : {}), ...headers };
  await db.query("SELECT set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)", [JSON.stringify(claims), rawHeaders ?? JSON.stringify(requestHeaders)]);
  await db.exec(`SET ROLE ${role}`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE'); }
}
async function denied(actor, sql, options) {
  await assert.rejects(asRole(actor, sql, options), (error) => error.code === '42501' || /Acceso denegado/.test(error.message));
}
async function equalRows(actor, sql, expected, options) {
  const rows = await asRole(actor, sql, options);
  assert.deepEqual(rows.map((row) => Object.values(row)[0]).sort(), [...expected].sort());
}
const selectDocuments = 'SELECT numero FROM public.notas_despacho ORDER BY numero';
const opReport = (id = null) => `SELECT despacho_numero FROM public.obtener_reporte_ventas_operaciones(NULL::date,NULL::date,${id ? `${quote(id)}::uuid` : 'NULL::uuid'})`;
const commissionReport = (id = null) => `SELECT despacho_numero FROM public.obtener_reporte_ventas_comisiones(NULL::timestamptz,NULL::timestamptz,${id ? `${quote(id)}::uuid` : 'NULL::uuid'})`;
const ownTenant = actors.filter((actor) => actor.account === account).map((actor) => actor.index);
const supervisors = ['sellerA', 'sellerB', 'noCommission', 'supervisor'].map((name) => byName[name].index);

try {
  try {
    const previous = await readFile(output, 'utf8');
    const previousOutput = path.join(root, `outputs/auditoria-inicio-roles/${outputName}-prior-${runId}.json`);
    await writeFile(previousOutput, previous, { encoding: 'utf8', flag: 'wx' });
    evidence.previousOutput = previousOutput;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  evidence.harnessSha256 = sha(await readFile(fileURLToPath(import.meta.url), 'utf8'));
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(auth.jwt()->>'sub', '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE public.usuarios (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, nombre text, color text, rol text NOT NULL, activo boolean NOT NULL DEFAULT true, pin_hash text, pin_salt text);
    CREATE TABLE public.clientes (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, vendedor_id uuid, nombre text, tipo_cliente text, categoria text);
    CREATE TABLE public.cotizaciones (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, vendedor_id uuid, cliente_id uuid, tasa_bcv_snapshot numeric);
    CREATE TABLE public.notas_despacho (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, vendedor_id uuid, numero integer, cotizacion_id uuid, cliente_id uuid, creado_en timestamptz, entregada_en timestamptz, estado text, total_usd numeric, flete_usd numeric, corte_usd numeric, descuento_total_usd numeric, tasa_snapshot numeric, forma_pago_cliente text, forma_pago text, referencia_pago text);
    CREATE TABLE public.productos (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, categoria text);
    CREATE TABLE public.notas_despacho_items (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, despacho_id uuid, producto_id uuid, codigo_snap text, nombre_snap text, unidad_snap text, precio_unit_usd numeric(12,4), cantidad numeric(12,2), total_linea_usd numeric, origen text);
    CREATE TABLE public.cotizacion_items (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, cotizacion_id uuid, producto_id uuid, codigo_snap text, nombre_snap text, unidad_snap text, precio_unit_usd numeric(12,4), cantidad numeric(12,2), total_linea_usd numeric, origen text);
    CREATE TABLE public.comisiones (id uuid PRIMARY KEY, cuentaid uuid NOT NULL, vendedorid uuid, despachoid uuid, pctcabilla numeric, pctotros numeric, estado text, montopagado numeric, totalcomision numeric);
    CREATE TABLE public.cuentas_por_cobrar (id uuid PRIMARY KEY, cuenta_id uuid NOT NULL, cliente_id uuid, saldo numeric);
    CREATE TABLE public.configuracion_negocio (id integer PRIMARY KEY, comision_categoria_cabilla text, comision_pct_cabilla numeric, comision_pct_otros numeric, comision_pct_externos numeric, _comision_extras jsonb);
    CREATE TABLE public.despacho_descuentos (id uuid PRIMARY KEY, despacho_id uuid, cotizacion_item_id uuid, monto_usd numeric);
    INSERT INTO public.configuracion_negocio VALUES (1,'cabilla',2,3,4,'[]');
    CREATE FUNCTION public.obtener_resumen_comisiones(uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 123 $$;
    CREATE FUNCTION public.obtener_resumen_comisiones(uuid,uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 456 $$;
    CREATE FUNCTION public.obtener_resumen_comisiones_v2(uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 789 $$;
    GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones(uuid), public.obtener_resumen_comisiones(uuid,uuid), public.obtener_resumen_comisiones_v2(uuid) TO authenticated, anon;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
    GRANT SELECT ON public.usuarios TO PUBLIC;
    GRANT SELECT (pin_hash, pin_salt) ON public.usuarios TO PUBLIC, anon, authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  `);
  for (const table of tables.filter((table) => table !== 'comision_liberaciones')) {
    const tenantColumn = table === 'comisiones' ? 'cuentaid' : 'cuenta_id';
    await db.exec(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY baseline_permissive ON public.${table} FOR SELECT TO authenticated USING (${tenantColumn} = auth.uid());
      CREATE POLICY baseline_tenant ON public.${table} AS RESTRICTIVE FOR SELECT TO authenticated USING (${tenantColumn} = auth.uid());`);
  }
  for (const actor of actors) {
    const i = actor.index;
    await db.exec(`
      INSERT INTO public.usuarios VALUES (${quote(actor.id)},${quote(actor.account)},${quote(actor.name)},'#123456',${quote(actor.role)},true,'synthetic-pin-hash','synthetic-salt');
      INSERT INTO public.clientes VALUES (${quote(uuid(200 + i))},${quote(actor.account)},${quote(actor.id)},${quote(`Client ${actor.name}`)},'regular','test');
      INSERT INTO public.cotizaciones VALUES (${quote(uuid(300 + i))},${quote(actor.account)},${quote(actor.id)},${quote(uuid(200 + i))},40);
      INSERT INTO public.notas_despacho VALUES (${quote(uuid(400 + i))},${quote(actor.account)},${quote(actor.id)},${i},${quote(uuid(300 + i))},${quote(uuid(200 + i))},now(),now(),'entregada',120,10,5,5,40,NULL,'cash','synthetic');
      INSERT INTO public.productos VALUES (${quote(uuid(500 + i))},${quote(actor.account)},'cabilla');
      INSERT INTO public.notas_despacho_items VALUES (${quote(uuid(600 + i))},${quote(actor.account)},${quote(uuid(400 + i))},${quote(uuid(500 + i))},'TEST','Synthetic product','unit',100,1,100,'inventario');
      INSERT INTO public.cotizacion_items VALUES (${quote(uuid(700 + i))},${quote(actor.account)},${quote(uuid(300 + i))},${quote(uuid(500 + i))},'TEST','Synthetic product','unit',100,1,100,'inventario');
      INSERT INTO public.comisiones VALUES (${quote(uuid(800 + i))},${quote(actor.account)},${quote(actor.id)},${quote(uuid(400 + i))},2,3,'pendiente',0,2);
      INSERT INTO public.cuentas_por_cobrar VALUES (${quote(uuid(900 + i))},${quote(actor.account)},${quote(uuid(200 + i))},100);
    `);
  }
  for (const migration of ['132_fix_rls_tenant_read_access.sql', ...(withOptionalReleaseTable ? ['183_comisiones_columnas_liberacion.sql', '188_fix_rls_comisiones_vendedor.sql', '199_rls_comisiones_supervisores.sql'] : []), '240_fix_reporte_ventas_corte_y_cuenta.sql', '241_inicio_roles_y_sesiones_operador.sql']) {
    const source = await readFile(path.join(root, 'supabase/migrations', migration), 'utf8');
    evidence.migrations[migration] = { sha256: sha(source), bytes: Buffer.byteLength(source) };
    await test(`compile actual migration ${migration}`, async () => { await db.exec(source); });
    if (results.at(-1).status === 'failed') throw new Error(`Migration compilation failed: ${migration}; see result above`);
    if (migration.startsWith('183_')) {
      await db.exec(`
        CREATE POLICY baseline_permissive ON public.comision_liberaciones FOR SELECT TO authenticated USING (cuenta_id = auth.uid());
        CREATE POLICY baseline_tenant ON public.comision_liberaciones AS RESTRICTIVE FOR SELECT TO authenticated USING (cuenta_id = auth.uid());
        GRANT SELECT ON public.comision_liberaciones TO anon;
        GRANT ALL ON public.comision_liberaciones TO service_role;
      `);
      for (const actor of actors) {
        await db.exec(`INSERT INTO public.comision_liberaciones(id,comision_id,despacho_id,vendedor_id,cuenta_id,monto,tipo)
          VALUES (${quote(uuid(1000 + actor.index))},${quote(uuid(800 + actor.index))},${quote(uuid(400 + actor.index))},${quote(actor.id)},${quote(actor.account)},1,'abono')`);
      }
    }
  }
  for (const actor of [...actors, virtual]) {
    await db.exec(`INSERT INTO public.operator_sessions(token_hash,cuenta_id,operator_id,credential_hash,virtual_developer,expires_at)
      VALUES (${quote(sha(actor.token))},${quote(actor.account)},${quote(actor.id)},${actor === virtual ? 'NULL' : quote(sha('synthetic-pin-hash:synthetic-salt'))},${actor === virtual},now()+interval '1 day')`);
  }
  await test('Authenticated execution is non-owner and non-bypass RLS', async () => {
    const rows = await asRole(byName.sellerA, 'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    assert.deepEqual(rows, [{ role: 'authenticated', rolsuper: false, rolbypassrls: false }]);
  });
  await test('Baseline broad policies and tenant restrictions remain installed', async () => {
    const rows = await db.query("SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='public' AND policyname IN ('baseline_permissive','baseline_tenant')");
    assert.equal(rows.rows[0].count, tables.length * 2);
  });
  const expectedByActor = { sellerA: [1], sellerB: [2], noCommission: [3], supervisor: supervisors, boss: ownTenant, admin: ownTenant, logistics: ownTenant, developer: ownTenant, foreignSeller: [9], virtualDeveloper: ownTenant };
  for (const actor of [...actors, virtual]) {
    const expected = expectedByActor[actor.name];
    await test(`${actor.name}: stored role and operator identity`, async () => {
      const rows = await asRole(actor, 'SELECT * FROM public.current_operator_context()');
      assert.deepEqual(rows, [{ operator_id: actor.id, rol: actor.role }]);
    });
    for (const table of tables) {
      await test(`${actor.name}: direct RLS ${table}`, async () => {
        let numbers = expected;
        if (['comisiones', 'comision_liberaciones'].includes(table) && actor.role === 'logistica') numbers = [];
        if (table === 'productos') numbers = ['jefe','supervisor','administracion','desarrollador'].includes(actor.role) ? (actor.account === account ? ownTenant : [9]) : [];
        if (table === 'usuarios') {
          await equalRows(actor, 'SELECT id FROM public.usuarios', numbers.map((i) => actors[i - 1].id));
        } else {
          const offsets = { notas_despacho: 400, cotizaciones: 300, notas_despacho_items: 600, cotizacion_items: 700, comisiones: 800, clientes: 200, cuentas_por_cobrar: 900, productos: 500, comision_liberaciones: 1000 };
          await equalRows(actor, `SELECT id FROM public.${table}`, numbers.map((i) => uuid(offsets[table] + i)));
        }
      });
    }
    await test(`${actor.name}: safe roster and profile columns remain readable within scope`, async () => {
      const rows = await asRole(actor, 'SELECT id,cuenta_id,nombre,color,rol,activo FROM public.usuarios ORDER BY id');
      const expectedRows = expected.map((i) => ({ id: actors[i - 1].id, cuenta_id: actors[i - 1].account, nombre: actors[i - 1].name, color: '#123456', rol: actors[i - 1].role, activo: true })).sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(rows, expectedRows);
    });
    await test(`${actor.name}: protected PIN grants do not survive legacy column ACLs`, async () => {
      await denied(actor, 'SELECT pin_hash, pin_salt FROM public.usuarios');
      const rows = await asRole(actor, "SELECT has_column_privilege(current_user,'public.usuarios','pin_hash','SELECT') AS hash, has_column_privilege(current_user,'public.usuarios','pin_salt','SELECT') AS salt, has_column_privilege(current_user,'public.usuarios','nombre','SELECT') AS profile, has_table_privilege(current_user,'public.usuarios','SELECT') AS whole_table");
      assert.deepEqual(rows, [{ hash: false, salt: false, profile: true, whole_table: false }]);
    });
    await test(`${actor.name}: operations RPC valid scope`, async () => {
      if (actor.role === 'logistica') return denied(actor, opReport());
      const seller = ['vendedor', 'vendedor_sin_comision'].includes(actor.role);
      await equalRows(actor, opReport(seller ? actor.id : null), expected);
    });
    await test(`${actor.name}: detailed commissions RPC role and tenant`, async () => {
      if (!['administracion','desarrollador'].includes(actor.role)) return denied(actor, commissionReport());
      await equalRows(actor, commissionReport(), ownTenant.filter((i) => i !== 3));
    });
  }
  for (const actor of [byName.sellerA, byName.sellerB, byName.noCommission]) {
    await test(`${actor.name}: operations RPC rejects omitted seller`, () => denied(actor, opReport()));
    await test(`${actor.name}: operations RPC rejects another seller`, () => denied(actor, opReport(actor === byName.sellerA ? byName.sellerB.id : byName.sellerA.id)));
    await test(`${actor.name}: operations RPC rejects foreign seller`, () => denied(actor, opReport(byName.foreignSeller.id)));
  }
  await test('Supervisor operations report cannot request boss sales', () => equalRows(byName.supervisor, opReport(byName.boss.id), []));
  await test('Boss operations report cannot request foreign-account sales', () => equalRows(byName.boss, opReport(byName.foreignSeller.id), []));
  await test('Admin commission report cannot request foreign-account sales', () => equalRows(byName.admin, commissionReport(byName.foreignSeller.id), []));
  for (const actor of [byName.sellerA, byName.boss, virtual]) {
    for (const sql of ['SELECT * FROM public.operator_sessions', 'SELECT pin_hash FROM public.usuarios', 'SELECT pin_salt FROM public.usuarios', 'SELECT * FROM public.usuarios']) {
      await test(`${actor.name}: sensitive SQL denied: ${sql}`, () => denied(actor, sql));
    }
    for (const rpc of [`obtener_resumen_comisiones(${quote(account)}::uuid)`, `obtener_resumen_comisiones(${quote(account)}::uuid,${quote(byName.sellerB.id)}::uuid)`, `obtener_resumen_comisiones_v2(${quote(account)}::uuid)`]) {
      await test(`${actor.name}: legacy summary execute revoked: ${rpc.split('(')[0]}`, () => denied(actor, `SELECT public.${rpc}`));
    }
  }
  for (const sql of ['SELECT * FROM public.operator_sessions', 'SELECT pin_hash FROM public.usuarios', `SELECT public.obtener_resumen_comisiones(${quote(account)}::uuid)`]) {
    await test(`Anon sensitive SQL denied: ${sql}`, () => denied(null, sql, { role: 'anon' }));
  }
  await test('Service role retains session table and legacy summary access', async () => {
    const rows = await asRole(null, `SELECT (SELECT count(*)::int FROM public.operator_sessions) AS sessions, public.obtener_resumen_comisiones(${quote(account)}::uuid) AS summary`, { role: 'service_role' });
    assert.deepEqual(rows, [{ sessions: 10, summary: 123 }]);
  });
  const forgedMetadata = { operator_id: byName.boss.id, operator_rol: 'jefe', rol: 'desarrollador' };
  await test('Shared app_metadata and forged role headers cannot elevate seller A', async () => {
    await equalRows(byName.sellerA, selectDocuments, [1], { metadata: forgedMetadata, headers: { 'x-operator-rol': 'jefe', 'x-operator-role': 'desarrollador' } });
  });
  await test('Shared metadata for seller B cannot switch seller A identity', () => equalRows(byName.sellerA, 'SELECT public.get_operador_id()', [byName.sellerA.id], { metadata: { operator_id: byName.sellerB.id, operator_rol: 'vendedor' } }));
  const invalidRequests = [
    ['no session with forged boss metadata', byName.sellerA, { noToken: true, metadata: forgedMetadata, headers: { 'x-operator-id': byName.boss.id, 'x-operator-rol': 'jefe' } }],
    ['wrong requested operator ID', byName.sellerA, { headers: { 'x-operator-id': byName.boss.id } }],
    ['cross-account token', byName.sellerA, { accountOverride: otherAccount }],
    ['foreign token against original account', byName.foreignSeller, { accountOverride: account }],
    ['unregistered raw token', byName.sellerA, { headers: { 'x-operator-session': sha('not-stored') } }],
    ['using stored hash instead of raw token', byName.sellerA, { headers: { 'x-operator-session': sha(byName.sellerA.token) } }],
    ['malformed token', byName.sellerA, { headers: { 'x-operator-session': 'not-hex' } }],
    ['malformed operator ID', byName.sellerA, { headers: { 'x-operator-id': 'invalid-uuid' } }],
    ['malformed request headers JSON', byName.sellerA, { rawHeaders: '{invalid' }],
    ['virtual developer ID without stored session', virtual, { noToken: true, headers: { 'x-operator-id': zero, 'x-operator-rol': 'desarrollador' }, metadata: { operator_id: zero, operator_rol: 'desarrollador' } }],
    ['virtual developer token from another account', virtual, { accountOverride: otherAccount }],
    ['virtual developer ID with ordinary session', byName.sellerA, { headers: { 'x-operator-id': zero, 'x-operator-rol': 'desarrollador' } }],
  ];
  for (const [name, actor, options] of invalidRequests) {
    await test(`${name}: no context`, () => equalRows(actor, 'SELECT operator_id FROM public.current_operator_context()', [], options));
    await test(`${name}: all direct tables closed`, async () => {
      for (const table of tables) await equalRows(actor, `SELECT id FROM public.${table}`, [], options);
    });
    await test(`${name}: both reporting RPCs denied`, async () => {
      await denied(actor, opReport(actor.id), options);
      await denied(actor, commissionReport(), options);
    });
  }
  await test('Missing x-operator-id derives identity only from stored raw-token session', () => equalRows(byName.sellerA, selectDocuments, [1], { headers: { 'x-operator-id': '' } }));
  const mutations = [
    ['revoked session', `UPDATE public.operator_sessions SET revoked_at=now() WHERE operator_id=${quote(byName.sellerA.id)}`, `UPDATE public.operator_sessions SET revoked_at=NULL WHERE operator_id=${quote(byName.sellerA.id)}`],
    ['expired session', `UPDATE public.operator_sessions SET creado_en=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE operator_id=${quote(byName.sellerA.id)}`, `UPDATE public.operator_sessions SET expires_at=now()+interval '1 day' WHERE operator_id=${quote(byName.sellerA.id)}`],
    ['changed PIN hash', `UPDATE public.usuarios SET pin_hash='changed' WHERE id=${quote(byName.sellerA.id)}`, `UPDATE public.usuarios SET pin_hash='synthetic-pin-hash' WHERE id=${quote(byName.sellerA.id)}`],
    ['changed PIN salt', `UPDATE public.usuarios SET pin_salt='changed' WHERE id=${quote(byName.sellerA.id)}`, `UPDATE public.usuarios SET pin_salt='synthetic-salt' WHERE id=${quote(byName.sellerA.id)}`],
    ['inactive operator', `UPDATE public.usuarios SET activo=false WHERE id=${quote(byName.sellerA.id)}`, `UPDATE public.usuarios SET activo=true WHERE id=${quote(byName.sellerA.id)}`],
    ['unsupported stored role', `UPDATE public.usuarios SET rol='disabled' WHERE id=${quote(byName.sellerA.id)}`, `UPDATE public.usuarios SET rol='vendedor' WHERE id=${quote(byName.sellerA.id)}`],
    ['operator moved account', `UPDATE public.usuarios SET cuenta_id=${quote(otherAccount)} WHERE id=${quote(byName.sellerA.id)}`, `UPDATE public.usuarios SET cuenta_id=${quote(account)} WHERE id=${quote(byName.sellerA.id)}`],
  ];
  for (const [name, mutate, restore] of mutations) {
    await db.exec(mutate);
    await test(`${name}: live session loses all direct and RPC access`, async () => {
      await equalRows(byName.sellerA, 'SELECT public.get_rol_actual()', ['sin_operador']);
      for (const table of tables) await equalRows(byName.sellerA, `SELECT id FROM public.${table}`, []);
      await denied(byName.sellerA, opReport(byName.sellerA.id));
      await denied(byName.sellerA, commissionReport());
    });
    await db.exec(restore);
  }
  await test('Demotion of boss to seller is honored without issuing a new token', async () => {
    await db.exec(`UPDATE public.usuarios SET rol='vendedor' WHERE id=${quote(byName.boss.id)}`);
    try {
      await equalRows(byName.boss, 'SELECT public.get_rol_actual()', ['vendedor']);
      await equalRows(byName.boss, selectDocuments, [5], { metadata: forgedMetadata });
      await equalRows(byName.boss, opReport(byName.boss.id), [5]);
      await denied(byName.boss, opReport());
      await denied(byName.boss, opReport(byName.sellerA.id));
    } finally { await db.exec(`UPDATE public.usuarios SET rol='jefe' WHERE id=${quote(byName.boss.id)}`); }
  });
  await test('Revoking stored virtual-developer session immediately removes access', async () => {
    await db.exec(`UPDATE public.operator_sessions SET revoked_at=now() WHERE virtual_developer`);
    try { await equalRows(virtual, selectDocuments, []); await denied(virtual, commissionReport()); }
    finally { await db.exec('UPDATE public.operator_sessions SET revoked_at=NULL WHERE virtual_developer'); }
  });
  await test('Operations report remains attached to original seller after client reassignment', async () => {
    await db.exec(`UPDATE public.clientes SET vendedor_id=${quote(byName.sellerB.id)} WHERE id=${quote(uuid(201))}`);
    try {
      await equalRows(byName.sellerA, selectDocuments, [1]);
      await equalRows(byName.sellerA, opReport(byName.sellerA.id), [1]);
    } finally { await db.exec(`UPDATE public.clientes SET vendedor_id=${quote(byName.sellerA.id)} WHERE id=${quote(uuid(201))}`); }
  });
  await test('Report advisor identity remains the dispatch seller after client reassignment', async () => {
    await db.exec(`UPDATE public.clientes SET vendedor_id=${quote(byName.sellerB.id)} WHERE id=${quote(uuid(201))}`);
    try { await equalRows(byName.boss, `SELECT asesor_id FROM public.obtener_reporte_ventas_operaciones() WHERE despacho_numero=1`, [byName.sellerA.id]); }
    finally { await db.exec(`UPDATE public.clientes SET vendedor_id=${quote(byName.sellerA.id)} WHERE id=${quote(uuid(201))}`); }
  });
  await test('Anonymous cannot read safe profile columns or legacy PIN column grants', async () => {
    await denied(null, 'SELECT id,nombre FROM public.usuarios', { role: 'anon' });
    await denied(null, 'SELECT pin_hash,pin_salt FROM public.usuarios', { role: 'anon' });
  });
  await test('Service role retains credential read access for trusted PIN verification', async () => {
    const rows = await asRole(null, `SELECT pin_hash,pin_salt FROM public.usuarios WHERE id=${quote(byName.sellerA.id)}`, { role: 'service_role' });
    assert.deepEqual(rows, [{ pin_hash: 'synthetic-pin-hash', pin_salt: 'synthetic-salt' }]);
  });
  await test('Optional release table branch matches fixture presence', async () => {
    const rows = await db.query("SELECT to_regclass('public.comision_liberaciones')::text AS table_name");
    assert.equal(rows.rows[0].table_name, withOptionalReleaseTable ? 'comision_liberaciones' : null);
  });
  if (withOptionalReleaseTable) {
    await test('Optional releases have enabled RLS and a restrictive dashboard policy', async () => {
      const rows = await db.query("SELECT c.relrowsecurity, p.permissive FROM pg_class c JOIN pg_policies p ON p.tablename=c.relname WHERE c.oid='public.comision_liberaciones'::regclass AND p.policyname='dashboard_scope_select'");
      assert.deepEqual(rows.rows, [{ relrowsecurity: true, permissive: 'RESTRICTIVE' }]);
    });
    const releaseSelect = 'SELECT id FROM public.comision_liberaciones';
    const releaseMutations = [
      ['own beneficiary cannot expose another seller parent commission', `UPDATE public.comision_liberaciones SET comision_id=${quote(uuid(802))} WHERE id=${quote(uuid(1001))}`, `UPDATE public.comision_liberaciones SET comision_id=${quote(uuid(801))} WHERE id=${quote(uuid(1001))}`, byName.sellerA, []],
      ['own parent cannot expose another seller beneficiary', `UPDATE public.comision_liberaciones SET vendedor_id=${quote(byName.sellerB.id)} WHERE id=${quote(uuid(1001))}`, `UPDATE public.comision_liberaciones SET vendedor_id=${quote(byName.sellerA.id)} WHERE id=${quote(uuid(1001))}`, byName.sellerA, []],
      ['foreign-tenant release cannot expose an owned parent', `UPDATE public.comision_liberaciones SET cuenta_id=${quote(otherAccount)} WHERE id=${quote(uuid(1001))}`, `UPDATE public.comision_liberaciones SET cuenta_id=${quote(account)} WHERE id=${quote(uuid(1001))}`, byName.sellerA, []],
      ['boss cannot see local release linked to foreign parent', `UPDATE public.comision_liberaciones SET comision_id=${quote(uuid(809))} WHERE id=${quote(uuid(1001))}`, `UPDATE public.comision_liberaciones SET comision_id=${quote(uuid(801))} WHERE id=${quote(uuid(1001))}`, byName.boss, ownTenant.filter((i) => i !== 1).map((i) => uuid(1000 + i))],
      ['supervisor cannot see team release linked to boss parent', `UPDATE public.comision_liberaciones SET comision_id=${quote(uuid(805))} WHERE id=${quote(uuid(1001))}`, `UPDATE public.comision_liberaciones SET comision_id=${quote(uuid(801))} WHERE id=${quote(uuid(1001))}`, byName.supervisor, supervisors.filter((i) => i !== 1).map((i) => uuid(1000 + i))],
    ];
    for (const [name, mutate, restore, actor, expected] of releaseMutations) {
      await test(`Optional releases: ${name}`, async () => {
        await db.exec(mutate);
        try { await equalRows(actor, releaseSelect, expected); }
        finally { await db.exec(restore); }
      });
    }
    await test('Optional release policies work with actual legacy policies only', async () => {
      await db.exec('DROP POLICY baseline_permissive ON public.comision_liberaciones; DROP POLICY baseline_tenant ON public.comision_liberaciones');
      try {
        for (const actor of [...actors, virtual]) {
          const numbers = actor.role === 'logistica' ? [] : expectedByActor[actor.name];
          await equalRows(actor, releaseSelect, numbers.map((i) => uuid(1000 + i)));
        }
        await equalRows(byName.boss, releaseSelect, [], { noToken: true });
        await equalRows(byName.sellerA, releaseSelect, [], { accountOverride: otherAccount });
      } finally {
        await db.exec(`CREATE POLICY baseline_permissive ON public.comision_liberaciones FOR SELECT TO authenticated USING (cuenta_id=auth.uid()); CREATE POLICY baseline_tenant ON public.comision_liberaciones AS RESTRICTIVE FOR SELECT TO authenticated USING (cuenta_id=auth.uid())`);
      }
    });
    await test('Service role retains all synthetic release rows', () => equalRows(null, releaseSelect, actors.map((actor) => uuid(1000 + actor.index)), { role: 'service_role' }));
    await test('Anonymous cannot read optional release rows', () => denied(null, releaseSelect, { role: 'anon' }));
  }
  await test('Report preserves net-sales calculation from actual migration 240', async () => {
    await equalRows(byName.sellerA, `SELECT venta_neta_usd::text FROM public.obtener_reporte_ventas_operaciones(NULL,NULL,${quote(byName.sellerA.id)}::uuid)`, ['100.0000']);
  });
} catch (error) {
  evidence.fatal = { message: error.message, code: error.code, detail: error.detail, stack: error.stack };
  console.error(error.message);
} finally {
  evidence.summary = { passed: results.filter((result) => result.status === 'passed').length, failed: results.filter((result) => result.status === 'failed').length, total: results.length, fatal: Boolean(evidence.fatal) };
  await db.close();
  evidence.exitCode = evidence.summary.failed || evidence.fatal ? 1 : 0;
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(runOutput, serialized, { encoding: 'utf8', flag: 'wx' });
  await writeFile(output, serialized, 'utf8');
  console.log(JSON.stringify({ ...evidence.summary, exitCode: evidence.exitCode }));
  console.log(output);
  console.log(runOutput);
  process.exitCode = evidence.exitCode;
}
