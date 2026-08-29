-- 258_staging_consumo_credito_cxc.sql
--
-- Plan: docs/plans/2026-08-28-plan-fixes-comisiones-saldo-favor-cod.md (Pieza 1)
-- Objetivo: tipo contable 'consumo_credito' para el uso de Saldo a Favor en
-- ventas nuevas (COD/credito). Elimina el doble descuento:
--   hoy: abono 'Saldo a favor' resta saldoReal Y saldoFavor
--        -> deuda COD queda COD-favor y el validador de conciliacion bloquea.
--   nuevo: consumo_credito resta SOLO saldoFavor; la deuda queda = COD exacto.
--
-- Semantica (coincide con api/lib/cxcUtils.js Pieza 2):
--   saldo_pendiente : cargo + monto, abono - monto (consumo_credito NO entra)
--   saldo_a_favor   : credito + monto, abono'Saldo a favor' - monto,
--                     devolucion_credito - monto, consumo_credito - monto
--
-- ADDITIVO/IDEMPOTENTE: DROP+ADD del CHECK y CREATE OR REPLACE de triggers.
-- No toca datos. Preflight verificado 2026-08-28 (tmp/db-dump-258/):
--   CHECK vigente = 179; tipos existentes: abono/cargo/credito/devolucion_credito;
--   cuerpos vivos de triggers identicos a migracion 179.

-- 1. Ampliar el CHECK de tipos
ALTER TABLE public.cuentas_por_cobrar
  DROP CONSTRAINT IF EXISTS cuentas_por_cobrar_tipo_check;
ALTER TABLE public.cuentas_por_cobrar
  ADD CONSTRAINT cuentas_por_cobrar_tipo_check
  CHECK (tipo IN ('cargo', 'abono', 'credito', 'devolucion_credito', 'consumo_credito'));

-- 2. Trigger de INSERT/UPDATE: recalcula ambos saldos incluyendo consumo_credito
CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
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
$$;

-- 3. Trigger de DELETE: misma semantica
CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente_delete()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_real NUMERIC(12,4);
  v_saldo_favor NUMERIC(12,4);
BEGIN
  -- Recalcular saldo_pendiente (cargos - abonos; consumo_credito no altera deuda)
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd WHEN tipo = 'abono' THEN -monto_usd ELSE 0 END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = OLD.cliente_id;

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
  WHERE cliente_id = OLD.cliente_id;

  v_saldo_favor := GREATEST(0, v_saldo_favor);

  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real,
      saldo_a_favor = v_saldo_favor
  WHERE id = OLD.cliente_id
    AND (saldo_pendiente IS DISTINCT FROM v_saldo_real OR saldo_a_favor IS DISTINCT FROM v_saldo_favor);

  RETURN OLD;
END;
$$;

-- 4. Recargar schema cache de PostgREST (convencion del repo)
NOTIFY pgrst, 'reload schema';
