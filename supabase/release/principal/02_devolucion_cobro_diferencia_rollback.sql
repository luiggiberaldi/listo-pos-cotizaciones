-- 02_devolucion_cobro_diferencia_rollback.sql
-- Rollback de 02_devolucion_cobro_diferencia.sql (proyecto principal).
--
-- Solo elimina la función dedicada de 14 parámetros y los dos helpers nuevos.
-- La firma original de 13 parámetros de registrar_devolucion_parcial_idempotente
-- NO se toca y sigue operativa para el Worker actual.
--
-- Datos: los abonos "Cobro de diferencia en intercambio" creados por la
-- función nueva son filas válidas de cuentas_por_cobrar y NO se eliminan
-- aquí. Si fuera necesario revertir datos de una operación puntual,
-- hacerlo manualmente por idempotency_key/auditoría (sin TRUNCATE ni
-- restore completo) y recalcular los saldos del cliente afectado.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente(
  UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB
);
DROP FUNCTION IF EXISTS public.registrar_cobro_diferencia_devolucion(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB);
DROP FUNCTION IF EXISTS public.validar_pagos_diferencia_devolucion(UUID, UUID, NUMERIC, NUMERIC, JSONB);

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verificación post-rollback (debe devolver NULL):
-- SELECT to_regprocedure('public.registrar_devolucion_parcial_cobro_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB)');
-- SELECT to_regprocedure('public.registrar_devolucion_parcial_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB)'); -- debe seguir existiendo
