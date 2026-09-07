-- ════════════════════════════════════════════════════════════════════════════
-- RELEASE 11 — Título editable para la observación / nota de entrega
-- Espejo de la migración staging 271 (271_staging_notas_titulo.sql).
-- Fábrica: 'nota'. La guía PDF usa el valor como etiqueta del bloque.
-- Idempotente. Sin rollback de datos: la columna es aditiva.
-- Rollback: 11_rollback_review.sql (elimina la columna).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS notas_titulo text DEFAULT 'nota';

NOTIFY pgrst, 'reload schema';
