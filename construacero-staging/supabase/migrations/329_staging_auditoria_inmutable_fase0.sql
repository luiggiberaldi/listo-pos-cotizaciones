-- ============================================================================
-- 329_staging_auditoria_inmutable_fase0.sql
-- OP-2026-109 (Auditoría 2.0 — Fase 0 en staging, basado en OP-2026-066 y OP-2026-108)
-- ============================================================================

BEGIN;

-- 1. Reemplazar política omnipotente de jefe por solo lectura
DROP POLICY IF EXISTS auditoria_jefe_all ON public.auditoria;
DROP POLICY IF EXISTS auditoria_jefe_select ON public.auditoria;

CREATE POLICY auditoria_jefe_select ON public.auditoria
  FOR SELECT
  USING (public.get_rol_actual() = 'jefe');

-- 2. Defensa en profundidad en permisos SQL para clientes web
REVOKE UPDATE, DELETE ON public.auditoria FROM anon, authenticated;

-- 3. Candado directo en tabla contra UPDATE y DELETE (incluso vía service_role)
CREATE OR REPLACE FUNCTION public.proteger_auditoria_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.permitir_limpieza_auditoria', true) = '1' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDITORIA_INMUTABLE: no se permite modificar ni borrar registros de auditoria'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_auditoria_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON public.auditoria;
CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON public.auditoria
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_auditoria_inmutable();

COMMIT;
