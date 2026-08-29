-- 04_consumo_credito_cxc.sql
-- RELEASE PREPARADO, NO APLICAR SIN BACKUP + PREFLIGHT.
-- Ver plan: docs/plans/2026-08-28-plan-fixes-comisiones-saldo-favor-cod.md
-- Este archivo debe reconciliarse con los cuerpos vivos del PRINCIPAL antes de ejecutar.

ALTER TABLE public.cuentas_por_cobrar
  DROP CONSTRAINT IF EXISTS cuentas_por_cobrar_tipo_check;
ALTER TABLE public.cuentas_por_cobrar
  ADD CONSTRAINT cuentas_por_cobrar_tipo_check
  CHECK (tipo IN ('cargo', 'abono', 'credito', 'devolucion_credito', 'consumo_credito'));

CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_cliente_id UUID;
  v_saldo_real NUMERIC(12,4);
  v_saldo_favor NUMERIC(12,4);
BEGIN
  v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);
  SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd WHEN tipo='abono' THEN -monto_usd ELSE 0 END),0)
    INTO v_saldo_real FROM public.cuentas_por_cobrar WHERE cliente_id=v_cliente_id;
  v_saldo_real := GREATEST(0, v_saldo_real);
  SELECT COALESCE(SUM(CASE
    WHEN tipo='credito' THEN monto_usd
    WHEN tipo='abono' AND forma_pago_abono='Saldo a favor' THEN -monto_usd
    WHEN tipo='devolucion_credito' THEN -monto_usd
    WHEN tipo='consumo_credito' THEN -monto_usd
    ELSE 0 END),0)
    INTO v_saldo_favor FROM public.cuentas_por_cobrar WHERE cliente_id=v_cliente_id;
  v_saldo_favor := GREATEST(0, v_saldo_favor);
  UPDATE public.clientes SET saldo_pendiente=v_saldo_real, saldo_a_favor=v_saldo_favor
    WHERE id=v_cliente_id AND (saldo_pendiente IS DISTINCT FROM v_saldo_real OR saldo_a_favor IS DISTINCT FROM v_saldo_favor);
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente_delete()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_saldo_real NUMERIC(12,4);
  v_saldo_favor NUMERIC(12,4);
BEGIN
  SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd WHEN tipo='abono' THEN -monto_usd ELSE 0 END),0)
    INTO v_saldo_real FROM public.cuentas_por_cobrar WHERE cliente_id=OLD.cliente_id;
  v_saldo_real := GREATEST(0, v_saldo_real);
  SELECT COALESCE(SUM(CASE
    WHEN tipo='credito' THEN monto_usd
    WHEN tipo='abono' AND forma_pago_abono='Saldo a favor' THEN -monto_usd
    WHEN tipo='devolucion_credito' THEN -monto_usd
    WHEN tipo='consumo_credito' THEN -monto_usd
    ELSE 0 END),0)
    INTO v_saldo_favor FROM public.cuentas_por_cobrar WHERE cliente_id=OLD.cliente_id;
  v_saldo_favor := GREATEST(0, v_saldo_favor);
  UPDATE public.clientes SET saldo_pendiente=v_saldo_real, saldo_a_favor=v_saldo_favor
    WHERE id=OLD.cliente_id AND (saldo_pendiente IS DISTINCT FROM v_saldo_real OR saldo_a_favor IS DISTINCT FROM v_saldo_favor);
  RETURN OLD;
END; $$;

NOTIFY pgrst, 'reload schema';
