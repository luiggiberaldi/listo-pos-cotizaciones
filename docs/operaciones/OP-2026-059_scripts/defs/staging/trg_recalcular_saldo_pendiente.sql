CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente_id UUID;
  v_saldo_real NUMERIC(12,4);
  v_saldo_favor NUMERIC(12,4);
BEGIN
  v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);

  -- Recalcular saldo_pendiente (cargos - abonos; consumo_credito no altera deuda)
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd WHEN tipo = 'abono' THEN -monto_usd ELSE 0 END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = v_cliente_id;

  v_saldo_real := GREATEST(0, v_saldo_real);

  -- Recalcular saldo_a_favor (creditos - abonos por saldo a favor - devoluciones - consumos)
  SELECT COALESCE(
    SUM(
      CASE
        WHEN tipo = 'credito' THEN monto_usd
        WHEN tipo = 'abono' AND forma_pago_abono = 'Saldo a favor' THEN -monto_usd
        WHEN tipo = 'devolucion_credito' THEN -monto_usd
        WHEN tipo = 'consumo_credito' THEN -monto_usd
        ELSE 0
      END
    ),
    0
  )
  INTO v_saldo_favor
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = v_cliente_id;

  v_saldo_favor := GREATEST(0, v_saldo_favor);

  -- Actualizar cliente
  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real,
      saldo_a_favor = v_saldo_favor
  WHERE id = v_cliente_id
    AND (saldo_pendiente IS DISTINCT FROM v_saldo_real OR saldo_a_favor IS DISTINCT FROM v_saldo_favor);

  RETURN COALESCE(NEW, OLD);
END;
$function$
