CREATE OR REPLACE FUNCTION public.revertir_entrega_finanzas_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_nuevo_estado text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho  RECORD;
  v_guard     JSONB;
  v_resultado JSONB;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL
     OR p_usuario_id IS NULL OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_IDEMPOTENTE_INVALIDOS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_usuario_id AND cuenta_id = p_cuenta_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'USUARIO_FUERA_DE_TENANT';
  END IF;

  SELECT id, cuenta_id INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_EN_TENANT'; END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'dispatch_financial_reversal'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  v_resultado := public.revertir_entrega_finanzas_atomica(
    p_despacho_id, p_nuevo_estado, p_usuario_id, p_usuario_nombre, p_usuario_color
  );
  v_resultado := COALESCE(v_resultado, '{}'::JSONB)
    || jsonb_build_object('idempotency_key', p_idempotency_key);
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$
