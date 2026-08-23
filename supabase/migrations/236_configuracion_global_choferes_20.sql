-- 236_configuracion_global_choferes_20.sql
-- Puente de compatibilidad: configuración global por cuenta para choferes locales.
--
-- El proyecto principal ya tiene una aplicación parcial de la variante 206
-- (es_local y snapshots base), pero no tiene las columnas transp_*.
-- Esta migración completa únicamente esa parte del esquema. NO se ejecuta
-- desde el checkout actual: requiere paquete limpio, preflight SQL,
-- backup/rollback y autorización explícita.
--
-- Decisión de negocio:
--   * regla de fábrica: porcentaje
--   * porcentaje de fábrica: 20%
--   * los campos tipo_calculo/pct_comision/tarifa_fija_usd de transportistas
--     quedan como legado/metadata y no participan en el cálculo canónico.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_tipo_calculo TEXT NOT NULL DEFAULT 'porcentaje'
    CHECK (transp_tipo_calculo IN ('porcentaje', 'fija')),
  ADD COLUMN IF NOT EXISTS transp_pct_comision NUMERIC(5,2) NOT NULL DEFAULT 20
    CHECK (transp_pct_comision >= 0 AND transp_pct_comision <= 100),
  ADD COLUMN IF NOT EXISTS transp_tarifa_fija_usd NUMERIC(12,4) NOT NULL DEFAULT 50
    CHECK (transp_tarifa_fija_usd >= 0);

-- Asegurar que nuevas filas usen el valor de fábrica aprobado.
ALTER TABLE public.configuracion_negocio
  ALTER COLUMN transp_tipo_calculo SET DEFAULT 'porcentaje',
  ALTER COLUMN transp_pct_comision SET DEFAULT 20,
  ALTER COLUMN transp_tarifa_fija_usd SET DEFAULT 50;

-- Compatibilidad con una aplicación parcial previa: solo completar valores
-- nulos; no sobrescribir una configuración no nula aprobada por una cuenta.
-- En el estado verificado del proyecto principal las columnas aún no existen,
-- por lo que sus DEFAULT inicializan también la cuenta principal en 20%.
UPDATE public.configuracion_negocio
SET transp_tipo_calculo = COALESCE(NULLIF(trim(transp_tipo_calculo), ''), 'porcentaje'),
    transp_pct_comision = COALESCE(transp_pct_comision, 20),
    transp_tarifa_fija_usd = COALESCE(transp_tarifa_fija_usd, 50)
WHERE transp_tipo_calculo IS NULL
   OR trim(transp_tipo_calculo) = ''
   OR transp_pct_comision IS NULL
   OR transp_tarifa_fija_usd IS NULL;

COMMENT ON COLUMN public.configuracion_negocio.transp_tipo_calculo
  IS 'Regla global por cuenta para choferes locales: porcentaje o tarifa fija.';
COMMENT ON COLUMN public.configuracion_negocio.transp_pct_comision
  IS 'Porcentaje global de fábrica: 20. Solo aplica cuando transp_tipo_calculo = porcentaje.';
COMMENT ON COLUMN public.configuracion_negocio.transp_tarifa_fija_usd
  IS 'Tarifa fija global opcional. Solo aplica cuando transp_tipo_calculo = fija.';

-- Preflight posterior obligatorio antes de habilitar el código:
-- SELECT cuenta_id, transp_tipo_calculo, transp_pct_comision,
--        transp_tarifa_fija_usd
-- FROM public.configuracion_negocio
-- ORDER BY cuenta_id;
--
-- Para la cuenta principal, el postflight obligatorio debe confirmar:
-- transp_tipo_calculo = 'porcentaje' y transp_pct_comision = 20.
-- Si el preflight detecta valores globales preexistentes distintos, detenerse
-- y solicitar una decisión explícita; no sobrescribirlos automáticamente.
