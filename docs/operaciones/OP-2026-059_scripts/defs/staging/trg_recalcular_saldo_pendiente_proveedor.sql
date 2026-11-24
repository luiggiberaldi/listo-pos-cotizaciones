CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente_proveedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_real NUMERIC(12,4);
BEGIN
  -- Recalcular saldo sumando cargos (deudas) y restando abonos (pagos)
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_pagar
  WHERE proveedor_id = NEW.proveedor_id;

  -- Asegurar que no quede negativo
  v_saldo_real := GREATEST(0, v_saldo_real);

  -- Actualizar saldo_pendiente en proveedores
  UPDATE public.proveedores
  SET saldo_pendiente = v_saldo_real
  WHERE id = NEW.proveedor_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN NEW;
END;
$function$
