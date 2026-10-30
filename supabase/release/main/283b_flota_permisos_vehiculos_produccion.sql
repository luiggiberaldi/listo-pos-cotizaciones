-- 283b_flota_permisos_vehiculos_produccion.sql — corrección posterior al apply 283 (PRODUCCIÓN).
-- Hallazgo del postflight 2026-10-30: en producción Supabase da por defecto todos los
-- permisos de tabla a anon/authenticated, y la política isolation_vehiculos es FOR ALL.
-- Resultado: el navegador podía crear/editar/borrar camiones de su cuenta sin pasar por
-- el Worker (raíl R2: solo el Worker escribe). Staging no tenía esos permisos por defecto.
-- Esta corrección SOLO QUITA permisos; el Worker (service_role) no se ve afectado y el
-- navegador conserva la lectura de los camiones de su propia cuenta.
-- Reversa (no recomendada): GRANT INSERT, UPDATE, DELETE ON public.vehiculos TO authenticated;

BEGIN;

REVOKE ALL ON public.vehiculos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehiculos FROM authenticated;
GRANT SELECT ON public.vehiculos TO authenticated;
-- Las políticas quedan iguales a staging: sin el permiso de tabla, la política FOR ALL
-- ya no habilita escrituras desde el navegador.

COMMIT;
