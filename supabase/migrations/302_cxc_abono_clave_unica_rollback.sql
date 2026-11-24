-- 302_cxc_abono_clave_unica_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Reversa de 302_cxc_abono_clave_unica.sql (adaptada de 301_staging_cxc_abono_clave_unica_rollback.sql).
-- Reversa de 301_staging_cxc_abono_clave_unica.sql (OP-2026-049). 
drop index if exists public.ux_cxc_cuenta_idempotency_key;
alter table public.cuentas_por_cobrar drop column if exists idempotency_key;

notify pgrst, 'reload schema';
