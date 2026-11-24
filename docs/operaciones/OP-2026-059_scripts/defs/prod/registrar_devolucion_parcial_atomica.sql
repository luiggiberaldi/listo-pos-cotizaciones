CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_atomica(p_despacho_id uuid, p_devoluciones jsonb, p_intercambios jsonb DEFAULT '[]'::jsonb, p_motivo text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid, p_total_devuelto_usd numeric DEFAULT 0, p_total_intercambio_usd numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inventario JSONB;
  v_finanzas JSONB;
BEGIN
  v_inventario := public.registrar_devolucion_inventario_atomica(
    p_despacho_id,
    p_devoluciones,
    p_intercambios,
    p_motivo,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color,
    p_cotizacion_reemplazo_id,
    p_total_devuelto_usd,
    p_total_intercambio_usd
  );

  v_finanzas := public.ajustar_finanzas_devolucion_atomica(
    p_despacho_id,
    p_total_devuelto_usd,
    p_total_intercambio_usd,
    p_usuario_id,
    p_usuario_nombre
  );

  RETURN v_inventario || v_finanzas || jsonb_build_object('transaccion_atomica', TRUE);
END;
$function$
