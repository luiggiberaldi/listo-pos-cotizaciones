-- 157_seguimiento_operativo.sql
-- Módulo de Seguimiento Operativo (Notas y Evidencias)

-- 1. Crear tabla de Seguimiento Operativo
CREATE TABLE public.seguimiento_operativo (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       UUID NOT NULL,
  
  -- Relaciones opcionales (debe estar enlazado a cliente, y/o cotización, y/o despacho)
  cliente_id      UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
  cotizacion_id   UUID REFERENCES public.cotizaciones(id) ON DELETE CASCADE,
  despacho_id     UUID REFERENCES public.notas_despacho(id) ON DELETE CASCADE,
  
  -- Autor (Operador del sistema)
  usuario_id      UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  
  -- Clasificación de la novedad
  tipo            TEXT NOT NULL CHECK (tipo IN ('nota', 'incidencia', 'aclaratoria', 'seguimiento', 'evidencia', 'resolucion')),
  prioridad       TEXT NOT NULL DEFAULT 'informativa' CHECK (prioridad IN ('pendiente', 'resuelta', 'informativa', 'urgente')),
  fijada          BOOLEAN NOT NULL DEFAULT false,
  
  -- Contenido
  titulo          TEXT,
  contenido       TEXT NOT NULL,
  imagenes        TEXT[] NOT NULL DEFAULT '{}'::text[],
  
  -- Timestamps
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Índices de rendimiento
CREATE INDEX idx_seguimiento_cuenta ON public.seguimiento_operativo(cuenta_id);
CREATE INDEX idx_seguimiento_cliente ON public.seguimiento_operativo(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX idx_seguimiento_cotizacion ON public.seguimiento_operativo(cotizacion_id) WHERE cotizacion_id IS NOT NULL;
CREATE INDEX idx_seguimiento_despacho ON public.seguimiento_operativo(despacho_id) WHERE despacho_id IS NOT NULL;
CREATE INDEX idx_seguimiento_creado ON public.seguimiento_operativo(fijada DESC, creado_en DESC);

-- 3. Trigger updated_at para actualizar timestamp de edición
CREATE TRIGGER trg_seguimiento_updated
  BEFORE UPDATE ON public.seguimiento_operativo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Modificar set_cuenta_id_smart() para registrar la nueva tabla
CREATE OR REPLACE FUNCTION public.set_cuenta_id_smart()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cuenta_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.cuenta_id := auth.uid();
    RETURN NEW;
  END IF;

  -- Inferencia en el Worker API via relaciones
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
    IF NEW.usuario_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.usuario_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'seguimiento_operativo' THEN
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.clientes WHERE id = NEW.cliente_id;
    ELSIF NEW.cotizacion_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.cotizaciones WHERE id = NEW.cotizacion_id;
    ELSIF NEW.despacho_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.notas_despacho WHERE id = NEW.despacho_id;
    ELSIF NEW.usuario_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.usuario_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Activar RLS y aplicar política restrictiva multitenant a seguimiento_operativo
ALTER TABLE public.seguimiento_operativo ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolation_seguimiento_operativo ON public.seguimiento_operativo
  AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid());

-- Políticas permisivas por rol/usuario dentro de su tenant
CREATE POLICY seguimiento_select ON public.seguimiento_operativo
  FOR SELECT USING (true);

CREATE POLICY seguimiento_insert ON public.seguimiento_operativo
  FOR INSERT WITH CHECK (true);

CREATE POLICY seguimiento_update ON public.seguimiento_operativo
  FOR UPDATE USING (usuario_id = auth.uid() OR public.get_rol_actual() IN ('supervisor', 'administracion', 'jefe', 'desarrollador'));

CREATE POLICY seguimiento_delete ON public.seguimiento_operativo
  FOR DELETE USING (public.get_rol_actual() IN ('supervisor', 'administracion', 'jefe', 'desarrollador'));

-- 6. Habilitar trigger de cuenta_id
CREATE TRIGGER trg_set_cuenta_id_seguimiento
  BEFORE INSERT ON public.seguimiento_operativo
  FOR EACH ROW EXECUTE FUNCTION public.set_cuenta_id_smart();

-- 7. Crear el bucket de storage para evidencias e imágenes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seguimiento_evidencias', 
  'seguimiento_evidencias', 
  true, 
  524288, -- 512 KB
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 524288,
  allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png'];

-- Políticas de RLS en storage.objects para el bucket de seguimiento
DROP POLICY IF EXISTS "Acceso publico lectura evidencias seguimiento" ON storage.objects;
CREATE POLICY "Acceso publico lectura evidencias seguimiento"
  ON storage.objects FOR SELECT USING (bucket_id = 'seguimiento_evidencias');

DROP POLICY IF EXISTS "Permitir insercion de imagenes seguimiento a autenticados" ON storage.objects;
CREATE POLICY "Permitir insercion de imagenes seguimiento a autenticados"
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'seguimiento_evidencias');

DROP POLICY IF EXISTS "Permitir borrar imagenes seguimiento a autenticados" ON storage.objects;
CREATE POLICY "Permitir borrar imagenes seguimiento a autenticados"
  ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'seguimiento_evidencias');

-- 8. Incluir tabla en Realtime para updates reactivos
ALTER PUBLICATION supabase_realtime ADD TABLE public.seguimiento_operativo;
