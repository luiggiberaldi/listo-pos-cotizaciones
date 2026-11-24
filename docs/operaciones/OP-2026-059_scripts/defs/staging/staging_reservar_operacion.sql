CREATE OR REPLACE FUNCTION public.staging_reservar_operacion(p_cuenta_id uuid, p_idempotency_key uuid, p_operacion_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultado JSONB;
  v_tipo      TEXT;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_operacion_tipo IS NULL
     OR btrim(p_operacion_tipo) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  SELECT resultado, operacion_tipo
  INTO v_resultado, v_tipo
  FROM public.inventario_operaciones_staging
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_tipo <> p_operacion_tipo THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUTILIZADA';
    END IF;
    IF v_resultado IS NULL THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
    END IF;
    RETURN jsonb_build_object('existente', TRUE, 'resultado', v_resultado);
  END IF;

  INSERT INTO public.inventario_operaciones_staging
    (idempotency_key, cuenta_id, operacion_tipo)
  VALUES
    (p_idempotency_key, p_cuenta_id, p_operacion_tipo);

  RETURN jsonb_build_object('existente', FALSE);
END;
$function$
