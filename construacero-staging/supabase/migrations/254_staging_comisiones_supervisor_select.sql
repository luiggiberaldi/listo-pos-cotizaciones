-- 254_staging_comisiones_supervisor_select.sql
-- Lectura de comisiones para roles de supervisión. La política existente solo
-- permite al vendedor dueño (vendedorid = get_operador_id()); los roles de
-- supervisión (jefe/supervisor/administración — desarrollador mapea a
-- supervisor vía get_rol_actual) necesitan leer el panel de comisiones.
-- Solo SELECT; las mutaciones siguen siendo del Worker (service_role).

CREATE POLICY comisiones_supervision_select
  ON public.comisiones
  FOR SELECT
  TO authenticated
  USING (public.get_rol_actual() IN ('supervisor', 'jefe', 'administracion'));
