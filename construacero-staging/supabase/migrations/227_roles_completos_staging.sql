-- 227_roles_completos_staging.sql
-- El constraint histórico quedó sin vendedor_sin_comision aunque la aplicación
-- y sus funciones de comisiones ya soportan ese rol.
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN (
    'supervisor',
    'vendedor',
    'vendedor_sin_comision',
    'administracion',
    'logistica',
    'desarrollador',
    'jefe'
  ));
