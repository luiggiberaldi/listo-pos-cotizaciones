-- 275_rollback.sql — Rollback del release 15 (PRINCIPAL).
-- Elimina la RPC de reversión. No toca datos.
BEGIN;
DROP FUNCTION IF EXISTS public.revertir_movimiento_inventario_atomico(UUID,UUID,UUID,TEXT,TEXT,UUID);
COMMIT;
