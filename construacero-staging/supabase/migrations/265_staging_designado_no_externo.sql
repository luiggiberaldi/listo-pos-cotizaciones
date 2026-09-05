-- 265_staging_designado_no_externo.sql
-- Fix P0 portado al principal: el designado NO puede ser un vendedor EXTERNO.
-- Los externos no participan del split de sábados (regla del negocio 2026-09-04).
-- Idempotente: CREATE OR REPLACE del trigger function (misma firma).

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger function v2: valida rol + activo + NO EXTERNO
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validar_designacion_diaria()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
  v_activo BOOLEAN;
  v_externo BOOLEAN;
BEGIN
  SELECT rol, activo, es_externo INTO v_rol, v_activo, v_externo
  FROM public.usuarios WHERE id = NEW.designado_id;
  IF NOT FOUND OR v_activo is not true
     OR v_externo IS TRUE
     OR v_rol NOT IN ('vendedor', 'supervisor') THEN
    RAISE EXCEPTION 'DESIGNADO_INVALIDO: solo vendedor o supervisor activos (no externos) pueden ser designados';
  END IF;
  RETURN NEW;
END;
$function$;

-- El trigger ya existe (260); CREATE OR REPLACE FUNCTION basta.
-- Sintaxis del script no transaccional — el applier lo ejecuta con su propio guardia.
