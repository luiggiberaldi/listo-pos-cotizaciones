-- 013_rls_enable_and_policies.sql
-- PRINCIPIO: Con RLS habilitado, el DEFAULT es DENY ALL.
-- Cada política que se crea es un permiso adicional (PERMISSIVE = OR entre políticas del mismo comando).

-- ============================================================
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ============================================================
ALTER TABLE public.usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transportistas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizacion_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reasignaciones_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_negocio ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- HELPER: función para verificar rol del usuario actual
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true;
$$;


-- ============================================================
-- TABLA: usuarios
-- ============================================================

-- Cualquier usuario autenticado puede verse a sí mismo
CREATE POLICY usuarios_ver_propio ON public.usuarios
  FOR SELECT
  USING (id = auth.uid());

-- Supervisores ven todos los usuarios
CREATE POLICY usuarios_supervisor_select ON public.usuarios
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Solo supervisores crean usuarios
CREATE POLICY usuarios_supervisor_insert ON public.usuarios
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Solo supervisores actualizan usuarios (y no pueden cambiar su propio rol)
CREATE POLICY usuarios_supervisor_update ON public.usuarios
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor')
  WITH CHECK (
    -- Un supervisor no puede quitarse el rol a sí mismo
    NOT (id = auth.uid() AND rol <> 'supervisor')
  );

-- Nadie elimina usuarios (se desactivan con activo = false)
-- No CREATE POLICY para DELETE → DENY por default


-- ============================================================
-- TABLA: productos
-- ============================================================

-- Todos los usuarios autenticados leen productos activos
CREATE POLICY productos_todos_leen ON public.productos
  FOR SELECT
  USING (activo = true);

-- Solo supervisores insertan, actualizan, eliminan productos
CREATE POLICY productos_supervisor_insert ON public.productos
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

CREATE POLICY productos_supervisor_update ON public.productos
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY productos_supervisor_delete ON public.productos
  FOR DELETE
  USING (public.get_rol_actual() = 'supervisor');


-- ============================================================
-- TABLA: transportistas
-- ============================================================

-- Todos leen transportistas activos
CREATE POLICY transportistas_todos_leen ON public.transportistas
  FOR SELECT
  USING (activo = true);

-- Supervisores también ven los inactivos
CREATE POLICY transportistas_supervisor_todos ON public.transportistas
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY transportistas_supervisor_write ON public.transportistas
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

CREATE POLICY transportistas_supervisor_update ON public.transportistas
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');


-- ============================================================
-- TABLA: clientes
-- ============================================================

-- Vendedor solo ve SUS clientes
CREATE POLICY clientes_vendedor_select ON public.clientes
  FOR SELECT
  USING (vendedor_id = auth.uid() AND activo = true);

-- Supervisor ve todos
CREATE POLICY clientes_supervisor_select ON public.clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Vendedor crea clientes (se auto-asigna)
CREATE POLICY clientes_vendedor_insert ON public.clientes
  FOR INSERT
  WITH CHECK (
    vendedor_id = auth.uid()
    AND public.get_rol_actual() = 'vendedor'
  );

-- Supervisor puede insertar (ej: migración de datos)
CREATE POLICY clientes_supervisor_insert ON public.clientes
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Vendedor puede editar datos de SU cliente, pero NO cambiar vendedor_id
CREATE POLICY clientes_vendedor_update ON public.clientes
  FOR UPDATE
  USING (
    vendedor_id = auth.uid()
    AND public.get_rol_actual() = 'vendedor'
  )
  WITH CHECK (
    vendedor_id = auth.uid()  -- No puede cambiar la asignación
  );

-- Supervisor puede editar cualquier cliente
CREATE POLICY clientes_supervisor_update ON public.clientes
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');

-- Nadie elimina clientes (se desactivan)
-- DELETE: DENY por default


-- ============================================================
-- TABLA: cotizaciones
-- ============================================================

-- Vendedor ve solo SUS cotizaciones
CREATE POLICY cotizaciones_vendedor_select ON public.cotizaciones
  FOR SELECT
  USING (vendedor_id = auth.uid());

-- Supervisor ve todas
CREATE POLICY cotizaciones_supervisor_select ON public.cotizaciones
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Vendedor crea cotizaciones (solo para sus clientes)
CREATE POLICY cotizaciones_vendedor_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (
    vendedor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.clientes
      WHERE id = cliente_id AND vendedor_id = auth.uid()
    )
  );

-- Supervisor puede crear cotizaciones
CREATE POLICY cotizaciones_supervisor_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Vendedor edita SOLO borradores propios
CREATE POLICY cotizaciones_vendedor_update ON public.cotizaciones
  FOR UPDATE
  USING (
    vendedor_id = auth.uid()
    AND estado = 'borrador'
  )
  WITH CHECK (
    vendedor_id = auth.uid()
    AND estado IN ('borrador', 'enviada', 'anulada')
    -- solo puede avanzar a: enviada, o anular su borrador
  );

-- Supervisor puede actualizar cualquier cotización
CREATE POLICY cotizaciones_supervisor_update ON public.cotizaciones
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');

-- Nadie elimina cotizaciones
-- DELETE: DENY por default


-- ============================================================
-- TABLA: cotizacion_items
-- ============================================================

-- Un usuario puede ver los items de sus propias cotizaciones
CREATE POLICY items_vendedor_select ON public.cotizacion_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id AND c.vendedor_id = auth.uid()
    )
  );

CREATE POLICY items_supervisor_select ON public.cotizacion_items
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Vendedor inserta items en sus borradores
CREATE POLICY items_vendedor_insert ON public.cotizacion_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = auth.uid()
        AND c.estado = 'borrador'
    )
  );

CREATE POLICY items_supervisor_insert ON public.cotizacion_items
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Vendedor actualiza items de sus borradores
CREATE POLICY items_vendedor_update ON public.cotizacion_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = auth.uid()
        AND c.estado = 'borrador'
    )
  );

-- Vendedor elimina items de sus borradores
CREATE POLICY items_vendedor_delete ON public.cotizacion_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = auth.uid()
        AND c.estado = 'borrador'
    )
  );

CREATE POLICY items_supervisor_update ON public.cotizacion_items
  FOR UPDATE USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY items_supervisor_delete ON public.cotizacion_items
  FOR DELETE USING (public.get_rol_actual() = 'supervisor');


-- ============================================================
-- TABLA: auditoria (APPEND-ONLY)
-- ============================================================

-- Solo supervisores leen
CREATE POLICY auditoria_supervisor_select ON public.auditoria
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- TODOS los usuarios autenticados pueden insertar su propio registro
CREATE POLICY auditoria_insert ON public.auditoria
  FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- NOTA: No hay política UPDATE ni DELETE → ambas bloqueadas por RLS


-- ============================================================
-- TABLA: reasignaciones_clientes (APPEND-ONLY)
-- ============================================================

-- Supervisores leen todo
CREATE POLICY reasig_supervisor_select ON public.reasignaciones_clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- INSERT solo vía RPC reasignar_cliente() (SECURITY DEFINER)
-- No política de INSERT directa → bloqueada por RLS


-- ============================================================
-- TABLA: configuracion_negocio
-- ============================================================

-- Todos los autenticados pueden leer la config
CREATE POLICY config_todos_leen ON public.configuracion_negocio
  FOR SELECT
  USING (true);

-- Solo supervisores actualizan
CREATE POLICY config_supervisor_update ON public.configuracion_negocio
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');
