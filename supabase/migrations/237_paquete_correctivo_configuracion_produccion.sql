-- 237_paquete_correctivo_configuracion_produccion.sql
-- Paquete correctivo manual para el proyecto principal.
--
-- ALCANCE:
--   * Agrega configuracion_negocio.permitir_stock_negativo con false.
--   * Agrega la configuración global de choferes locales:
--       transp_tipo_calculo    = porcentaje
--       transp_pct_comision    = 20
--       transp_tarifa_fija_usd = 50
--   * Valida tenant, unicidad y valores antes de confirmar.
--
-- NO INCLUYE:
--   * 233_unificar_rpc_productos.sql
--   * 234_tester_cleanup_tenant_safe.sql (Tester exclusivo de staging)
--   * 235_comision_flete_fuera_carabobo.sql
--   * backfill de despachos, comisiones o pagos
--   * cambios en transportistas, pagos_transportistas o notas_despacho
--
-- EJECUCIÓN:
--   1. Confirmar backup/PITR de producción.
--   2. Ejecutar este archivo completo manualmente en el proyecto principal.
--   3. No usar `supabase db push` contra este checkout para promoverlo.
--   4. Si una validación falla antes de COMMIT, ejecutar ROLLBACK y detenerse.
--
-- La aplicación verificada antes de preparar este paquete mostró 13 filas de
-- configuración, sin columnas transp_* ni permitir_stock_negativo. Por eso los
-- valores de fábrica se inicializan de forma determinista en esas filas.

BEGIN;

-- ── 1. Preflight bloqueante ──────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.configuracion_negocio') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_CONFIGURACION_FALTANTE: no existe public.configuracion_negocio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'configuracion_negocio'
      AND column_name = 'cuenta_id'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_TENANT_FALTANTE: configuracion_negocio.cuenta_id no existe';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.configuracion_negocio) THEN
    RAISE EXCEPTION 'PRECONDICION_CONFIGURACION_VACIA: no existe ninguna fila de configuración';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
    WHERE cuenta_id IS NULL
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_CUENTA_NULA: toda configuración debe pertenecer a una cuenta';
  END IF;

  IF EXISTS (
    SELECT cuenta_id
    FROM public.configuracion_negocio
    GROUP BY cuenta_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_CUENTA_DUPLICADA: existe más de una configuración por cuenta';
  END IF;
END
$$;

-- ── 2. Agregar columnas sin asumir que una aplicación parcial está completa ──
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS permitir_stock_negativo BOOLEAN;

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_tipo_calculo TEXT;

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_pct_comision NUMERIC(5,2);

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_tarifa_fija_usd NUMERIC(12,4);

-- ── 3. Completar únicamente valores nulos o vacíos ───────────────────────────
-- No se sobrescribe una configuración no nula que pudiera haber sido aprobada
-- manualmente en una ejecución futura. En el preflight actual todas estas
-- columnas faltaban, por lo que las 13 filas reciben los valores de fábrica.
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

-- ── 4. Defaults y restricciones ──────────────────────────────────────────────
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
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.configuracion_negocio'::regclass
      AND conname = 'ck_configuracion_negocio_transp_tipo_calculo'
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT ck_configuracion_negocio_transp_tipo_calculo
      CHECK (transp_tipo_calculo IN ('porcentaje', 'fija'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.configuracion_negocio'::regclass
      AND conname = 'ck_configuracion_negocio_transp_pct_comision'
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT ck_configuracion_negocio_transp_pct_comision
      CHECK (transp_pct_comision >= 0 AND transp_pct_comision <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.configuracion_negocio'::regclass
      AND conname = 'ck_configuracion_negocio_transp_tarifa_fija_usd'
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT ck_configuracion_negocio_transp_tarifa_fija_usd
      CHECK (transp_tarifa_fija_usd >= 0);
  END IF;
END
$$;

-- ── 5. Postflight bloqueante dentro de la misma transacción ──────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
    WHERE permitir_stock_negativo IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_STOCK_NEGATIVO_NO_DEFAULT: se esperaba false en todas las filas iniciales';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
    WHERE transp_tipo_calculo IS DISTINCT FROM 'porcentaje'
       OR transp_pct_comision IS DISTINCT FROM 20::numeric
       OR transp_tarifa_fija_usd IS DISTINCT FROM 50::numeric
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_CONFIG_CHOFERES_NO_FACTORY: se esperaba porcentaje=20 y tarifa=50 en la configuración inicial';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'configuracion_negocio'
      AND column_name IN (
        'permitir_stock_negativo',
        'transp_tipo_calculo',
        'transp_pct_comision',
        'transp_tarifa_fija_usd'
      )
      AND is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_COLUMNAS_NULLABLES: las columnas correctivas deben ser NOT NULL';
  END IF;
END
$$;

COMMENT ON COLUMN public.configuracion_negocio.permitir_stock_negativo IS
  'Permite venta anticipada/stock negativo únicamente cuando la cuenta lo habilita explícitamente.';

COMMENT ON COLUMN public.configuracion_negocio.transp_tipo_calculo IS
  'Regla global por cuenta para choferes locales: porcentaje o tarifa fija.';

COMMENT ON COLUMN public.configuracion_negocio.transp_pct_comision IS
  'Porcentaje global de fábrica del flete para choferes locales: 20%. Solo aplica cuando transp_tipo_calculo = porcentaje.';

COMMENT ON COLUMN public.configuracion_negocio.transp_tarifa_fija_usd IS
  'Tarifa fija global de fábrica para choferes locales: 50 USD. Solo aplica cuando transp_tipo_calculo = fija.';

-- Recargar el catálogo de PostgREST al confirmar el DDL.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── 6. Postflight informativo posterior al COMMIT ────────────────────────────
SELECT cuenta_id,
       permitir_stock_negativo,
       transp_tipo_calculo,
       transp_pct_comision,
       transp_tarifa_fija_usd
FROM public.configuracion_negocio
ORDER BY cuenta_id;

-- ROLLBACK:
--   Si falla una validación antes de COMMIT, no se debe continuar. Ejecutar
--   ROLLBACK en la sesión si el editor dejó la transacción abierta.
--
--   Después de COMMIT no se deben eliminar automáticamente estas columnas:
--   la aplicación podría empezar a escribir valores. El rollback recomendado
--   para este paquete es conservar el esquema y detener la promoción de 233/235.
--   Solo un DBA, después de confirmar que no hay consumidores ni datos nuevos,
--   podría diseñar una reversa destructiva de columnas y restricciones.
