-- 080: Aislamiento por cuenta (tenant isolation)
-- Agrega cuenta_id a todas las tablas de negocio para aislar datos entre cuentas auth

-- ============================================================
-- 1. Agregar columna cuenta_id a todas las tablas
-- ============================================================
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.cotizacion_items ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.notas_despacho ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.comisiones ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.inventario_movimientos ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.cuentas_por_cobrar ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.despacho_descuentos ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.reasignaciones_clientes ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.auditoria ADD COLUMN IF NOT EXISTS cuenta_id UUID;
ALTER TABLE public.configuracion_negocio ADD COLUMN IF NOT EXISTS cuenta_id UUID;

-- ============================================================
-- 2. Asignar datos existentes a la cuenta original
-- ============================================================
UPDATE public.usuarios SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.clientes SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.cotizaciones SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.cotizacion_items SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.notas_despacho SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.productos SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.transportistas SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.comisiones SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.inventario_movimientos SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.cuentas_por_cobrar SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.despacho_descuentos SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.reasignaciones_clientes SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.auditoria SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.configuracion_negocio SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;

-- ============================================================
-- 3. Crear índices para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_usuarios_cuenta_id ON public.usuarios(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_clientes_cuenta_id ON public.clientes(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cuenta_id ON public.cotizaciones(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cotizacion_items_cuenta_id ON public.cotizacion_items(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_notas_despacho_cuenta_id ON public.notas_despacho(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_productos_cuenta_id ON public.productos(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_transportistas_cuenta_id ON public.transportistas(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_cuenta_id ON public.comisiones(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_cuenta_id ON public.inventario_movimientos(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_por_cobrar_cuenta_id ON public.cuentas_por_cobrar(cuenta_id);

-- ============================================================
-- 4. Actualizar listar_usuarios_login para filtrar por cuenta
-- ============================================================
DROP FUNCTION IF EXISTS public.listar_usuarios_login();
CREATE FUNCTION public.listar_usuarios_login()
  RETURNS TABLE(id uuid, nombre text, rol text, color text, imagen_url text)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::text AS imagen_url
  FROM public.usuarios u
  WHERE u.activo = true
    AND u.nombre <> 'Super Admin'
    AND u.cuenta_id = auth.uid()
  ORDER BY u.nombre;
$$;

GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO anon, authenticated;
