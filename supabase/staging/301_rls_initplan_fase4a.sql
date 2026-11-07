-- 301_rls_initplan_fase4a.sql
-- Fase 4A del plan de optimización (docs/operaciones/plan-optimizacion-velocidad-20261106.md).
-- Envuelve auth.uid()/auth.role()/auth.jwt() y get_rol_actual()/get_operador_id() en (SELECT ...) para evaluarlos
-- una vez por consulta y no una vez por fila. No cambia quién puede ver o hacer qué.
-- 138 reglas. Se ejecuta en UNA transacción.

BEGIN;
ALTER POLICY "auditoria_admin_select" ON public."auditoria" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "auditoria_insert" ON public."auditoria" WITH CHECK ((usuario_id = (SELECT get_operador_id())));
ALTER POLICY "auditoria_jefe_all" ON public."auditoria" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "auditoria_supervisor_select" ON public."auditoria" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "isolation_auditoria" ON public."auditoria" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "buzon_delete" ON public."buzon_sugerencias" USING (((SELECT get_rol_actual()) = 'desarrollador'::text));
ALTER POLICY "buzon_insert" ON public."buzon_sugerencias" WITH CHECK ((usuario_id = (SELECT get_operador_id())));
ALTER POLICY "buzon_select" ON public."buzon_sugerencias" USING (((usuario_id = (SELECT get_operador_id())) OR ((SELECT get_rol_actual()) = 'desarrollador'::text)));
ALTER POLICY "buzon_update" ON public."buzon_sugerencias" USING (((SELECT get_rol_actual()) = 'desarrollador'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'desarrollador'::text));
ALTER POLICY "isolation_buzon_sugerencias" ON public."buzon_sugerencias" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "isolation_cliente_prestamos" ON public."cliente_prestamos" USING ((EXISTS ( SELECT 1
   FROM clientes c
  WHERE ((c.id = cliente_prestamos.cliente_id) AND (c.cuenta_id = (SELECT auth.uid()))))));
ALTER POLICY "clientes_admin_select" ON public."clientes" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "clientes_authenticated_select" ON public."clientes" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "clientes_jefe_all" ON public."clientes" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "clientes_logistica_select" ON public."clientes" USING (((SELECT get_rol_actual()) = 'logistica'::text));
ALTER POLICY "clientes_supervisor_insert" ON public."clientes" WITH CHECK (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "clientes_supervisor_select" ON public."clientes" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "clientes_supervisor_update" ON public."clientes" USING ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (vendedor_id = (SELECT get_operador_id())))) WITH CHECK ((vendedor_id = (SELECT get_operador_id())));
ALTER POLICY "clientes_vendedor_insert" ON public."clientes" WITH CHECK (((vendedor_id = (SELECT get_operador_id())) AND ((SELECT get_rol_actual()) = 'vendedor'::text)));
ALTER POLICY "clientes_vendedor_select" ON public."clientes" USING (((vendedor_id = (SELECT get_operador_id())) AND (activo = true)));
ALTER POLICY "clientes_vendedor_update" ON public."clientes" USING (((vendedor_id = (SELECT get_operador_id())) AND ((SELECT get_rol_actual()) = 'vendedor'::text))) WITH CHECK ((vendedor_id = (SELECT get_operador_id())));
ALTER POLICY "dashboard_scope_select" ON public."clientes" USING (((cuenta_id = (SELECT auth.uid())) AND (can_read_seller(vendedor_id) OR ((SELECT get_rol_actual()) = 'supervisor'::text))));
ALTER POLICY "isolation_clientes" ON public."clientes" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "designacion_select" ON public."comision_designacion_diaria" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "comision_liberaciones_select" ON public."comision_liberaciones" USING (((vendedor_id = (SELECT get_operador_id())) OR ((SELECT get_rol_actual()) = ANY (ARRAY['admin'::text, 'administracion'::text, 'desarrollador'::text, 'jefe'::text]))));
ALTER POLICY "dashboard_scope_select" ON public."comision_liberaciones" USING (((cuenta_id = (SELECT auth.uid())) AND can_read_seller(vendedor_id) AND ((SELECT get_rol_actual()) <> 'logistica'::text) AND (EXISTS ( SELECT 1
   FROM comisiones c
  WHERE (c.id = comision_liberaciones.comision_id)))));
ALTER POLICY "comisiones_supervision_select" ON public."comisiones" USING (((SELECT get_rol_actual()) = ANY (ARRAY['jefe'::text, 'administracion'::text])));
ALTER POLICY "comisiones_vendedor_select" ON public."comisiones" USING ((vendedorid = (SELECT get_operador_id())));
ALTER POLICY "dashboard_scope_allow" ON public."comisiones" USING (((cuentaid = (SELECT auth.uid())) AND can_read_seller(vendedorid) AND ((SELECT get_rol_actual()) <> 'logistica'::text)));
ALTER POLICY "dashboard_scope_select" ON public."comisiones" USING (((cuentaid = (SELECT auth.uid())) AND can_read_seller(vendedorid) AND ((SELECT get_rol_actual()) <> 'logistica'::text)));
ALTER POLICY "config_admin_select" ON public."configuracion_negocio" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "config_autenticados_leen" ON public."configuracion_negocio" USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "configuracion_jefe_all" ON public."configuracion_negocio" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "isolation_configuracion_negocio" ON public."configuracion_negocio" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "cotizacion_items_admin_select" ON public."cotizacion_items" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "cotizacion_items_jefe_all" ON public."cotizacion_items" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "dashboard_scope_allow" ON public."cotizacion_items" USING (((cuenta_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE (c.id = cotizacion_items.cotizacion_id)))));
ALTER POLICY "dashboard_scope_select" ON public."cotizacion_items" USING (((cuenta_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE (c.id = cotizacion_items.cotizacion_id)))));
ALTER POLICY "isolation_cotizacion_items" ON public."cotizacion_items" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "items_logistica_select" ON public."cotizacion_items" USING ((((SELECT get_rol_actual()) = 'logistica'::text) AND (EXISTS ( SELECT 1
   FROM notas_despacho nd
  WHERE (nd.cotizacion_id = cotizacion_items.cotizacion_id)))));
ALTER POLICY "items_supervisor_delete" ON public."cotizacion_items" USING ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id())))))));
ALTER POLICY "items_supervisor_insert" ON public."cotizacion_items" WITH CHECK ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id())))))));
ALTER POLICY "items_supervisor_update" ON public."cotizacion_items" USING ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id()))))))) WITH CHECK ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id())))))));
ALTER POLICY "items_vendedor_delete" ON public."cotizacion_items" USING ((EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id())) AND (c.estado = 'borrador'::estado_cotizacion)))));
ALTER POLICY "items_vendedor_insert" ON public."cotizacion_items" WITH CHECK ((EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id())) AND (c.estado = 'borrador'::estado_cotizacion)))));
ALTER POLICY "items_vendedor_select" ON public."cotizacion_items" USING ((EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id()))))));
ALTER POLICY "items_vendedor_update" ON public."cotizacion_items" USING ((EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = cotizacion_items.cotizacion_id) AND (c.vendedor_id = (SELECT get_operador_id())) AND (c.estado = 'borrador'::estado_cotizacion)))));
ALTER POLICY "cotizaciones_admin_select" ON public."cotizaciones" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "cotizaciones_authenticated_select" ON public."cotizaciones" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "cotizaciones_jefe_all" ON public."cotizaciones" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "cotizaciones_logistica_select" ON public."cotizaciones" USING ((((SELECT get_rol_actual()) = 'logistica'::text) AND (EXISTS ( SELECT 1
   FROM notas_despacho nd
  WHERE (nd.cotizacion_id = cotizaciones.id)))));
ALTER POLICY "cotizaciones_supervisor_insert" ON public."cotizaciones" WITH CHECK ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (vendedor_id = (SELECT get_operador_id()))));
ALTER POLICY "cotizaciones_supervisor_update" ON public."cotizaciones" USING ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (vendedor_id = (SELECT get_operador_id())))) WITH CHECK ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (vendedor_id = (SELECT get_operador_id()))));
ALTER POLICY "cotizaciones_vendedor_insert" ON public."cotizaciones" WITH CHECK (((vendedor_id = (SELECT get_operador_id())) AND (EXISTS ( SELECT 1
   FROM clientes
  WHERE ((clientes.id = cotizaciones.cliente_id) AND (clientes.vendedor_id = (SELECT get_operador_id())))))));
ALTER POLICY "cotizaciones_vendedor_select" ON public."cotizaciones" USING ((vendedor_id = (SELECT get_operador_id())));
ALTER POLICY "cotizaciones_vendedor_update" ON public."cotizaciones" USING (((vendedor_id = (SELECT get_operador_id())) AND (estado = ANY (ARRAY['borrador'::estado_cotizacion, 'enviada'::estado_cotizacion])))) WITH CHECK (((vendedor_id = (SELECT get_operador_id())) AND (estado = ANY (ARRAY['borrador'::estado_cotizacion, 'enviada'::estado_cotizacion, 'anulada'::estado_cotizacion]))));
ALTER POLICY "dashboard_scope_select" ON public."cotizaciones" USING (((cuenta_id = (SELECT auth.uid())) AND can_read_seller(vendedor_id)));
ALTER POLICY "isolation_cotizaciones" ON public."cotizaciones" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "cuentas_cobrar_admin_select" ON public."cuentas_por_cobrar" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "cuentas_por_cobrar_jefe_all" ON public."cuentas_por_cobrar" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "cxc_supervisor_all" ON public."cuentas_por_cobrar" USING ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (cliente_id IN ( SELECT clientes.id
   FROM clientes
  WHERE (clientes.vendedor_id = (SELECT get_operador_id()))))));
ALTER POLICY "cxc_vendedor_select" ON public."cuentas_por_cobrar" USING ((cliente_id IN ( SELECT clientes.id
   FROM clientes
  WHERE (clientes.vendedor_id = (SELECT get_operador_id())))));
ALTER POLICY "dashboard_scope_select" ON public."cuentas_por_cobrar" USING (((cuenta_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM clientes c
  WHERE (c.id = cuentas_por_cobrar.cliente_id)))));
ALTER POLICY "isolation_cuentas_por_cobrar" ON public."cuentas_por_cobrar" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "cpp_privileged_all" ON public."cuentas_por_pagar" USING (((SELECT get_rol_actual()) = ANY (ARRAY['jefe'::text, 'administracion'::text, 'desarrollador'::text]))) WITH CHECK (((SELECT get_rol_actual()) = ANY (ARRAY['jefe'::text, 'administracion'::text, 'desarrollador'::text])));
ALTER POLICY "isolation_cuentas_por_pagar" ON public."cuentas_por_pagar" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "descuentos_admin_select" ON public."despacho_descuentos" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "descuentos_logistica_all" ON public."despacho_descuentos" USING (((SELECT get_rol_actual()) = 'logistica'::text));
ALTER POLICY "descuentos_supervisor_all" ON public."despacho_descuentos" USING ((((SELECT get_rol_actual()) = 'desarrollador'::text) OR (((SELECT get_rol_actual()) = 'supervisor'::text) AND (despacho_id IN ( SELECT notas_despacho.id
   FROM notas_despacho
  WHERE (notas_despacho.vendedor_id = (SELECT get_operador_id())))))));
ALTER POLICY "descuentos_vendedor_select" ON public."despacho_descuentos" USING ((((SELECT get_rol_actual()) = 'vendedor'::text) AND (despacho_id IN ( SELECT notas_despacho.id
   FROM notas_despacho
  WHERE (notas_despacho.vendedor_id = (SELECT auth.uid()))))));
ALTER POLICY "isolation_despacho_descuentos" ON public."despacho_descuentos" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "inventario_movimientos_jefe_all" ON public."inventario_movimientos" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "isolation_inventario_movimientos" ON public."inventario_movimientos" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "movimientos_admin_insert" ON public."inventario_movimientos" WITH CHECK (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "movimientos_admin_select" ON public."inventario_movimientos" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "movimientos_supervisor_insert" ON public."inventario_movimientos" WITH CHECK (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "movimientos_supervisor_select" ON public."inventario_movimientos" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "dashboard_scope_select" ON public."notas_despacho" USING (((cuenta_id = (SELECT auth.uid())) AND can_read_seller(vendedor_id)));
ALTER POLICY "despachos_admin_select" ON public."notas_despacho" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "despachos_authenticated_select" ON public."notas_despacho" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "despachos_logistica_select" ON public."notas_despacho" USING (((SELECT get_rol_actual()) = 'logistica'::text));
ALTER POLICY "despachos_supervisor_update" ON public."notas_despacho" USING ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (vendedor_id = (SELECT get_operador_id())))) WITH CHECK ((((SELECT get_rol_actual()) = 'supervisor'::text) AND (vendedor_id = (SELECT get_operador_id()))));
ALTER POLICY "despachos_vendedor_select" ON public."notas_despacho" USING ((vendedor_id = (SELECT get_operador_id())));
ALTER POLICY "isolation_notas_despacho" ON public."notas_despacho" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "notas_despacho_jefe_all" ON public."notas_despacho" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "dashboard_scope_allow" ON public."notas_despacho_items" USING (((cuenta_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM notas_despacho d
  WHERE (d.id = notas_despacho_items.despacho_id)))));
ALTER POLICY "dashboard_scope_select" ON public."notas_despacho_items" USING (((cuenta_id = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM notas_despacho d
  WHERE (d.id = notas_despacho_items.despacho_id)))));
ALTER POLICY "isolation_notas_despacho_items" ON public."notas_despacho_items" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "nd_items_admin" ON public."notas_despacho_items" USING ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.cuenta_id = (SELECT auth.uid())) AND (usuarios.rol = ANY (ARRAY['administracion'::text, 'desarrollador'::text])) AND (usuarios.activo = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.cuenta_id = (SELECT auth.uid())) AND (usuarios.rol = ANY (ARRAY['administracion'::text, 'desarrollador'::text])) AND (usuarios.activo = true)))));
ALTER POLICY "nd_items_vendedor_read" ON public."notas_despacho_items" USING ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.cuenta_id = (SELECT auth.uid())) AND (usuarios.activo = true)))));
ALTER POLICY "isolation_orden_compra_items" ON public."orden_compra_items" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "orden_compra_items_rol_all" ON public."orden_compra_items" USING (((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'desarrollador'::text]))) WITH CHECK (((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'desarrollador'::text])));
ALTER POLICY "isolation_ordenes_compra" ON public."ordenes_compra" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "ordenes_compra_rol_all" ON public."ordenes_compra" USING (((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'desarrollador'::text]))) WITH CHECK (((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'desarrollador'::text])));
ALTER POLICY "pagos_transportistas_admin_insert" ON public."pagos_transportistas" WITH CHECK (((cuenta_id = (SELECT auth.uid())) AND ((SELECT get_rol_actual()) = ANY (ARRAY['administracion'::text, 'desarrollador'::text]))));
ALTER POLICY "pagos_transportistas_admin_select" ON public."pagos_transportistas" USING (((cuenta_id = (SELECT auth.uid())) AND ((SELECT get_rol_actual()) = ANY (ARRAY['administracion'::text, 'desarrollador'::text, 'logistica'::text]))));
ALTER POLICY "pagos_transportistas_despachos_select" ON public."pagos_transportistas_despachos" USING (((cuenta_id = (SELECT auth.uid())) AND ((SELECT get_rol_actual()) = ANY (ARRAY['administracion'::text, 'desarrollador'::text, 'logistica'::text]))));
ALTER POLICY "dashboard_scope_select" ON public."productos" USING (((cuenta_id = (SELECT auth.uid())) AND ((SELECT get_rol_actual()) = ANY (ARRAY['jefe'::text, 'supervisor'::text, 'administracion'::text, 'desarrollador'::text]))));
ALTER POLICY "isolation_productos" ON public."productos" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "productos_admin_delete" ON public."productos" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "productos_admin_insert" ON public."productos" WITH CHECK (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "productos_admin_select" ON public."productos" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "productos_admin_update" ON public."productos" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "productos_authenticated_select" ON public."productos" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "productos_jefe_all" ON public."productos" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "productos_supervisor_select" ON public."productos" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "isolation_proveedores" ON public."proveedores" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "proveedores_privileged_all" ON public."proveedores" USING (((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'administracion'::text, 'desarrollador'::text]))) WITH CHECK (((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'jefe'::text, 'administracion'::text, 'desarrollador'::text])));
ALTER POLICY "own_push" ON public."push_subscriptions" USING ((usuario_id = (SELECT auth.uid())));
ALTER POLICY "supervisor_push" ON public."push_subscriptions" USING ((usuario_id = (SELECT auth.uid())));
ALTER POLICY "isolation_reasignaciones_clientes" ON public."reasignaciones_clientes" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "reasig_supervisor_select" ON public."reasignaciones_clientes" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "reasignaciones_admin_select" ON public."reasignaciones_clientes" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "reasignaciones_jefe_all" ON public."reasignaciones_clientes" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "isolation_seguimiento_operativo" ON public."seguimiento_operativo" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "seguimiento_delete" ON public."seguimiento_operativo" USING ((usuario_id = (SELECT auth.uid())));
ALTER POLICY "seguimiento_update" ON public."seguimiento_operativo" USING (((usuario_id = (SELECT auth.uid())) OR ((SELECT get_rol_actual()) = ANY (ARRAY['supervisor'::text, 'administracion'::text, 'jefe'::text, 'desarrollador'::text]))));
ALTER POLICY "analysis_supervisor_select" ON public."system_log_analysis" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "logs_supervisor_select" ON public."system_logs" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "isolation_transportistas" ON public."transportistas" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "transportistas_admin_select" ON public."transportistas" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "transportistas_jefe_all" ON public."transportistas" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "transportistas_logistica_select" ON public."transportistas" USING (((SELECT get_rol_actual()) = 'logistica'::text));
ALTER POLICY "transportistas_supervisor_todos" ON public."transportistas" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "transportistas_supervisor_update" ON public."transportistas" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "transportistas_supervisor_write" ON public."transportistas" WITH CHECK (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "transportistas_vendedor_update" ON public."transportistas" USING (((SELECT get_rol_actual()) = 'vendedor'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'vendedor'::text));
ALTER POLICY "dashboard_scope_select" ON public."usuarios" USING (((cuenta_id = (SELECT auth.uid())) AND can_read_seller(id)));
ALTER POLICY "isolation_usuarios" ON public."usuarios" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "usuarios_admin_select" ON public."usuarios" USING (((SELECT get_rol_actual()) = 'administracion'::text));
ALTER POLICY "usuarios_jefe_all" ON public."usuarios" USING (((SELECT get_rol_actual()) = 'jefe'::text)) WITH CHECK (((SELECT get_rol_actual()) = 'jefe'::text));
ALTER POLICY "usuarios_logistica_select" ON public."usuarios" USING (((SELECT get_rol_actual()) = 'logistica'::text));
ALTER POLICY "usuarios_supervisor_insert" ON public."usuarios" WITH CHECK (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "usuarios_supervisor_select" ON public."usuarios" USING (((SELECT get_rol_actual()) = 'supervisor'::text));
ALTER POLICY "usuarios_supervisor_update" ON public."usuarios" USING (((SELECT get_rol_actual()) = 'supervisor'::text)) WITH CHECK ((NOT ((id = (SELECT get_operador_id())) AND (rol <> 'supervisor'::text))));
ALTER POLICY "usuarios_ver_propio" ON public."usuarios" USING ((id = (SELECT get_operador_id())));
ALTER POLICY "isolation_vehiculos" ON public."vehiculos" USING ((cuenta_id = (SELECT auth.uid())));
ALTER POLICY "vehiculos_lectura" ON public."vehiculos" USING ((cuenta_id = (SELECT auth.uid())));
COMMIT;
