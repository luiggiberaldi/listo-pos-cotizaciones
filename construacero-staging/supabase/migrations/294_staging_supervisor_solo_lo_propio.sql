-- 294_staging_supervisor_solo_lo_propio.sql
-- El rol supervisor ("Jefe de ventas") pasa a ver y tocar SOLO lo suyo, como un vendedor, en la base de datos:
--   cotizaciones, items, despachos, descuentos de despacho, cuentas por cobrar y comisiones liberadas.
-- Sigue viendo todos los clientes y transportistas (lectura). No puede cambiar la configuración del negocio
-- ni tocar cuentas por pagar. Hasta ahora lo limitaba solo la pantalla; esto lo hace valer en la base.
-- Lo propio lo cubren las políticas de vendedor (vendedor_id = get_operador_id()), que valen para cualquier rol.
-- No toca datos. Rollback: 294_staging_supervisor_solo_lo_propio_rollback.sql
BEGIN;

-- cotizaciones: la lectura propia ya la da cotizaciones_vendedor_select
DROP POLICY IF EXISTS cotizaciones_supervisor_select ON public.cotizaciones;
ALTER POLICY cotizaciones_supervisor_update ON public.cotizaciones
  USING (get_rol_actual() = 'supervisor' AND vendedor_id = get_operador_id())
  WITH CHECK (get_rol_actual() = 'supervisor' AND vendedor_id = get_operador_id());
ALTER POLICY cotizaciones_supervisor_insert ON public.cotizaciones
  WITH CHECK (get_rol_actual() = 'supervisor' AND vendedor_id = get_operador_id());

-- items de cotización: solo los de cotizaciones propias
DROP POLICY IF EXISTS items_supervisor_select ON public.cotizacion_items;
ALTER POLICY items_supervisor_update ON public.cotizacion_items
  USING (get_rol_actual() = 'supervisor' AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id AND c.vendedor_id = get_operador_id()))
  WITH CHECK (get_rol_actual() = 'supervisor' AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id AND c.vendedor_id = get_operador_id()));
ALTER POLICY items_supervisor_insert ON public.cotizacion_items
  WITH CHECK (get_rol_actual() = 'supervisor' AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id AND c.vendedor_id = get_operador_id()));
ALTER POLICY items_supervisor_delete ON public.cotizacion_items
  USING (get_rol_actual() = 'supervisor' AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id AND c.vendedor_id = get_operador_id()));

-- despachos: la lectura propia ya la da despachos_vendedor_select
DROP POLICY IF EXISTS despachos_supervisor_select ON public.notas_despacho;
ALTER POLICY despachos_supervisor_update ON public.notas_despacho
  USING (get_rol_actual() = 'supervisor' AND vendedor_id = get_operador_id())
  WITH CHECK (get_rol_actual() = 'supervisor' AND vendedor_id = get_operador_id());

-- descuentos de despacho: solo de despachos propios (desarrollador igual que antes)
ALTER POLICY descuentos_supervisor_all ON public.despacho_descuentos
  USING (get_rol_actual() = 'desarrollador' OR (get_rol_actual() = 'supervisor' AND despacho_id IN (SELECT id FROM public.notas_despacho WHERE vendedor_id = get_operador_id())));

-- cuentas por cobrar: solo las de clientes propios (igual que el vendedor)
ALTER POLICY cxc_supervisor_all ON public.cuentas_por_cobrar
  USING (get_rol_actual() = 'supervisor' AND cliente_id IN (SELECT id FROM public.clientes WHERE vendedor_id = get_operador_id()));

-- clientes: lee todos (sin cambio); modificar/reasignar por la API directa solo en los suyos
ALTER POLICY clientes_supervisor_update ON public.clientes
  USING (get_rol_actual() = 'supervisor' AND vendedor_id = get_operador_id())
  WITH CHECK (vendedor_id = get_operador_id());

-- clientes: la regla restrictiva del Inicio ocultaba al supervisor los clientes de otros supervisores/jefe; debe ver TODOS
ALTER POLICY dashboard_scope_select ON public.clientes
  USING ((cuenta_id = auth.uid()) AND (can_read_seller(vendedor_id) OR get_rol_actual() = 'supervisor'));

-- comisiones liberadas: solo las propias
ALTER POLICY comision_liberaciones_select ON public.comision_liberaciones
  USING ((vendedor_id = get_operador_id()) OR (get_rol_actual() = ANY (ARRAY['admin'::text, 'administracion'::text, 'desarrollador'::text, 'jefe'::text])));
-- (solo staging) lectura de comisiones por supervisión: sin supervisor
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comisiones' AND policyname='comisiones_supervision_select') THEN
    ALTER POLICY comisiones_supervision_select ON public.comisiones USING (get_rol_actual() = ANY (ARRAY['jefe'::text, 'administracion'::text]));
  END IF;
END $$;

-- configuración del negocio: el supervisor ya no la modifica
DROP POLICY IF EXISTS config_supervisor_update ON public.configuracion_negocio;

-- cuentas por pagar y items de despacho (escritura): sin supervisor
ALTER POLICY cpp_privileged_all ON public.cuentas_por_pagar
  USING (get_rol_actual() = ANY (ARRAY['jefe'::text, 'administracion'::text, 'desarrollador'::text]))
  WITH CHECK (get_rol_actual() = ANY (ARRAY['jefe'::text, 'administracion'::text, 'desarrollador'::text]));
ALTER POLICY nd_items_admin ON public.notas_despacho_items
  USING (EXISTS (SELECT 1 FROM public.usuarios WHERE usuarios.cuenta_id = auth.uid() AND usuarios.rol = ANY (ARRAY['administracion'::text, 'desarrollador'::text]) AND usuarios.activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios WHERE usuarios.cuenta_id = auth.uid() AND usuarios.rol = ANY (ARRAY['administracion'::text, 'desarrollador'::text]) AND usuarios.activo = true));

COMMIT;
