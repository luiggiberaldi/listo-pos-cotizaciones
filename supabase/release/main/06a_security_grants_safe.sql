-- 06a_security_grants_safe.sql
-- REVIEW ONLY — proyecto principal.
--
-- Subconjunto SEGURO de 06_security_grants_review.sql. Aplica el cutover de
-- permisos sobre las tablas de stock/Kardex/finanzas cuyo mapa de escrituras
-- ya está cerrado, y DEJA FUERA:
--   * public.productos (el frontend aún escribe imagen_url en ProductoForm y
--     activo en useDesactivarProducto);
--   * las RPC legacy de producto crear/actualizar/borrar_producto_con_kardex
--     (el frontend aún las invoca directo vía authenticated).
--
-- Alcance de este archivo:
--   - revoca INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN sobre
--     inventario_movimientos, cuentas_por_cobrar, comisiones,
--     despacho_devoluciones y despacho_devolucion_intercambios para
--     PUBLIC/anon/authenticated;
--   - conserva SELECT para anon/authenticated;
--   - revoca EXECUTE de las RPC legacy de finanzas/devolución y de las RPC
--     nuevas a authenticated, y conserva EXECUTE solo para service_role;
--   - NO revoca public.productos ni las RPC de producto legacy (se hará en 06
--     completo cuando se migren los 2 writes de frontend y TesterFlowView).
--
-- Reversible: basta re-otorgar los privilegios revocados (ver script de
-- rollback que genera el runner apply-security-grants-main.mjs).

BEGIN;

-- SAFETY GATE: elimina este bloque únicamente después de:
-- 1) confirmar backup/restauración;
-- 2) confirmar que el frontend ya NO escribe inventario_movimientos,
--    cuentas_por_cobrar, comisiones ni devoluciones con authenticated
--    (solo TesterFlowView, acotado a datos de test);
-- 3) verificar que las RPC legacy de producto NO están en el revoke.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 06a_security_grants_safe.sql no debe ejecutarse todavía';
END
$$;

-- ---------------------------------------------------------------------------
-- Precondiciones de revisión
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_required_names TEXT[] := ARRAY[
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
  IF to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.cuentas_por_cobrar') IS NULL
     OR to_regclass('public.comisiones') IS NULL
     OR to_regclass('public.despacho_devoluciones') IS NULL
     OR to_regclass('public.despacho_devolucion_intercambios') IS NULL THEN
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
-- Revocación de escrituras directas (5 tablas, excluyendo productos)
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.inventario_movimientos,
             public.cuentas_por_cobrar,
             public.comisiones,
             public.despacho_devoluciones,
             public.despacho_devolucion_intercambios
  FROM PUBLIC, anon, authenticated;

GRANT SELECT
  ON TABLE public.inventario_movimientos,
             public.cuentas_por_cobrar,
             public.comisiones,
             public.despacho_devoluciones,
             public.despacho_devolucion_intercambios
  TO anon, authenticated;

-- public.productos queda intacto: el frontend aún escribe imagen_url y activo
-- con authenticated. Se revocará en 06 completo cuando esos 2 writes migren.

-- ---------------------------------------------------------------------------
-- Revocación de RPC legacy de finanzas/devolución
-- ---------------------------------------------------------------------------
-- Solo las sobrecargas atómicas históricas ya reemplazadas por el Worker.
-- Se excluyen crear/actualizar/borrar_producto_con_kardex (el frontend las usa).
DO $$
DECLARE
  v_signature REGPROCEDURE;
  v_legacy_names TEXT[] := ARRAY[
    'confirmar_entrega_inventario_atomica',
    'registrar_devolucion_inventario_atomica',
    'revertir_entrega_inventario_atomica',
    'revertir_entrega_finanzas_atomica',
    'ajustar_finanzas_devolucion_atomica'
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

-- ---------------------------------------------------------------------------
-- Fachadas nuevas: solo service_role (el Worker)
-- ---------------------------------------------------------------------------
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
-- Auditoría posterior
-- ---------------------------------------------------------------------------
SELECT table_name,
       has_table_privilege('anon', 'public.' || table_name, 'SELECT') AS anon_select,
       has_table_privilege('anon', 'public.' || table_name, 'INSERT') AS anon_insert,
       has_table_privilege('anon', 'public.' || table_name, 'UPDATE') AS anon_update,
       has_table_privilege('anon', 'public.' || table_name, 'DELETE') AS anon_delete,
       has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') AS authenticated_insert,
       has_table_privilege('service_role', 'public.' || table_name, 'INSERT') AS service_role_insert
FROM unnest(ARRAY[
  'inventario_movimientos', 'cuentas_por_cobrar', 'comisiones',
  'despacho_devoluciones', 'despacho_devolucion_intercambios'
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
