-- 158_mejorar_seguimiento.sql
-- Restringir la modificación/eliminación de seguimientos a sus creadores,
-- y permitir que los roles administrativos quiten el fijado (fijada = false).

-- 1. Modificar políticas de eliminación (solo creadores)
DROP POLICY IF EXISTS seguimiento_delete ON public.seguimiento_operativo;
CREATE POLICY seguimiento_delete ON public.seguimiento_operativo
  FOR DELETE USING (usuario_id = auth.uid());

-- 2. Crear función y trigger para validar modificaciones en seguimiento_operativo
CREATE OR REPLACE FUNCTION public.check_seguimiento_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Permitir modificaciones del sistema (cron, service_role, etc.)
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Si es el creador de la nota, permitir cualquier modificación
  IF OLD.usuario_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Si es un rol privilegiado pero NO es el creador, verificar que
  -- la única modificación permitida sea pasar `fijada` de true a false.
  IF public.get_rol_actual() IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    -- Comprobar si se está intentando modificar cualquier campo protegido
    IF (NEW.id IS DISTINCT FROM OLD.id) OR
       (NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id) OR
       (NEW.cliente_id IS DISTINCT FROM OLD.cliente_id) OR
       (NEW.cotizacion_id IS DISTINCT FROM OLD.cotizacion_id) OR
       (NEW.despacho_id IS DISTINCT FROM OLD.despacho_id) OR
       (NEW.usuario_id IS DISTINCT FROM OLD.usuario_id) OR
       (NEW.tipo IS DISTINCT FROM OLD.tipo) OR
       (NEW.prioridad IS DISTINCT FROM OLD.prioridad) OR
       (NEW.titulo IS DISTINCT FROM OLD.titulo) OR
       (NEW.contenido IS DISTINCT FROM OLD.contenido) OR
       (NEW.imagenes IS DISTINCT FROM OLD.imagenes) OR
       (NEW.creado_en IS DISTINCT FROM OLD.creado_en) THEN
      RAISE EXCEPTION 'Solo el creador del seguimiento puede modificar su contenido.';
    END IF;

    -- Solo se permite quitar el fijado (de true a false)
    IF OLD.fijada = false AND NEW.fijada = true THEN
      RAISE EXCEPTION 'Solo el creador del seguimiento puede fijarlo.';
    END IF;

    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'No tiene permisos para modificar este seguimiento.';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Habilitar trigger
DROP TRIGGER IF EXISTS trg_check_seguimiento_update ON public.seguimiento_operativo;
CREATE TRIGGER trg_check_seguimiento_update
  BEFORE UPDATE ON public.seguimiento_operativo
  FOR EACH ROW EXECUTE FUNCTION public.check_seguimiento_update();
