-- ============================================================================
-- 322_auditoria_sello_resumen_archivo_fase5_rollback.sql
-- Reversión exacta de 322_auditoria_sello_resumen_archivo_fase5.sql (OP-2026-110)
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS auditoria_supervisor_select ON public.auditoria;
CREATE POLICY auditoria_supervisor_select ON public.auditoria
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

DROP FUNCTION IF EXISTS public.archivar_auditoria_antigua(INTEGER);
DROP FUNCTION IF EXISTS public.obtener_resumen_auditoria(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.verificar_cadena_auditoria(INTEGER);

DROP TRIGGER IF EXISTS trg_auditoria_cambios_sello ON public.auditoria_cambios;
DROP FUNCTION IF EXISTS public.calcular_sello_auditoria_cambios();

ALTER TABLE public.auditoria_cambios
  DROP COLUMN IF EXISTS hash_anterior,
  DROP COLUMN IF EXISTS hash_actual;

COMMIT;
