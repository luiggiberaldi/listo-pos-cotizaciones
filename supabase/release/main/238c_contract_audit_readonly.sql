-- 238c_contract_audit_readonly.sql
-- READ ONLY - auditoría de contrato para el proyecto principal.
--
-- Propósito:
--   Comparar el catálogo PostgreSQL real con las precondiciones de 238/238b
--   antes de preparar cualquier SQL mutante.
--
-- Este archivo NO es una migración. No contiene DDL, DML, GRANT, REVOKE,
-- NOTIFY ni cambios de configuración. Solo consulta catálogos y datos mínimos
-- de integridad, dentro de una transacción REPEATABLE READ READ ONLY.
--
-- Resultado:
--   Una fila JSONB con tablas, columnas, funciones, grants, constraints,
--   índices, triggers y el dictamen de precondiciones.
--
-- La lectura dinámica de schema_migrations se emite como NOTICE porque su
-- presencia no está garantizada en todos los restores. El runner debe guardar
-- esos NOTICE junto con el JSON devuelto.

BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

DO $$
DECLARE
  v_rows BIGINT;
  v_max_version TEXT;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE '238c migration_history table_present=false';
  ELSE
    EXECUTE
      'SELECT count(*)::bigint, max(version)::text '
      'FROM supabase_migrations.schema_migrations'
      INTO v_rows, v_max_version;
    RAISE NOTICE '238c migration_history table_present=true rows=% max_version=%',
      v_rows, COALESCE(v_max_version, '<null>');
  END IF;
END
$$;

WITH expected_columns(table_name, column_name, contract_area) AS (
  VALUES
    ('comisiones', 'despachoid', 'identity'),
    ('comisiones', 'vendedorid', 'identity'),
    ('comisiones', 'cotizacionid', 'identity'),
    ('comisiones', 'cuentaid', 'tenant'),
    ('comisiones', 'totalcomision', 'amounts'),
    ('comisiones', 'comisioncabilla', 'amounts'),
    ('comisiones', 'comisionotros', 'amounts'),
    ('comisiones', 'estado', 'state'),
    ('comisiones', 'montopagado', 'legacy_payment'),
    ('comisiones', 'pagadaen', 'legacy_payment'),
    ('comisiones', 'pagadapor', 'legacy_payment'),
    ('comisiones', 'detalle_extras', '238b_evidence'),
    ('comisiones', 'comision_liberada', '238b_evidence'),
    ('comisiones', 'comision_retenida', '238b_evidence'),
    ('comisiones', 'comision_cxc_excluida', '238b_evidence'),
    ('comisiones', 'comision_pago_excluida', '238b_evidence'),
    ('comisiones', 'comision_otras_exclusiones', '238b_evidence'),
    ('comisiones', 'fraccion_no_cxc', '238b_evidence'),
    ('comisiones', 'calculo_version', '238b_evidence'),
    ('comisiones', 'politica_comision', '238b_evidence'),
    ('comisiones', 'fuente_calculo', '238b_evidence'),
    ('comisiones', 'calculo_evidencia', '238b_evidence'),
    ('notas_despacho', 'id', 'dispatch'),
    ('notas_despacho', 'numero', 'dispatch'),
    ('notas_despacho', 'cotizacion_id', 'dispatch'),
    ('notas_despacho', 'cuenta_id', 'tenant'),
    ('notas_despacho', 'cliente_id', 'dispatch'),
    ('notas_despacho', 'vendedor_id', 'dispatch'),
    ('notas_despacho', 'estado', 'dispatch'),
    ('notas_despacho', 'total_usd', 'payment'),
    ('notas_despacho', 'forma_pago', 'payment'),
    ('notas_despacho', 'forma_pago_cliente', 'payment'),
    ('notas_despacho', 'creado_en', 'date'),
    ('notas_despacho_items', 'despacho_id', 'dispatch_items'),
    ('notas_despacho_items', 'producto_id', 'dispatch_items'),
    ('notas_despacho_items', 'total_linea_usd', 'dispatch_items'),
    ('notas_despacho_items', 'nombre_snap', 'dispatch_items'),
    ('notas_despacho_items', 'origen', 'dispatch_items'),
    ('notas_despacho_items', 'es_prestamo', 'dispatch_items'),
    ('cotizacion_items', 'cotizacion_id', 'quote_items'),
    ('cotizacion_items', 'producto_id', 'quote_items'),
    ('cotizacion_items', 'total_linea_usd', 'quote_items'),
    ('cotizacion_items', 'nombre_snap', 'quote_items'),
    ('cotizacion_items', 'origen', 'quote_items'),
    ('clientes', 'id', 'seller_owner'),
    ('clientes', 'vendedor_id', 'seller_owner'),
    ('usuarios', 'id', 'seller'),
    ('usuarios', 'cuenta_id', 'tenant'),
    ('usuarios', 'nombre', 'seller'),
    ('usuarios', 'rol', 'seller'),
    ('usuarios', 'activo', 'seller'),
    ('usuarios', 'es_externo', 'seller'),
    ('usuarios', 'markup_pct', 'seller'),
    ('usuarios', 'comision_pct', 'seller'),
    ('usuarios', 'comision_pct_cabilla', 'seller'),
    ('configuracion_negocio', 'id', 'configuration'),
    ('configuracion_negocio', 'cuenta_id', 'tenant'),
    ('configuracion_negocio', 'comision_categoria_cabilla', 'configuration'),
    ('configuracion_negocio', 'comision_pct_cabilla', 'configuration'),
    ('configuracion_negocio', 'comision_pct_otros', 'configuration'),
    ('configuracion_negocio', 'comision_pct_externos', 'configuration'),
    ('configuracion_negocio', '_comision_extras', 'configuration'),
    ('configuracion_negocio', 'comision_ext_pct_cabilla', 'configuration'),
    ('configuracion_negocio', 'comision_ext_pct_otros', 'configuration'),
    ('configuracion_negocio', 'comision_ext_pct_externos', 'configuration'),
    ('configuracion_negocio', '_comision_ext_extras', 'configuration'),
    ('despacho_descuentos', 'despacho_id', 'discounts'),
    ('despacho_descuentos', 'cotizacion_item_id', 'discounts'),
    ('despacho_descuentos', 'monto_usd', 'discounts')
), column_status AS (
  SELECT
    e.table_name,
    e.column_name,
    e.contract_area,
    EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = e.table_name
        AND c.column_name = e.column_name
    ) AS present
  FROM expected_columns e
), requested_functions(signature, contract_area) AS (
  VALUES
    ('public.calcularcomisiondespacho(uuid)', 'legacy_calculator'),
    ('public.calcular_comision_despacho(uuid)', 'legacy_calculator_alias'),
    ('public.obtener_resumen_comisiones_v2(uuid,uuid,text,timestamptz,timestamptz)', 'legacy_summary'),
    ('public.marcar_comision_pagada(uuid)', 'legacy_payment')
), function_status AS (
  SELECT
    f.signature,
    f.contract_area,
    to_regprocedure(f.signature) IS NOT NULL AS present,
    COALESCE(g.grants, '[]'::jsonb) AS grants
  FROM requested_functions f
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'grantee', COALESCE(r.rolname, 'PUBLIC'),
        'privilege', x.privilege_type,
        'is_grantable', x.is_grantable
      ) ORDER BY COALESCE(r.rolname, 'PUBLIC'), x.privilege_type
    ) AS grants
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      CASE
        WHEN p.oid IS NULL THEN ARRAY[]::aclitem[]
        ELSE COALESCE(p.proacl, acldefault('f', p.proowner))
      END
    ) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE p.oid = to_regprocedure(f.signature)
  ) g ON TRUE
), target_tables(table_name) AS (
  VALUES
    ('comisiones'),
    ('notas_despacho'),
    ('notas_despacho_items'),
    ('cliente_prestamos')
), table_write_grants AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'table', t.table_name,
      'roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'role', r.rolname,
          'select', has_table_privilege(r.rolname, format('public.%I', t.table_name), 'SELECT'),
          'insert', has_table_privilege(r.rolname, format('public.%I', t.table_name), 'INSERT'),
          'update', has_table_privilege(r.rolname, format('public.%I', t.table_name), 'UPDATE'),
          'delete', has_table_privilege(r.rolname, format('public.%I', t.table_name), 'DELETE')
        ) ORDER BY r.rolname)
        FROM pg_roles r
        WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
      ), '[]'::jsonb)
    ) ORDER BY t.table_name
  ) AS grants
  FROM target_tables t
), comisiones_constraints AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', conname,
    'type', contype,
    'definition', pg_get_constraintdef(oid)
  ) ORDER BY conname), '[]'::jsonb) AS constraints
  FROM pg_constraint
  WHERE conrelid = to_regclass('public.comisiones')
), comisiones_indexes AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', indexname,
    'definition', indexdef
  ) ORDER BY indexname), '[]'::jsonb) AS indexes
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'comisiones'
), relevant_triggers AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', n.nspname || '.' || c.relname,
    'name', t.tgname,
    'definition', pg_get_triggerdef(t.oid)
  ) ORDER BY c.relname, t.tgname), '[]'::jsonb) AS triggers
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND n.nspname = 'public'
    AND c.relname IN ('comisiones', 'notas_despacho', 'notas_despacho_items')
), requested_tables AS (
  SELECT jsonb_object_agg(v.table_name, to_regclass(v.table_name) IS NOT NULL) AS tables
  FROM (VALUES
    ('public.comisiones'),
    ('public.notas_despacho'),
    ('public.notas_despacho_items'),
    ('public.cotizacion_items'),
    ('public.clientes'),
    ('public.usuarios'),
    ('public.configuracion_negocio'),
    ('public.despacho_descuentos'),
    ('public.comision_238b_batches'),
    ('public.comision_238b_batch_rows')
  ) v(table_name)
), evidence_preconditions AS (
  SELECT
    COALESCE(bool_and(present) FILTER (WHERE contract_area = '238b_evidence'), FALSE) AS evidence_columns_complete,
    COALESCE(bool_and(present) FILTER (WHERE contract_area IN ('dispatch_items', 'quote_items', 'payment', 'configuration')), FALSE) AS calculation_columns_complete,
    COALESCE(bool_and(present), FALSE) AS all_requested_columns_present
  FROM column_status
), unique_dispatch_index AS (
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'comisiones'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%despachoid%'
  ) AS present
), duplicate_dispatch_rows AS (
  SELECT count(*)::BIGINT AS duplicate_keys
  FROM (
    SELECT despachoid
    FROM public.comisiones
    GROUP BY despachoid
    HAVING count(*) > 1
  ) d
), state_values AS (
  SELECT COALESCE(jsonb_agg(DISTINCT estado ORDER BY estado), '[]'::jsonb) AS state_values_json
  FROM public.comisiones
), function_238b_preconditions AS (
  SELECT bool_and(present) AS all_present
  FROM function_status
  WHERE signature IN (
    'public.calcularcomisiondespacho(uuid)',
    'public.obtener_resumen_comisiones_v2(uuid,uuid,text,timestamptz,timestamptz)'
  )
)
SELECT jsonb_build_object(
  'contract_version', '238c',
  'project_database', current_database(),
  'server_version', current_setting('server_version'),
  'transaction', jsonb_build_object(
    'isolation', current_setting('transaction_isolation'),
    'read_only', current_setting('transaction_read_only'),
    'deferrable', current_setting('transaction_deferrable')
  ),
  'migration_history', jsonb_build_object(
    'table_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'max_version_is_reported_in_notice', TRUE,
    'note', 'No se consulta una relación ausente de forma estática; conservar el NOTICE del bloque anterior.'
  ),
  'tables', (SELECT tables FROM requested_tables),
  'columns', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.table_name, s.column_name), '[]'::jsonb) FROM column_status s),
  'functions', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signature', signature,
    'contract_area', contract_area,
    'present', present,
    'grants', grants
  ) ORDER BY signature), '[]'::jsonb) FROM function_status),
  'table_write_grants', (SELECT grants FROM table_write_grants),
  'constraints', (SELECT constraints FROM comisiones_constraints),
  'indexes', (SELECT indexes FROM comisiones_indexes),
  'triggers', (SELECT triggers FROM relevant_triggers),
  'observed_data_checks', jsonb_build_object(
    'comisiones_rows', (SELECT count(*) FROM public.comisiones),
    'duplicate_dispatch_keys', (SELECT duplicate_keys FROM duplicate_dispatch_rows),
    'state_values', (SELECT state_values_json FROM state_values)
  ),
  '238b_preconditions', jsonb_build_object(
    'required_evidence_columns', (SELECT evidence_columns_complete FROM evidence_preconditions),
    'required_calculation_columns', (SELECT calculation_columns_complete FROM evidence_preconditions),
    'required_unique_dispatch_index', (SELECT present FROM unique_dispatch_index),
    'no_duplicate_dispatch_keys', (SELECT duplicate_keys = 0 FROM duplicate_dispatch_rows),
    'legacy_contracts_present', (SELECT all_present FROM function_238b_preconditions),
    'ready_for_mutating_sql', FALSE,
    'reason', 'Este auditor no autoriza instalar 238/238b; un solo precondition false mantiene NO-GO.'
  )
) AS contract_audit;

ROLLBACK;

-- El runner debe guardar el JSON y los NOTICE de migration_history juntos.
-- No ejecutar con db push, no retirar REVIEW_ONLY y no encadenar migraciones.
