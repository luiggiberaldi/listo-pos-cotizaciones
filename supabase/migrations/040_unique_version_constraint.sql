-- 040_unique_version_constraint.sql
-- Prevent duplicate version numbers within a cotización chain.
-- Two concurrent crear_version_cotizacion calls could race and produce
-- the same version number; this constraint ensures one will fail cleanly.

CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_raiz_version
  ON public.cotizaciones (cotizacion_raiz_id, version)
  WHERE cotizacion_raiz_id IS NOT NULL;
