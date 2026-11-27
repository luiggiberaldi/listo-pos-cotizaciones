-- 301_staging_cxc_abono_clave_unica.sql
-- OP-2026-049 (G4) — Un abono no puede guardarse dos veces con la misma clave de operación.
-- La ficha manda una clave única por intento de abono. Si llegan dos envíos iguales
-- (doble clic, reintento por mala conexión), la base acepta solo el primero; el
-- servidor devuelve ese mismo abono al segundo en vez de crear otro.
-- Solo STAGING. Reversa: 301_staging_cxc_abono_clave_unica_rollback.sql

alter table public.cuentas_por_cobrar
  add column if not exists idempotency_key text;

comment on column public.cuentas_por_cobrar.idempotency_key is
  'OP-2026-049: clave única de la operación que creó el movimiento (evita abonos duplicados por doble clic o reintento).';

create unique index if not exists ux_cxc_cuenta_idempotency_key
  on public.cuentas_por_cobrar (cuenta_id, idempotency_key)
  where idempotency_key is not null;
