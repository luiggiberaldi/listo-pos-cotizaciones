-- 146_ordenes_compra.sql
-- Creación de tablas para el módulo de Orden de Compra

-- 1. Tabla principal de Órdenes de Compra
CREATE TABLE IF NOT EXISTS public.ordenes_compra (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              INTEGER GENERATED ALWAYS AS IDENTITY,
  proveedor_nombre    TEXT NOT NULL CHECK (char_length(trim(proveedor_nombre)) > 0),
  proveedor_rif       TEXT NOT NULL CHECK (char_length(trim(proveedor_rif)) > 0),
  proveedor_direccion TEXT,
  proveedor_telefono  TEXT,
  proveedor_correo    TEXT,
  proveedor_contacto  TEXT,
  fecha_emision       TIMESTAMPTZ NOT NULL DEFAULT now(),
  condicion_pago      TEXT NOT NULL CHECK (char_length(trim(condicion_pago)) > 0),
  subtotal_usd        NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (subtotal_usd >= 0),
  total_usd           NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (total_usd >= 0),
  notas               TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'aprobada', 'anulada')),
  cuenta_id           UUID,
  vendedor_id         UUID NOT NULL
                      REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabla de Ítems de Órdenes de Compra
CREATE TABLE IF NOT EXISTS public.orden_compra_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id     UUID NOT NULL
                      REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  cantidad            NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  codigo_snap         TEXT,
  descripcion         TEXT NOT NULL CHECK (char_length(trim(descripcion)) > 0),
  unidad              TEXT NOT NULL DEFAULT 'und' CHECK (char_length(trim(unidad)) > 0),
  precio_unit_usd     NUMERIC(12,4) NOT NULL CHECK (precio_unit_usd >= 0),
  total_usd           NUMERIC(12,4) NOT NULL CHECK (total_usd >= 0),
  cuenta_id           UUID,
  orden               INTEGER NOT NULL DEFAULT 0
);

-- 3. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_vendedor ON public.ordenes_compra(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_estado   ON public.ordenes_compra(estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_numero   ON public.ordenes_compra(numero DESC);
CREATE INDEX IF NOT EXISTS idx_orden_compra_items_orden ON public.orden_compra_items(orden_compra_id);

-- 4. Trigger para set_updated_at en ordenes_compra
CREATE TRIGGER trg_ordenes_compra_updated
  BEFORE UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Función de trigger para setear el cuenta_id en ordenes de compra
CREATE OR REPLACE FUNCTION public.set_cuenta_id_purchase_orders()
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

  -- Si es un proceso en background (Worker con Service Key), inferimos a través de relaciones
  IF TG_TABLE_NAME = 'ordenes_compra' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'orden_compra_items' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Registrar triggers para cuenta_id
DROP TRIGGER IF EXISTS trg_set_cuenta_id_ordenes_compra ON public.ordenes_compra;
CREATE TRIGGER trg_set_cuenta_id_ordenes_compra
  BEFORE INSERT ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.set_cuenta_id_purchase_orders();

DROP TRIGGER IF EXISTS trg_set_cuenta_id_orden_compra_items ON public.orden_compra_items;
CREATE TRIGGER trg_set_cuenta_id_orden_compra_items
  BEFORE INSERT ON public.orden_compra_items
  FOR EACH ROW EXECUTE FUNCTION public.set_cuenta_id_purchase_orders();

-- 6. Habilitar RLS
ALTER TABLE public.ordenes_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orden_compra_items ENABLE ROW LEVEL SECURITY;

-- Políticas Restrictivas de Multi-tenant (Aislación total de cuenta_id)
DROP POLICY IF EXISTS isolation_ordenes_compra ON public.ordenes_compra;
CREATE POLICY isolation_ordenes_compra ON public.ordenes_compra 
  AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS isolation_orden_compra_items ON public.orden_compra_items;
CREATE POLICY isolation_orden_compra_items ON public.orden_compra_items 
  AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid());

-- Políticas Permisivas de Roles (Exclusivo para supervisor, jefe, desarrollador)
DROP POLICY IF EXISTS ordenes_compra_rol_all ON public.ordenes_compra;
CREATE POLICY ordenes_compra_rol_all ON public.ordenes_compra
  FOR ALL
  USING (public.get_rol_actual() IN ('supervisor', 'jefe', 'desarrollador'))
  WITH CHECK (public.get_rol_actual() IN ('supervisor', 'jefe', 'desarrollador'));

DROP POLICY IF EXISTS orden_compra_items_rol_all ON public.orden_compra_items;
CREATE POLICY orden_compra_items_rol_all ON public.orden_compra_items
  FOR ALL
  USING (public.get_rol_actual() IN ('supervisor', 'jefe', 'desarrollador'))
  WITH CHECK (public.get_rol_actual() IN ('supervisor', 'jefe', 'desarrollador'));

-- 7. Agregar al Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ordenes_compra;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orden_compra_items;

COMMENT ON TABLE public.ordenes_compra IS 'Órdenes de compra generadas por supervisores para adquirir productos externos de proveedores.';
COMMENT ON TABLE public.orden_compra_items IS 'Artículos e ítems que componen las órdenes de compra.';
