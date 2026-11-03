-- 294_staging_supervisor_solo_lo_propio_rollback.sql
-- Devuelve las políticas del supervisor a su estado anterior (ve y modifica todo el equipo). No toca datos.
BEGIN;

CREATE POLICY cotizaciones_supervisor_select ON public.cotizaciones FOR SELECT USING (get_rol_actual() = 'supervisor'::text);
ALTER POLICY cotizaciones_supervisor_update ON public.cotizaciones USING (get_rol_actual() = 'supervisor'::text) WITH CHECK (get_rol_actual() = 'supervisor'::text);
ALTER POLICY cotizaciones_supervisor_insert ON public.cotizaciones WITH CHECK (get_rol_actual() = 'supervisor'::text);

CREATE POLICY items_supervisor_select ON public.cotizacion_items FOR SELECT USING (get_rol_actual() = 'supervisor'::text);
ALTER POLICY items_supervisor_update ON public.cotizacion_items USING (get_rol_actual() = 'supervisor'::text) WITH CHECK (get_rol_actual() = 'supervisor'::text);
ALTER POLICY items_supervisor_insert ON public.cotizacion_items WITH CHECK (get_rol_actual() = 'supervisor'::text);
ALTER POLICY items_supervisor_delete ON public.cotizacion_items USING (get_rol_actual() = 'supervisor'::text);

CREATE POLICY despachos_supervisor_select ON public.notas_despacho FOR SELECT USING (get_rol_actual() = 'supervisor'::text);
ALTER POLICY despachos_supervisor_update ON public.notas_despacho USING (get_rol_actual() = 'supervisor'::text) WITH CHECK (get_rol_actual() = 'supervisor'::text);

ALTER POLICY descuentos_supervisor_all ON public.despacho_descuentos USING (get_rol_actual() = ANY (ARRAY['supervisor'::text, 'desarrollador'::text]));
ALTER POLICY cxc_supervisor_all ON public.cuentas_por_cobrar USING (get_rol_actual() = 'supervisor'::text);
ALTER POLICY clientes_supervisor_update ON public.clientes USING (get_rol_actual() = 'supervisor'::text) WITH CHECK (get_rol_actual() = 'supervisor'::text);

ALTER POLICY dashboard_scope_select ON public.clientes USING ((cuenta_id = auth.uid()) AND can_read_seller(vendedor_id));

ALTER POLICY comision_liberaciones_select ON public.comision_liberaciones
  USING ((vendedor_id = get_operador_id()) OR (get_rol_actual() = ANY (ARRAY['supervisor'::text, 'admin'::text, 'administracion'::text, 'desarrollador'::text, 'jefe'::text])));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comisiones' AND policyname='comisiones_supervision_select') THEN
    ALTER POLICY comisiones_supervision_select ON public.comisiones USING (get_rol_actual() = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'administracion'::text]));
  END IF;
END $$;

CREATE POLICY config_supervisor_update ON public.configuracion_negocio FOR UPDATE USING (get_rol_actual() = 'supervisor'::text);

ALTER POLICY cpp_privileged_all ON public.cuentas_por_pagar
  USING (get_rol_actual() = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'administracion'::text, 'desarrollador'::text]))
  WITH CHECK (get_rol_actual() = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'administracion'::text, 'desarrollador'::text]));
ALTER POLICY nd_items_admin ON public.notas_despacho_items
  USING (EXISTS (SELECT 1 FROM public.usuarios WHERE usuarios.cuenta_id = auth.uid() AND usuarios.rol = ANY (ARRAY['supervisor'::text, 'administracion'::text, 'desarrollador'::text]) AND usuarios.activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios WHERE usuarios.cuenta_id = auth.uid() AND usuarios.rol = ANY (ARRAY['supervisor'::text, 'administracion'::text, 'desarrollador'::text]) AND usuarios.activo = true));

COMMIT;
