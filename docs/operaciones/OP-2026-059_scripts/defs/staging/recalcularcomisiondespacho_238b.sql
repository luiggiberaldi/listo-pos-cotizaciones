CREATE OR REPLACE FUNCTION public.recalcularcomisiondespacho_238b(p_despachoid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing UUID;
  v_result UUID;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  -- Lock de todas las filas del despacho
  PERFORM c.id FROM public.comisiones c
  WHERE c.despachoid = p_despachoid
  FOR UPDATE;

  -- Filas legacy (≠ 238b): se conservan sin tocar
  IF EXISTS (
    SELECT 1 FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
      AND c.calculo_version IS DISTINCT FROM '238b'
  ) THEN
    SELECT c.id INTO v_existing
    FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
    ORDER BY c.creadoen
    LIMIT 1;
    RETURN v_existing;
  END IF;

  -- G3: alguna fila pagada o con pagos parciales → no se recalcula
  IF EXISTS (
    SELECT 1 FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
      AND (c.estado = 'pagada' OR COALESCE(c.montopagado, 0) > 0.01)
  ) THEN
    SELECT c.id INTO v_existing
    FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
    ORDER BY c.creadoen
    LIMIT 1;
    RETURN v_existing;
  END IF;

  DELETE FROM public.comisiones WHERE despachoid = p_despachoid;
  v_result := public.calcularcomisiondespacho_238b(p_despachoid);
  RETURN v_result;
END
$function$
