-- 276_rollback.sql — Revierte la migración 241 (inicio por rol + sesiones de operador) en STAGING.
-- Generado desde el estado previo capturado en outputs/auditoria-inicio-roles/staging-241/.
-- Elimina operator_sessions (datos efímeros de sesión) y restaura funciones, grants y policies previas.
-- No modifica ventas, comisiones, clientes, usuarios ni credenciales.
BEGIN;

-- 1. Policies restrictivas/agregadas por 241.
DROP POLICY IF EXISTS dashboard_scope_select ON public.notas_despacho;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.notas_despacho;
DROP POLICY IF EXISTS dashboard_scope_select ON public.cotizaciones;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.cotizaciones;
DROP POLICY IF EXISTS dashboard_scope_select ON public.notas_despacho_items;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.notas_despacho_items;
DROP POLICY IF EXISTS dashboard_scope_select ON public.cotizacion_items;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.cotizacion_items;
DROP POLICY IF EXISTS dashboard_scope_select ON public.comisiones;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.comisiones;
DROP POLICY IF EXISTS dashboard_scope_select ON public.comision_liberaciones;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.comision_liberaciones;
DROP POLICY IF EXISTS dashboard_scope_select ON public.clientes;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.clientes;
DROP POLICY IF EXISTS dashboard_scope_select ON public.cuentas_por_cobrar;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.cuentas_por_cobrar;
DROP POLICY IF EXISTS dashboard_scope_select ON public.productos;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.productos;
DROP POLICY IF EXISTS dashboard_scope_select ON public.usuarios;
DROP POLICY IF EXISTS dashboard_scope_allow ON public.usuarios;

-- 2. Restaurar definiciones previas de funciones (capturadas antes de aplicar 241).

-- get_operador_id
CREATE OR REPLACE FUNCTION public.get_operador_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (auth.jwt()->'app_metadata'->>'operator_id')::uuid;
$function$;

-- get_rol_actual
CREATE OR REPLACE FUNCTION public.get_rol_actual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(
           auth.jwt()->'app_metadata'->>'operator_rol',
           (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
         ) = 'desarrollador'
    THEN 'supervisor'
    ELSE COALESCE(
           auth.jwt()->'app_metadata'->>'operator_rol',
           (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
         )
  END;
$function$;

-- El comportamiento previo era ejecutable por PUBLIC (valor por defecto de las funciones).
REVOKE ALL ON FUNCTION public.get_operador_id(), public.get_rol_actual() FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_operador_id(), public.get_rol_actual() TO PUBLIC;

-- 3. Restaurar EXECUTE de los RPCs legacy de resumen (241 los restringió a service_role).
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'obtener_resumen_comisiones'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, postgres', f.sig);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'obtener_resumen_comisiones_v2'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres', f.sig);
  END LOOP;
END;
$$;

-- 4. Restaurar grants de tabla sobre usuarios (241 quitó SELECT de tabla a authenticated/anon
--    y lo reemplazó por columnas seguras; el estado previo concedía la tabla completa,
--    incluyendo pin_hash/pin_salt, requerido por el PIN local del código antiguo).
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.usuarios TO anon, authenticated, postgres;

-- 5. Eliminar objetos nuevos de 241.
DROP FUNCTION IF EXISTS public.can_read_seller(UUID);
DROP FUNCTION IF EXISTS public.current_operator_context();
DROP TABLE IF EXISTS public.operator_sessions;

NOTIFY pgrst, 'reload schema';
COMMIT;
