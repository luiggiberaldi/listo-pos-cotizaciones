-- ═════════════════════════════════════════════════════════════════════════════
-- 08_bloqueo_stock_aprobacion_rollback_review.sql
-- Rollback del release 08 (bloqueo de stock al aprobar).
--
-- Escalones (usar el menor suficiente):
--   1. Toggle OFF por cuenta  → comportamiento legacy inmediato (recomendado).
--   2. DROP de la RPC         → el Worker vuelve a la ruta legacy en caliente
--                               (la llamada falla con 404 y responde legacy? NO:
--                               el Worker actual devolvería error. Por eso el
--                               rollback SQL requiere deploy del Worker previo
--                               o simultáneo si se llega a este escalón).
--   La columna del toggle se PRESERVA (harmless, default FALSE) para no perder
--   configuración por cuenta; su eliminación es opcional y manual.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Escalón 1: toggle OFF global (instantáneo, sin deploy) ───────────────────
UPDATE public.configuracion_negocio
SET bloqueo_stock_aprobacion = FALSE
WHERE bloqueo_stock_aprobacion IS DISTINCT FROM FALSE;

-- ── Escalón 2: eliminar la RPC (requiere que el Worker ya no la llame) ───────
-- DROP FUNCTION IF EXISTS public.aprobar_despacho_inventario_atomico(UUID, UUID, TEXT, TEXT);

-- Verificación
SELECT
  COUNT(*) FILTER (WHERE bloqueo_stock_aprobacion) AS cuentas_con_toggle_on,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='aprobar_despacho_inventario_atomico') AS rpc_existe
FROM public.configuracion_negocio;
