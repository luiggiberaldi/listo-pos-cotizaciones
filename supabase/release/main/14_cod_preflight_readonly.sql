-- 14_cod_preflight_readonly.sql
-- Read-only inspection for the main-project COD release proposal.
-- Running this file does not authorize an apply and never mutates database state.

WITH required_tables(table_name) AS (
  VALUES ('notas_despacho'), ('cuentas_por_cobrar'), ('clientes'), ('usuarios'),
         ('auditoria'), ('despacho_devoluciones'), ('despacho_devolucion_intercambios')
),
required_columns(table_name, column_name) AS (
  VALUES
    ('notas_despacho','id'), ('notas_despacho','numero'), ('notas_despacho','cuenta_id'),
    ('notas_despacho','estado'), ('notas_despacho','cliente_id'),
    ('notas_despacho','cliente_factura_id'), ('notas_despacho','total_usd'),
    ('notas_despacho','forma_pago'), ('notas_despacho','forma_pago_cliente'),
    ('cuentas_por_cobrar','id'), ('cuentas_por_cobrar','cuenta_id'),
    ('cuentas_por_cobrar','cliente_id'), ('cuentas_por_cobrar','despacho_id'),
    ('cuentas_por_cobrar','tipo'), ('cuentas_por_cobrar','monto_usd'),
    ('cuentas_por_cobrar','saldo_usd'), ('cuentas_por_cobrar','metodo_pago'),
    ('cuentas_por_cobrar','forma_pago_abono'), ('cuentas_por_cobrar','referencia'),
    ('cuentas_por_cobrar','descripcion'), ('cuentas_por_cobrar','registrado_por'),
    ('clientes','id'), ('clientes','cuenta_id'), ('usuarios','id'), ('usuarios','cuenta_id'),
    ('usuarios','nombre'), ('usuarios','rol'), ('usuarios','activo'),
    ('auditoria','usuario_id'), ('auditoria','usuario_nombre'), ('auditoria','usuario_rol'),
    ('auditoria','categoria'), ('auditoria','accion'), ('auditoria','descripcion'),
    ('auditoria','entidad_tipo'), ('auditoria','entidad_id'), ('auditoria','meta'),
    ('auditoria','ip_origen'), ('auditoria','cuenta_id'),
    ('despacho_devoluciones','despacho_id'), ('despacho_devoluciones','total_devuelto_usd'),
    ('despacho_devolucion_intercambios','despacho_id'), ('despacho_devolucion_intercambios','total_usd')
),
missing AS (
  SELECT string_agg(rc.table_name || '.' || rc.column_name, ', ' ORDER BY rc.table_name, rc.column_name) AS names
  FROM required_columns rc
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = rc.table_name
      AND c.column_name = rc.column_name
  )
)
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'pg_input_is_valid_available', to_regprocedure('pg_catalog.pg_input_is_valid(text,text)') IS NOT NULL,
  'tables', (SELECT jsonb_object_agg(t.table_name, to_regclass('public.' || t.table_name) IS NOT NULL)
             FROM required_tables t),
  'missing_columns', (SELECT names FROM missing),
  'current_cod_release_present',
    to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL,
  'recalcularcomisiondespacho_238b_present',
    to_regprocedure('public.recalcularcomisiondespacho_238b(uuid)') IS NOT NULL,
  'cod_summary_present',
    to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL,
  'cod_reconciliation_present',
    to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL,
  'idempotency_table_present', to_regclass('public.cod_conciliacion_idempotencia') IS NOT NULL,
  'migration_history_table_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'result', 'READ_ONLY_ONLY_NOT_AN_APPLY_APPROVAL'
) AS cod_main_preflight;
