-- Reversa de 301_staging_cxc_abono_clave_unica.sql (OP-2026-049). Solo STAGING.
drop index if exists public.ux_cxc_cuenta_idempotency_key;
alter table public.cuentas_por_cobrar drop column if exists idempotency_key;
