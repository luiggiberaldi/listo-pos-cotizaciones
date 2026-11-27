-- Rollback de 316_staging_cierre_rpcs_dinero.sql (Solo STAGING). Vuelve a abrir C1: solo emergencia.
BEGIN;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_comision(uuid, uuid, uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_cxc(uuid, numeric, text, text, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_transportista(uuid, uuid, numeric, text, text, uuid, text, uuid[]) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reasignar_cliente(uuid, uuid, text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(uuid) TO authenticated;

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

COMMIT;
