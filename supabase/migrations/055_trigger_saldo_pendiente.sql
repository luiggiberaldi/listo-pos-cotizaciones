-- 055_trigger_saldo_pendiente.sql
-- Trigger de seguridad: recalcula saldo_pendiente del cliente
-- después de cada INSERT en cuentas_por_cobrar, como respaldo
-- por si el RPC falla a medio camino o se inserta manualmente.

CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_real NUMERIC(12,4);
BEGIN
  -- Recalcular saldo sumando cargos y restando abonos
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = NEW.cliente_id;

  -- Asegurar que no quede negativo
  v_saldo_real := GREATEST(0, v_saldo_real);

  -- Actualizar solo si difiere (evitar escrituras innecesarias)
  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real
  WHERE id = NEW.cliente_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN NEW;
END;
$$;

-- Disparar después de cada inserción en cuentas_por_cobrar
DROP TRIGGER IF EXISTS trg_sync_saldo_pendiente ON public.cuentas_por_cobrar;
CREATE TRIGGER trg_sync_saldo_pendiente
  AFTER INSERT ON public.cuentas_por_cobrar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recalcular_saldo_pendiente();
