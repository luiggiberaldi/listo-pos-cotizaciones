CREATE OR REPLACE FUNCTION public.staging_guardar_operacion(p_cuenta_id uuid, p_idempotency_key uuid, p_resultado jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.inventario_operaciones_staging
  SET resultado = p_resultado,
      actualizado_en = now()
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key;
END;
$function$
