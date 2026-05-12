-- 104_tenant_isolation_restrictive.sql
-- Enforce tenant isolation via RESTRICTIVE policies on all tables.
-- Usa inferencia relacional para setear cuenta_id cuando el Worker (Service Key) inserta datos.

-- 1. Agregar cuenta_id a notas_despacho_items (si faltaba)
ALTER TABLE public.notas_despacho_items ADD COLUMN IF NOT EXISTS cuenta_id UUID;

-- 2. Asegurarse de que toda la data existente esté atada al tenant principal
UPDATE public.usuarios SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.clientes SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.cotizaciones SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.cotizacion_items SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.notas_despacho SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.notas_despacho_items SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.productos SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.transportistas SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.comisiones SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.inventario_movimientos SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.cuentas_por_cobrar SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.despacho_descuentos SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.reasignaciones_clientes SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.auditoria SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;
UPDATE public.configuracion_negocio SET cuenta_id = '74dd6821-963d-406e-8621-47352e0df27e' WHERE cuenta_id IS NULL;

-- 3. Crear función de trigger inteligente para poblar cuenta_id basándose en FKs
CREATE OR REPLACE FUNCTION public.set_cuenta_id_smart()
RETURNS TRIGGER AS $$
BEGIN
  -- Si ya viene con cuenta_id, respetarlo
  IF NEW.cuenta_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Si hay un usuario autenticado normal (Frontend directo), usamos su ID
  IF auth.uid() IS NOT NULL THEN
    NEW.cuenta_id := auth.uid();
    RETURN NEW;
  END IF;

  -- Si no (Worker con Service Key), inferimos a través de relaciones
  IF TG_TABLE_NAME = 'clientes' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'cotizaciones' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'cotizacion_items' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.cotizaciones WHERE id = NEW.cotizacion_id;
  ELSIF TG_TABLE_NAME = 'notas_despacho' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'notas_despacho_items' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.notas_despacho WHERE id = NEW.despacho_id;
  ELSIF TG_TABLE_NAME = 'comisiones' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'inventario_movimientos' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.productos WHERE id = NEW.producto_id;
  ELSIF TG_TABLE_NAME = 'cuentas_por_cobrar' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.clientes WHERE id = NEW.cliente_id;
  ELSIF TG_TABLE_NAME = 'despacho_descuentos' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.notas_despacho WHERE id = NEW.despacho_id;
  ELSIF TG_TABLE_NAME = 'reasignaciones_clientes' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.clientes WHERE id = NEW.cliente_id;
  ELSIF TG_TABLE_NAME = 'auditoria' THEN
    -- A veces el worker no manda usuario_id pero casi siempre sí. 
    -- Si no manda usuario_id intentamos buscar por entidad_id (si es un cliente, usuario, etc)
    IF NEW.usuario_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.usuario_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Aplicar trigger y RLS a todas las tablas
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'usuarios', 'clientes', 'cotizaciones', 'cotizacion_items', 
    'notas_despacho', 'notas_despacho_items', 'productos', 'transportistas', 
    'comisiones', 'inventario_movimientos', 'cuentas_por_cobrar', 
    'despacho_descuentos', 'reasignaciones_clientes', 'auditoria', 
    'configuracion_negocio'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Limpiar triggers y RLS viejos
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_cuenta_id_%I ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS isolation_%I ON public.%I', t, t);
    
    -- Activar RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    
    -- Crear política restrictiva
    EXECUTE format('CREATE POLICY isolation_%I ON public.%I AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid())', t, t);
    
    -- Crear trigger
    EXECUTE format('CREATE TRIGGER trg_set_cuenta_id_%I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_cuenta_id_smart()', t, t);
  END LOOP;
END
$$;
