-- Rollback del release 11 — elimina la columna notas_titulo.
-- ⚠️ Descarta títulos personalizados (la UI/PDF cae al default 'nota' por código).
ALTER TABLE public.notas_despacho DROP COLUMN IF EXISTS notas_titulo;

NOTIFY pgrst, 'reload schema';
