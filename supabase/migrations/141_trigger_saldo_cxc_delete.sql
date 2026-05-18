-- 141_trigger_saldo_cxc_delete.sql
-- Fix: el trigger trg_sync_saldo_pendiente solo disparaba en INSERT.
-- Extenderlo para que también recalcule al hacer DELETE o UPDATE en cuentas_por_cobrar.

DROP TRIGGER IF EXISTS trg_sync_saldo_pendiente ON public.cuentas_por_cobrar;
DROP TRIGGER IF EXISTS trg_sync_saldo_pendiente_delete ON public.cuentas_por_cobrar;
DROP TRIGGER IF EXISTS trg_sync_saldo_pendiente_update ON public.cuentas_por_cobrar;

-- Función unificada: usa NEW si existe, sino OLD (para DELETE)
CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_cliente_id UUID;
  v_saldo_real NUMERIC(12,4);
BEGIN
  -- En DELETE, NEW es null; usamos OLD
  v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);

  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = v_cliente_id;

  v_saldo_real := GREATEST(0, v_saldo_real);

  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real
  WHERE id = v_cliente_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger para INSERT y UPDATE
CREATE TRIGGER trg_sync_saldo_pendiente
  AFTER INSERT OR UPDATE ON public.cuentas_por_cobrar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recalcular_saldo_pendiente();

-- Trigger separado para DELETE (AFTER DELETE no tiene NEW, necesita manejo especial)
CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente_delete()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_real NUMERIC(12,4);
BEGIN
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = OLD.cliente_id;

  v_saldo_real := GREATEST(0, v_saldo_real);

  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real
  WHERE id = OLD.cliente_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_sync_saldo_pendiente_delete
  AFTER DELETE ON public.cuentas_por_cobrar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recalcular_saldo_pendiente_delete();
