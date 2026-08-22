-- 00_preflight_readonly.sql
-- Proyecto principal: solo lectura.
-- No ejecutar junto con db push/reset ni combinarlo con migraciones mutables.

SELECT jsonb_build_object(
  'ok', TRUE,
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'migration_history', jsonb_build_object(
    'table_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'rows', (SELECT count(*) FROM supabase_migrations.schema_migrations),
    'max_version', (SELECT max(version) FROM supabase_migrations.schema_migrations)
  ),
  'core_tables', jsonb_build_object(
    'productos', to_regclass('public.productos') IS NOT NULL,
    'inventario_movimientos', to_regclass('public.inventario_movimientos') IS NOT NULL,
    'notas_despacho', to_regclass('public.notas_despacho') IS NOT NULL,
    'notas_despacho_items', to_regclass('public.notas_despacho_items') IS NOT NULL,
    'configuracion_negocio', to_regclass('public.configuracion_negocio') IS NOT NULL,
    'clientes', to_regclass('public.clientes') IS NOT NULL,
    'comisiones', to_regclass('public.comisiones') IS NOT NULL,
    'cuentas_por_cobrar', to_regclass('public.cuentas_por_cobrar') IS NOT NULL,
    'cliente_prestamos', to_regclass('public.cliente_prestamos') IS NOT NULL
  ),
  'provenance_columns', jsonb_build_object(
    'origen_tipo', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventario_movimientos' AND column_name = 'origen_tipo'
    ),
    'origen_id', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventario_movimientos' AND column_name = 'origen_id'
    ),
    'origen_referencia', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventario_movimientos' AND column_name = 'origen_referencia'
    ),
    'idempotency_key', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventario_movimientos' AND column_name = 'idempotency_key'
    )
  ),
  'tenant_integrity', jsonb_build_object(
    'usuarios', (SELECT count(*) FROM public.usuarios),
    'usuarios_id_equals_cuenta', (SELECT count(*) FROM public.usuarios WHERE id = cuenta_id),
    'product_tenants', (SELECT count(DISTINCT cuenta_id) FROM public.productos),
    'products_without_tenant', (SELECT count(*) FROM public.productos WHERE cuenta_id IS NULL),
    'movements_without_tenant', (SELECT count(*) FROM public.inventario_movimientos WHERE cuenta_id IS NULL)
  ),
  'new_operation_tables', jsonb_build_object(
    'inventario_operaciones', to_regclass('public.inventario_operaciones') IS NOT NULL,
    'kardex_reconciliaciones', to_regclass('public.kardex_reconciliaciones') IS NOT NULL,
    'kardex_provenance_backfills', to_regclass('public.kardex_provenance_backfills') IS NOT NULL
  ),
  'inventory_rls', jsonb_build_object(
    'productos_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.productos'::regclass),
    'movimientos_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inventario_movimientos'::regclass)
  ),
  'operation_functions', jsonb_build_object(
    'manual_atomic', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'aplicar_movimiento_inventario_atomico'),
    'transform_atomic', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'transformar_inventario_atomico'),
    'loan_return_atomic', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'devolver_prestamo_inventario_atomico'),
    'batch_ingest_atomic', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ingresar_lote_inventario_atomico')
  )
) AS kardex_principal_preflight;
