-- 304_cxc_saldo_favor_atomico_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Reversa de 304_cxc_saldo_favor_atomico.sql (adaptada de 303_staging_cxc_saldo_favor_atomico_rollback.sql).
-- Reversa de 303 : quita la función de saldo a favor en un solo paso.
drop function if exists public.cxc_saldo_favor_atomico(text, uuid, numeric, text, text, text, uuid, text, text, text, boolean, text);

notify pgrst, 'reload schema';
