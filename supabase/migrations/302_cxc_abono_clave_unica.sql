-- 302_cxc_abono_clave_unica.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)
-- OP-2026-059: versión para producción de la migración de staging 301_staging_cxc_abono_clave_unica.sql (OP-2026-049).
-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de
-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: 302_cxc_abono_clave_unica_rollback.sql
--
-- Agrega la columna idempotency_key (vacía en las filas viejas) y un índice único parcial.
-- En producción la tabla tiene ~miles de filas: el índice se crea rápido; bloquea escrituras
-- de cuentas_por_cobrar solo mientras se construye (segundos).
--
-- ── Texto de staging, adaptado (nombres sin "_staging") ──

begin;
-- OP-2026-049 (G4) — Un abono no puede guardarse dos veces con la misma clave de operación.
-- La ficha manda una clave única por intento de abono. Si llegan dos envíos iguales
-- (doble clic, reintento por mala conexión), la base acepta solo el primero; el
-- servidor devuelve ese mismo abono al segundo en vez de crear otro.
-- Reversa: 301_staging_cxc_abono_clave_unica_rollback.sql

alter table public.cuentas_por_cobrar
  add column if not exists idempotency_key text;

comment on column public.cuentas_por_cobrar.idempotency_key is
  'OP-2026-049: clave única de la operación que creó el movimiento (evita abonos duplicados por doble clic o reintento).';

create unique index if not exists ux_cxc_cuenta_idempotency_key
  on public.cuentas_por_cobrar (cuenta_id, idempotency_key)
  where idempotency_key is not null;

notify pgrst, 'reload schema';

commit;
