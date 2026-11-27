-- 316_staging_cierre_rpcs_dinero.sql — Solo STAGING (OP-2026-086, Fase 2 de OP-2026-078)
-- C1: cierra funciones de dinero o de datos que la pantalla no usa y que estaban abiertas
--     a usuarios sin sesión (anon) o con sesión (authenticated). El servidor (service_role)
--     las sigue pudiendo usar.
-- M5: tester_cleanup_cotizacion solo borra cotizaciones de la propia cuenta.
-- Quedan abiertas a propósito (justificación en OP-2026-086):
--   anon + authenticated: listar_usuarios_login, tiene_gate_configurado, validar_gate_acceso (pantalla de ingreso)
--   authenticated: lecturas (obtener_*, buscar_productos_hibrido, peso_producto_visible), ayudantes de reglas
--   de acceso (get_rol_actual, get_operador_id, current_operator_context, can_read_seller) y
--   tester_cleanup_cotizacion (probador interno, ahora limitado a la propia cuenta).
-- Rollback: 316_staging_cierre_rpcs_dinero_rollback.sql
BEGIN;

REVOKE ALL ON FUNCTION public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.registrar_cargo_cxc(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.registrar_pago_comision(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_comision(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.registrar_abono_cxc(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_cxc(uuid, numeric, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.liquidar_transportista(uuid, uuid, numeric, text, text, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_transportista(uuid, uuid, numeric, text, text, uuid, text, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.reasignar_cliente(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reasignar_cliente(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.calcularcomisiondespacho_238b(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tester_cleanup_cotizacion(p_cotizacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
  v_despacho_ids UUID[] := '{}'::UUID[];
  v_comision_ids UUID[] := '{}'::UUID[];
  v_item_ids UUID[] := '{}'::UUID[];
BEGIN
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'TESTER_ROLE_REQUIRED: solo roles privilegiados pueden ejecutar limpieza';
  END IF;

  -- OP-2026-086 (M5): solo borra cotizaciones de la propia cuenta (salvo el servidor).
  --   Si la cotización ya no existe, no hace nada (igual que antes).
  IF auth.role() IS DISTINCT FROM 'service_role' AND EXISTS (
    SELECT 1 FROM public.cotizaciones c
    WHERE c.id = p_cotizacion_id
      AND c.cuenta_id IS DISTINCT FROM (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'COTIZACION_DE_OTRA_CUENTA';
  END IF;

  SELECT array_agg(id) INTO v_despacho_ids
  FROM public.notas_despacho
  WHERE cotizacion_id = p_cotizacion_id;

  IF v_despacho_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_item_ids
    FROM public.notas_despacho_items
    WHERE despacho_id = ANY(v_despacho_ids);

    IF v_item_ids IS NOT NULL THEN
      DELETE FROM public.despacho_descuentos WHERE despacho_item_id = ANY(v_item_ids);
    END IF;

    SELECT array_agg(id) INTO v_comision_ids
    FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    IF v_comision_ids IS NOT NULL THEN
      DELETE FROM public.comision_liberaciones WHERE comision_id = ANY(v_comision_ids);
      DELETE FROM public.comisiones WHERE id = ANY(v_comision_ids);
    END IF;

    DELETE FROM public.cliente_prestamos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.cuentas_por_cobrar WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_fecha_entrega_cambios WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.pagos_transportistas_despachos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.seguimiento_operativo WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_devoluciones WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_devolucion_intercambios WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho_items WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho WHERE id = ANY(v_despacho_ids);
  END IF;

  DELETE FROM public.comisiones WHERE cotizacionid = p_cotizacion_id;
  DELETE FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id;
  DELETE FROM public.cotizaciones WHERE id = p_cotizacion_id;
END;
$function$;


REVOKE ALL ON FUNCTION public.tester_cleanup_cotizacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tester_cleanup_cotizacion(uuid) TO authenticated, service_role;

COMMIT;
