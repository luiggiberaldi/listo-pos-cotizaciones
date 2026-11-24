-- 308_cxc_nada_se_borra_sin_rastro_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Reversa de 308_cxc_nada_se_borra_sin_rastro.sql (adaptada de 307_staging_cxc_nada_se_borra_sin_rastro_rollback.sql).
-- Reversa de 307 . OJO: borrar la tabla elimina el archivo de movimientos borrados;
-- exportarla antes si tiene datos que interesen.
drop function if exists public.cxc_anular_movimiento(uuid, uuid, uuid, text, text, text);
drop trigger if exists trg_archivar_cxc_borrado on public.cuentas_por_cobrar;
drop function if exists public.trg_archivar_cxc_borrado();
drop table if exists public.cxc_movimientos_borrados;

notify pgrst, 'reload schema';
