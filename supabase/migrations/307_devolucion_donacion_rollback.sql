-- 307_devolucion_donacion_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Reversa de 307_devolucion_donacion.sql (adaptada de 306_staging_devolucion_donacion_rollback.sql).
-- Reversa de 306 
drop function if exists public.devolucion_con_donacion(uuid, uuid, uuid, jsonb, jsonb, text, uuid, text, text, numeric, numeric, jsonb, jsonb, text, jsonb, uuid, text, numeric, numeric, numeric, boolean, text);
drop function if exists public.cxc_restar_donacion_fp(text, numeric);

notify pgrst, 'reload schema';
