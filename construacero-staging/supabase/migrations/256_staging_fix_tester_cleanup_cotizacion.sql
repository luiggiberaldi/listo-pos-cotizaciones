-- 256_staging_fix_tester_cleanup_cotizacion.sql
--
-- BUG FIX detectado por el E2E determinista (paso 69, 2026-08-28):
-- tester_cleanup_cotizacion usaba despacho_descuentos.despacho_id, columna
-- legacy eliminada cuando la tabla migró a despacho_item_id. La RPC siempre
-- lanzaba error y forzaba el fallback del runner (DELETE con sesión del
-- tester), que RLS vuelve no-op silencioso cuando la cotización cambió de
-- vendedor (reciclar / crear-version reasignan al vendedor destino).
--
-- Fix: misma firma y guardas, SQL actualizado al esquema actual:
--   * despacho_descuentos vía notas_despacho_items (despacho_item_id)
--   * limpia comision_liberaciones antes de comisiones
--   * limpia notas_despacho_items antes de notas_despacho
-- SECURITY DEFINER: borra por ID sin depender del ownership posterior.
-- Idempotente: seguro de re-ejecutar.

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
  IF v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores pueden ejecutar limpieza de tester';
  END IF;

  SELECT array_agg(id) INTO v_despacho_ids
  FROM public.notas_despacho
  WHERE cotizacion_id = p_cotizacion_id;

  IF v_despacho_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_item_ids
    FROM public.notas_despacho_items
    WHERE despacho_id = ANY(v_despacho_ids);

    -- Descuentos por ítem de despacho (esquema actual: despacho_item_id)
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

    DELETE FROM public.cuentas_por_cobrar WHERE despacho_id = ANY(v_despacho_ids);
    -- Historiales/dependencias con FK a notas_despacho (orden seguro)
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
GRANT EXECUTE ON FUNCTION public.tester_cleanup_cotizacion(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
