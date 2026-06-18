-- 199_rls_comisiones_supervisores.sql
-- Ampliar política RLS de comisiones para que supervisores, jefes, admins
-- y desarrolladores puedan consultar TODAS las comisiones de su cuenta.
-- Esto permite que el buscador de Auditoría muestre las comisiones correctamente.

-- 1. Actualizar política de SELECT en public.comisiones
DROP POLICY IF EXISTS comisiones_vendedor_select ON public.comisiones;
CREATE POLICY comisiones_vendedor_select ON public.comisiones
  FOR SELECT
  USING (
    -- El vendedor propietario siempre puede ver su comisión
    vendedorid = public.get_operador_id()
    OR
    -- Supervisores, jefes, admins y desarrolladores pueden ver todas
    public.get_rol_actual() IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
  );

-- 2. (Ya existe en 188 con acceso para supervisores) Confirmar política de comision_liberaciones
DROP POLICY IF EXISTS comision_liberaciones_select ON public.comision_liberaciones;
CREATE POLICY comision_liberaciones_select ON public.comision_liberaciones
  FOR SELECT
  USING (
    vendedor_id = public.get_operador_id()
    OR public.get_rol_actual() IN ('supervisor', 'administracion', 'desarrollador', 'jefe')
  );
