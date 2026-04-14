-- 017_fixes_seguridad.sql
-- Correcciones de seguridad encontradas en la auditoría

-- 1. Agregar security_invoker a las views para que RLS se aplique correctamente
ALTER VIEW public.v_productos_vendedor SET (security_invoker = on);
ALTER VIEW public.v_cotizaciones_vendedor SET (security_invoker = on);

-- 2. Fix registrar_auditoria: auto-popular datos del usuario desde auth.uid()
--    en vez de aceptar parámetros que permiten suplantación
CREATE OR REPLACE FUNCTION public.registrar_auditoria(
  p_accion TEXT,
  p_entidad TEXT,
  p_entidad_id UUID DEFAULT NULL,
  p_detalle JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID;
  v_usuario_nombre TEXT;
  v_usuario_rol TEXT;
BEGIN
  -- Auto-obtener datos del usuario autenticado
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'USUARIO_NO_AUTENTICADO';
  END IF;

  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo = true;

  IF v_usuario_nombre IS NULL THEN
    RAISE EXCEPTION 'USUARIO_NO_ENCONTRADO';
  END IF;

  INSERT INTO public.auditoria (
    usuario_id, usuario_nombre, usuario_rol,
    accion, entidad, entidad_id, detalle
  ) VALUES (
    v_usuario_id, v_usuario_nombre, v_usuario_rol,
    p_accion, p_entidad, p_entidad_id, p_detalle
  );
END;
$$;

-- 3. Agregar política INSERT para configuracion_negocio (supervisor puede hacer upsert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'configuracion_negocio'
    AND policyname = 'config_supervisor_insert'
  ) THEN
    CREATE POLICY config_supervisor_insert ON public.configuracion_negocio
      FOR INSERT
      WITH CHECK (public.get_rol_actual() = 'supervisor');
  END IF;
END$$;

-- 4. Agregar WITH CHECK a supervisor update policies
DROP POLICY IF EXISTS cotizaciones_supervisor_update ON public.cotizaciones;
CREATE POLICY cotizaciones_supervisor_update ON public.cotizaciones
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor')
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- 5. Agregar CHECK constraint para stock no negativo
ALTER TABLE public.productos
  ADD CONSTRAINT productos_stock_no_negativo
  CHECK (stock_actual >= 0);
