-- 282_staging_fix_rpcs_visibilidad_e2e.sql
-- Arreglos detectados por el E2E nocturno al modernizarlo al diseño de sesión
-- por token (migración 241 del principal, aplicada en staging):
--
-- 1) obtener_stock_comprometido() perdió el GRANT EXECUTE (restauración antigua
--    del esquema de staging): ni authenticated ni service_role pueden llamarla,
--    así el paso de stock comprometido del Tester y cualquier uso del Worker
--    fallan con "permission denied for function".
--
-- 2) tester_cleanup_cotizacion quedó con la puerta de roles de la versión 075
--    ("solo supervisores"): exigía get_rol_actual() IN ('supervisor',
--    'administracion'). Desde el diseño 241, get_rol_actual() devuelve el rol
--    crudo ('desarrollador', 'jefe', ...) — ya no hay mapeo a supervisor — y la
--    limpieza del Tester quedaba denegada. Se restaura la puerta de la versión
--    234 del principal ("roles privilegiados": supervisor, administración, jefe
--    y desarrollador) conservando el SQL esquema-actual de la 256.
--
-- Seguridad: no relaja tablas ni políticas; solo habilita una RPC de solo
-- lectura para los roles autenticados originales y alinea la RPC de limpieza
-- del Tester con su versión canónica del principal. Idempotente.
BEGIN;

-- 1) Permisos de la RPC de stock comprometido (como 041/222 la definieron).
GRANT EXECUTE ON FUNCTION public.obtener_stock_comprometido() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.obtener_stock_comprometido_detalle(UUID) TO authenticated, service_role;

-- 2) tester_cleanup_cotizacion: cuerpo de la 256 con la puerta de roles de la 234.
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
GRANT EXECUTE ON FUNCTION public.tester_cleanup_cotizacion(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
