CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_atomica_staging(p_despacho_id uuid, p_devoluciones jsonb, p_intercambios jsonb DEFAULT '[]'::jsonb, p_motivo text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid, p_total_devuelto_usd numeric DEFAULT 0, p_total_intercambio_usd numeric DEFAULT 0, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_id UUID;
  v_res       JSONB;
  v_result    JSONB;
BEGIN
  SELECT cuenta_id INTO v_cuenta_id
  FROM public.notas_despacho
  WHERE id = p_despacho_id;
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  v_res := public.staging_reservar_operacion(v_cuenta_id, p_idempotency_key, 'devolucion_parcial_despacho');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.registrar_devolucion_parcial_atomica(
    p_despacho_id, p_devoluciones, p_intercambios, p_motivo,
    p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_cotizacion_reemplazo_id, p_total_devuelto_usd,
    p_total_intercambio_usd
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE,
    'cotizacion_reemplazo_id', p_cotizacion_reemplazo_id,
    'total_devuelto_usd', p_total_devuelto_usd,
    'total_intercambio_usd', p_total_intercambio_usd
  );
  PERFORM public.staging_etiquetar_lote(v_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(v_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$function$
