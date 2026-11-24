CREATE OR REPLACE FUNCTION public.revertir_entrega_finanzas_atomica_staging(p_despacho_id uuid, p_nuevo_estado text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
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
  SELECT cuenta_id INTO v_cuenta_id FROM public.notas_despacho WHERE id = p_despacho_id;
  IF v_cuenta_id IS NULL THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  v_res := public.staging_reservar_operacion(v_cuenta_id, p_idempotency_key, 'revertir_entrega_finanzas');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.revertir_entrega_finanzas_atomica(
    p_despacho_id, p_nuevo_estado, p_usuario_id,
    p_usuario_nombre, p_usuario_color
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(v_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(v_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$function$
