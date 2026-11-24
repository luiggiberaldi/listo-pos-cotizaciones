-- 306_edicion_profunda_cxc_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Reversa de 306_edicion_profunda_cxc.sql (adaptada de 305_staging_edicion_profunda_cxc_rollback.sql).
-- Reversa de 305 
drop function if exists public.editar_despacho_profundidad_con_cxc(uuid, jsonb, uuid, text, text, text, text);
drop function if exists public.cxc_num(text);

notify pgrst, 'reload schema';
