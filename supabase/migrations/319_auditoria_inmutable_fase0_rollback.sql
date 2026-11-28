-- ============================================================================
-- 319_auditoria_inmutable_fase0_rollback.sql
-- Reversión exacta de 319_auditoria_inmutable_fase0.sql (OP-2026-109)
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON public.auditoria;
DROP FUNCTION IF EXISTS public.proteger_auditoria_inmutable();

DROP POLICY IF EXISTS auditoria_jefe_select ON public.auditoria;
DROP POLICY IF EXISTS auditoria_jefe_all ON public.auditoria;

CREATE POLICY auditoria_jefe_all ON public.auditoria
  FOR ALL
  USING (public.get_rol_actual() = 'jefe')
  WITH CHECK (public.get_rol_actual() = 'jefe');

COMMIT;
