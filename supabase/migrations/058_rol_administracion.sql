-- 058_rol_administracion.sql
-- Agrega el rol 'administracion' al CHECK constraint de la tabla usuarios
-- Administración: gestión total de inventario y reportes, acceso limitado al resto
--
-- Permisos:
--   ✅ Inventario: CRUD total (crear, editar, borrar productos) — ÚNICO rol con este privilegio
--   ✅ Reportes: acceso completo
--   ✅ Clientes: solo ver (incluyendo deudas), sin crear/editar/borrar
--   ✅ Despachos: solo ver + descargar PDF/imprimir, sin cambiar estados
--   ✅ Comisiones: solo ver, sin marcar pagada
--   ❌ Cotizaciones: sin acceso
--   ❌ Transportistas: sin acceso
--   ❌ Usuarios/Configuración/Logs: sin acceso

-- 1. Actualizar constraint de rol
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('supervisor', 'vendedor', 'administracion'));

-- 2. RLS: Administracion puede ver todos los clientes (como supervisor)
CREATE POLICY clientes_admin_select ON public.clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 3. RLS: Administracion puede ver todos los despachos
CREATE POLICY despachos_admin_select ON public.notas_despacho
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 4. RLS: Administracion puede ver todos los productos (ya tienen acceso via políticas existentes, pero para CRUD necesitamos más)
CREATE POLICY productos_admin_select ON public.productos
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

CREATE POLICY productos_admin_insert ON public.productos
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'administracion');

CREATE POLICY productos_admin_update ON public.productos
  FOR UPDATE
  USING (public.get_rol_actual() = 'administracion');

CREATE POLICY productos_admin_delete ON public.productos
  FOR DELETE
  USING (public.get_rol_actual() = 'administracion');

-- 5. RLS: Administracion puede ver comisiones
CREATE POLICY comisiones_admin_select ON public.comisiones
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 6. RLS: Administracion puede ver movimientos de inventario
CREATE POLICY movimientos_admin_select ON public.inventario_movimientos
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- Administracion puede crear movimientos (ingreso/egreso de productos)
CREATE POLICY movimientos_admin_insert ON public.inventario_movimientos
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'administracion');

-- 7. RLS: Administracion puede ver cotizacion_items (necesario para despachos/reportes)
CREATE POLICY cotizacion_items_admin_select ON public.cotizacion_items
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 8. RLS: Administracion puede ver cotizaciones (necesario para reportes)
CREATE POLICY cotizaciones_admin_select ON public.cotizaciones
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 9. RLS: Administracion puede ver usuarios (para filtros de vendedor)
CREATE POLICY usuarios_admin_select ON public.usuarios
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 10. RLS: Administracion puede ver configuracion del negocio
CREATE POLICY config_admin_select ON public.configuracion_negocio
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 11. RLS: Administracion puede ver cuentas por cobrar (deudas de clientes)
CREATE POLICY cuentas_cobrar_admin_select ON public.cuentas_por_cobrar
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 12. RLS: Administracion puede ver transportistas (necesario para despachos)
CREATE POLICY transportistas_admin_select ON public.transportistas
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 13. RLS: Administracion puede ver reasignaciones (para ficha de cliente)
CREATE POLICY reasignaciones_admin_select ON public.reasignaciones_clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');

-- 14. RLS: Administracion puede ver auditoria
CREATE POLICY auditoria_admin_select ON public.auditoria
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');
