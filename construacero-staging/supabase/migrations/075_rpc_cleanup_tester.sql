-- 075_rpc_cleanup_tester.sql
-- RPC para que el tester pueda limpiar datos de prueba.
-- Muchas tablas no tienen DELETE policies (RLS enabled, append-only),
-- así que las operaciones .delete() del cliente JS fallan silenciosamente.
-- Este RPC es SECURITY DEFINER y solo lo pueden ejecutar supervisores/desarrolladores.

CREATE OR REPLACE FUNCTION public.tester_cleanup_cotizacion(p_cotizacion_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
  v_despacho_ids UUID[];
BEGIN
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores pueden ejecutar limpieza de tester';
  END IF;

  -- Collect despacho IDs first (FK references use despacho_id, not cotizacion_id)
  SELECT array_agg(id) INTO v_despacho_ids
  FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id;

  IF v_despacho_ids IS NOT NULL THEN
    DELETE FROM public.despacho_descuentos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.cuentas_por_cobrar WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.comisiones WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id;
  END IF;

  -- Also delete comisiones linked directly by cotizacion_id
  DELETE FROM public.comisiones WHERE cotizacion_id = p_cotizacion_id;
  DELETE FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id;
  DELETE FROM public.cotizaciones WHERE id = p_cotizacion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tester_cleanup_cotizacion(UUID) TO authenticated;
