-- 243_staging_config_stock_negativo_compat.sql
-- Compatibilidad mínima y reversible para el E2E de staging.
--
-- No aplica 205 completo porque la base staging actual conserva la RPC canónica
-- de productos con 16 parámetros y un enum motivo_movimiento que no contiene
-- venta_anticipada. Reaplicar 205 completo crearía un overload histórico y
-- podría fallar al reemplazar el contrato vigente.
--
-- Esta migración solo agrega la bandera que leen las RPC atómicas de entrega.
-- El valor seguro por defecto es FALSE; no modifica stock, Kardex, secuencias,
-- correlativos, pagos ni datos comerciales.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.configuracion_negocio') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_CONFIGURACION_NEGOCIO_FALTANTE';
  END IF;
END
$$;

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS permitir_stock_negativo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.configuracion_negocio.permitir_stock_negativo IS
  'Permite venta anticipada únicamente cuando se habilita explícitamente por cuenta; por defecto permanece desactivado.';

NOTIFY pgrst, 'reload schema';

COMMIT;
