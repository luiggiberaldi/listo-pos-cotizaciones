-- 06_security_grants_review.sql
-- REVIEW ONLY — proyecto principal.
--
-- Propósito: preparar el cutover de permisos para que las mutaciones críticas
-- de inventario/devoluciones/finanzas solo entren por el Worker/service_role.
-- Este archivo fuente permanece REVIEW_ONLY y no debe ejecutarse directamente.
-- El apply del 2026-08-22 fue realizado por el runner, retirando el gate solo
-- en memoria y conservando este SQL revisable como referencia.
--
-- Estado del cutover (2026-08-22):
-- - Worker desplegado y usa service_role para mutaciones.
-- - Writes de productos.imagen_url/activo y RPC de producto fueron migrados al Worker.
-- - TesterFlowView conserva dos deletes de cleanup de pruebas; quedaron bloqueados
--   por los grants y siguen pendientes de migración a RPC/Worker.
-- - Resultado y gates: docs/plans/2026-08-22-apply-security-grants-full-main.md
--
-- Alcance deliberadamente conservador:
-- - conserva SELECT para anon/authenticated;
-- - retira solo privilegios mutantes de las tablas de source-of-truth;
-- - no toca notas_despacho, clientes ni cliente_prestamos hasta mapear todos
--   sus flujos de escritura;
-- - no usa ALTER DEFAULT PRIVILEGES para evitar afectar módulos futuros;
-- - no revoca permisos de postgres ni service_role.

BEGIN;

-- SAFETY GATE: elimina este bloque únicamente después de:
-- 1) confirmar backup/restauración;
-- 2) desplegar el Worker con wrappers neutrales e idempotency obligatoria;
-- 3) validar que las lecturas REST continúan funcionando;
-- 4) ejecutar pruebas de devolución, reversión, finanzas y replay;
-- 5) aprobar el plan de rollback de permisos;
-- 6) migrar los writes directos de frontend a productos (imagen_url, activo)
--    y confirmar que TesterFlowView limpia vía RPC/Worker.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 06_security_grants_review.sql no debe ejecutarse todavía';
END
$$;

-- ---------------------------------------------------------------------------
-- Precondiciones de revisión
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_required_names TEXT[] := ARRAY[
    'enriquecer_proveniencia_kardex',
    'reservar_operacion_inventario',
    'guardar_operacion_inventario',
    'etiquetar_lote_inventario',
    'aplicar_movimiento_inventario_atomico',
    'transformar_inventario_atomico',
    'devolver_prestamo_inventario_atomico',
    'ingresar_lote_inventario_atomico',
    'ajustar_finanzas_devolucion_neta',
    'confirmar_entrega_inventario_idempotente',
    'confirmar_entrega_finanzas_idempotente',
    'registrar_devolucion_parcial_idempotente',
    'revertir_entrega_finanzas_idempotente',
    'revertir_entrega_inventario_idempotente',
    'crear_producto_con_kardex_tenant_safe',
    'actualizar_producto_con_kardex_tenant_safe',
    'borrar_producto_con_kardex_tenant_safe',
    'limpiar_inventario_atomico',
    'reconciliar_kardex',
    'revertir_reconciliacion_kardex'
  ];
  v_found_names INTEGER;
BEGIN
  IF to_regclass('public.productos') IS NULL
     OR to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.despacho_devoluciones') IS NULL
     OR to_regclass('public.despacho_devolucion_intercambios') IS NULL
     OR to_regclass('public.cuentas_por_cobrar') IS NULL
     OR to_regclass('public.comisiones') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas de seguridad no encontradas';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: roles Supabase no encontrados';
  END IF;

  SELECT count(DISTINCT p.proname)::INTEGER
  INTO v_found_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = ANY(v_required_names);

  IF v_found_names <> cardinality(v_required_names) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: wrappers/guardrails neutrales incompletos (% de %)',
      v_found_names, cardinality(v_required_names);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Propuesta de permisos de tablas
-- ---------------------------------------------------------------------------
-- Estas operaciones conservan SELECT. La aplicación no debe escribir estas
-- tablas directamente con anon/authenticated después del cutover.
-- ⚠️ public.productos está incluido en el REVOKE, pero ANTES de aplicar deben
-- migrarse productos.imagen_url y productos.activo al Worker; de lo contrario el
-- frontend rompe al subir imagen o al activar/desactivar producto.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.productos,
             public.inventario_movimientos,
             public.despacho_devoluciones,
             public.despacho_devolucion_intercambios,
             public.cuentas_por_cobrar,
             public.comisiones
  FROM PUBLIC, anon, authenticated;

GRANT SELECT
  ON TABLE public.productos,
             public.inventario_movimientos,
             public.despacho_devoluciones,
             public.despacho_devolucion_intercambios,
             public.cuentas_por_cobrar,
             public.comisiones
  TO anon, authenticated;

-- No se revocan todavía escrituras de notas_despacho, clientes ni
-- cliente_prestamos: requieren un mapa funcional separado para no romper
-- creación/edición de despachos, clientes y préstamos.

-- ---------------------------------------------------------------------------
-- Propuesta de permisos de RPC
-- ---------------------------------------------------------------------------
-- Revoca todas las sobrecargas de las RPC históricas confirmadas en pg_proc.
-- El loop evita depender de una firma que pueda variar entre restores, pero
-- solo actúa sobre nombres auditados; no hace DROP ni CREATE.
DO $$
DECLARE
  v_signature REGPROCEDURE;
  v_legacy_names TEXT[] := ARRAY[
    'confirmar_entrega_inventario_atomica',
    'registrar_devolucion_inventario_atomica',
    'revertir_entrega_inventario_atomica',
    'revertir_entrega_finanzas_atomica',
    'ajustar_finanzas_devolucion_atomica',
    'crear_producto_con_kardex',
    'actualizar_producto_con_kardex',
    'borrar_producto_con_kardex'
  ];
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_legacy_names)
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_signature
    );
  END LOOP;
END
$$;

-- Asegura que las fachadas nuevas queden disponibles únicamente al Worker.
-- enriquecer_proveniencia_kardex es una función de trigger y no recibe GRANT
-- directo; las demás funciones sí son invocadas por wrappers/Worker.
DO $$
DECLARE
  v_signature REGPROCEDURE;
  v_new_names TEXT[] := ARRAY[
    'reservar_operacion_inventario',
    'guardar_operacion_inventario',
    'etiquetar_lote_inventario',
    'aplicar_movimiento_inventario_atomico',
    'transformar_inventario_atomico',
    'devolver_prestamo_inventario_atomico',
    'ingresar_lote_inventario_atomico',
    'ajustar_finanzas_devolucion_neta',
    'confirmar_entrega_inventario_idempotente',
    'confirmar_entrega_finanzas_idempotente',
    'registrar_devolucion_parcial_idempotente',
    'revertir_entrega_finanzas_idempotente',
    'revertir_entrega_inventario_idempotente',
    'crear_producto_con_kardex_tenant_safe',
    'actualizar_producto_con_kardex_tenant_safe',
    'borrar_producto_con_kardex_tenant_safe',
    'limpiar_inventario_atomico',
    'reconciliar_kardex',
    'revertir_reconciliacion_kardex'
  ];
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_new_names)
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_signature
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Auditoría posterior propuesta
-- ---------------------------------------------------------------------------
-- Estas consultas deben conservarse como evidencia del cambio; no constituyen
-- una autorización para saltar el safety gate.
SELECT table_name,
       has_table_privilege('anon', 'public.' || table_name, 'SELECT') AS anon_select,
       has_table_privilege('anon', 'public.' || table_name, 'INSERT') AS anon_insert,
       has_table_privilege('anon', 'public.' || table_name, 'UPDATE') AS anon_update,
       has_table_privilege('anon', 'public.' || table_name, 'DELETE') AS anon_delete,
       has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') AS authenticated_insert,
       has_table_privilege('service_role', 'public.' || table_name, 'INSERT') AS service_role_insert
FROM unnest(ARRAY[
  'productos', 'inventario_movimientos', 'despacho_devoluciones',
  'despacho_devolucion_intercambios', 'cuentas_por_cobrar', 'comisiones'
]) AS t(table_name)
ORDER BY table_name;

SELECT p.oid::regprocedure::text AS signature,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = ANY(ARRAY[
    'confirmar_entrega_inventario_atomica',
    'registrar_devolucion_inventario_atomica',
    'revertir_entrega_inventario_atomica',
    'revertir_entrega_finanzas_atomica',
    'ajustar_finanzas_devolucion_atomica',
    'confirmar_entrega_inventario_idempotente',
    'confirmar_entrega_finanzas_idempotente',
    'registrar_devolucion_parcial_idempotente',
    'revertir_entrega_finanzas_idempotente',
    'revertir_entrega_inventario_idempotente'
  ])
ORDER BY p.proname, signature;

COMMIT;
