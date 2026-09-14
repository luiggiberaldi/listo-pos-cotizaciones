-- 275_rollback.sql — Rollback del release 15 (staging).
-- Byte-idéntico en efectos inversos: elimina la RPC de reversión. No toca datos.
BEGIN;
DROP FUNCTION IF EXISTS public.revertir_movimiento_inventario_atomico(UUID,UUID,UUID,UUID,TEXT,UUID);
COMMIT;
