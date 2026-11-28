-- ============================================================================
-- 321_auditoria_portero_catalogo_fase2_rollback.sql
-- Reversión exacta de 321_auditoria_portero_catalogo_fase2.sql (OP-2026-110)
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.auditoria_catalogo;
DROP TABLE IF EXISTS public.auditoria_peticiones;

COMMIT;
