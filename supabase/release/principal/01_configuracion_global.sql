-- 01_configuracion_global.sql
-- Puente inteligente para el esquema parcial del proyecto principal.
-- Debe ejecutarse dentro de la transacción abierta por apply.sql.
-- No sobrescribe valores no nulos ya aprobados por una cuenta.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS permitir_stock_negativo BOOLEAN;

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_tipo_calculo TEXT;

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_pct_comision NUMERIC(5,2);

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_tarifa_fija_usd NUMERIC(12,4);

-- Solo completa columnas nuevas o valores realmente ausentes.
UPDATE public.configuracion_negocio
SET permitir_stock_negativo = false
WHERE permitir_stock_negativo IS NULL;

UPDATE public.configuracion_negocio
SET transp_tipo_calculo = 'porcentaje'
WHERE transp_tipo_calculo IS NULL
   OR btrim(transp_tipo_calculo) = '';

UPDATE public.configuracion_negocio
SET transp_pct_comision = 20
WHERE transp_pct_comision IS NULL;

UPDATE public.configuracion_negocio
SET transp_tarifa_fija_usd = 50
WHERE transp_tarifa_fija_usd IS NULL;

ALTER TABLE public.configuracion_negocio
  ALTER COLUMN permitir_stock_negativo SET DEFAULT false,
  ALTER COLUMN transp_tipo_calculo SET DEFAULT 'porcentaje',
  ALTER COLUMN transp_pct_comision SET DEFAULT 20,
  ALTER COLUMN transp_tarifa_fija_usd SET DEFAULT 50;

ALTER TABLE public.configuracion_negocio
  ALTER COLUMN permitir_stock_negativo SET NOT NULL,
  ALTER COLUMN transp_tipo_calculo SET NOT NULL,
  ALTER COLUMN transp_pct_comision SET NOT NULL,
  ALTER COLUMN transp_tarifa_fija_usd SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
    WHERE transp_tipo_calculo NOT IN ('porcentaje', 'fija')
       OR transp_pct_comision < 0
       OR transp_pct_comision > 100
       OR transp_tarifa_fija_usd < 0
  ) THEN
    RAISE EXCEPTION 'CONFIG_CHOFERES_INVALIDA: hay valores globales fuera de rango';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.configuracion_negocio'::regclass
      AND contype = 'c'
      AND (
        conname = 'ck_configuracion_negocio_transp_tipo_calculo'
        OR pg_get_constraintdef(oid) ILIKE '%transp_tipo_calculo%'
      )
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT ck_configuracion_negocio_transp_tipo_calculo
      CHECK (transp_tipo_calculo IN ('porcentaje', 'fija'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.configuracion_negocio'::regclass
      AND contype = 'c'
      AND (
        conname = 'ck_configuracion_negocio_transp_pct_comision'
        OR pg_get_constraintdef(oid) ILIKE '%transp_pct_comision%'
      )
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT ck_configuracion_negocio_transp_pct_comision
      CHECK (transp_pct_comision >= 0 AND transp_pct_comision <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.configuracion_negocio'::regclass
      AND contype = 'c'
      AND (
        conname = 'ck_configuracion_negocio_transp_tarifa_fija_usd'
        OR pg_get_constraintdef(oid) ILIKE '%transp_tarifa_fija_usd%'
      )
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT ck_configuracion_negocio_transp_tarifa_fija_usd
      CHECK (transp_tarifa_fija_usd >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.configuracion_negocio.permitir_stock_negativo IS
  'Permite venta anticipada/stock negativo únicamente cuando la cuenta lo habilita explícitamente.';

COMMENT ON COLUMN public.configuracion_negocio.transp_tipo_calculo IS
  'Regla global por cuenta para choferes locales: porcentaje o tarifa fija.';

COMMENT ON COLUMN public.configuracion_negocio.transp_pct_comision IS
  'Porcentaje global de fábrica: 20. Solo aplica cuando transp_tipo_calculo = porcentaje.';

COMMENT ON COLUMN public.configuracion_negocio.transp_tarifa_fija_usd IS
  'Tarifa fija global de fábrica: 50 USD. Solo aplica cuando transp_tipo_calculo = fija.';
