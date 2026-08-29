-- supabase/migrations/163_add_prestamos_tables.sql
-- Implementación del modelo de datos de Préstamo de Artículos

-- 1. Añadir columnas de préstamos a notas_despacho_items y notas_despacho
ALTER TABLE public.notas_despacho_items 
ADD COLUMN IF NOT EXISTS es_prestamo BOOLEAN DEFAULT FALSE;

ALTER TABLE public.notas_despacho
ADD COLUMN IF NOT EXISTS tiene_prestamos BOOLEAN DEFAULT FALSE;

-- 2. Crear tabla de seguimiento cliente_prestamos
CREATE TABLE IF NOT EXISTS public.cliente_prestamos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    despacho_item_id UUID REFERENCES public.notas_despacho_items(id) ON DELETE CASCADE,
    despacho_id UUID REFERENCES public.notas_despacho(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL,
    cantidad_prestada NUMERIC(12,4) NOT NULL,
    cantidad_devuelta NUMERIC(12,4) DEFAULT 0.0000,
    cantidad_facturada NUMERIC(12,4) DEFAULT 0.0000,
    estado VARCHAR(30) DEFAULT 'pendiente', -- 'pendiente', 'devuelto_parcial', 'devuelto', 'facturado'
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_cliente_prestamos_item UNIQUE (despacho_item_id)
);

-- 3. Crear RLS en cliente_prestamos
ALTER TABLE public.cliente_prestamos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo a operadores autorizados en cliente_prestamos"
ON public.cliente_prestamos
FOR ALL
TO authenticated
USING (TRUE)
WITH CHECK (TRUE);

-- 4. Función de sincronización automática de préstamos de despacho
CREATE OR REPLACE FUNCTION public.sincronizar_prestamos_despacho(p_despacho_id UUID)
RETURNS void AS $$
DECLARE
  v_despacho RECORD;
  v_item RECORD;
  v_tiene_prestamos BOOLEAN := FALSE;
BEGIN
  -- 1. Obtener datos del despacho
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- 2. Si el despacho está en estado 'despachada' o 'entregada', sincronizar préstamos
  IF v_despacho.estado IN ('despachada', 'entregada') THEN
    -- Borrar préstamos de este despacho que ya no existen en los ítems actualizados
    DELETE FROM public.cliente_prestamos cp
    WHERE cp.despacho_id = p_despacho_id
      AND cp.despacho_item_id NOT IN (
        SELECT id FROM public.notas_despacho_items 
        WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
      );

    -- Insertar o actualizar cada ítem que sea préstamo
    FOR v_item IN 
      SELECT * FROM public.notas_despacho_items 
      WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
    LOOP
      INSERT INTO public.cliente_prestamos (
        cliente_id, despacho_item_id, despacho_id, producto_id, cantidad_prestada, estado
      ) VALUES (
        COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id),
        v_item.id,
        p_despacho_id,
        v_item.producto_id,
        v_item.cantidad,
        'pendiente'
      )
      ON CONFLICT (despacho_item_id) DO UPDATE SET
        cantidad_prestada = v_item.cantidad,
        cliente_id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);
    END LOOP;

  ELSE
    -- Si el despacho no está aprobado o entregado (p. ej., pendiente o anulado), eliminar registros de préstamos
    DELETE FROM public.cliente_prestamos WHERE despacho_id = p_despacho_id;
  END IF;

  -- 3. Calcular si existen ítems con es_prestamo = TRUE para este despacho y actualizar tiene_prestamos
  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items 
    WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
  ) INTO v_tiene_prestamos;

  UPDATE public.notas_despacho 
  SET tiene_prestamos = v_tiene_prestamos 
  WHERE id = p_despacho_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Triggers de sincronización automática
CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_despacho()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sincronizar_prestamos_despacho(OLD.despacho_id);
    RETURN OLD;
  ELSE
    PERFORM public.sincronizar_prestamos_despacho(NEW.despacho_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_sincronizar_prestamos_items
AFTER INSERT OR UPDATE OR DELETE ON public.notas_despacho_items
FOR EACH ROW EXECUTE FUNCTION public.tg_sincronizar_prestamos_despacho();

CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_cabecera()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.sincronizar_prestamos_despacho(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_sincronizar_prestamos_despacho
AFTER UPDATE OF estado ON public.notas_despacho
FOR EACH ROW EXECUTE FUNCTION public.tg_sincronizar_prestamos_cabecera();

-- 6. Actualización de la función RPC editar_despacho_profundidad
CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id    UUID,
  p_nuevos_items   JSONB,
  p_usuario_id     UUID     DEFAULT NULL,
  p_usuario_nombre TEXT     DEFAULT 'Sistema',
  p_usuario_rol    TEXT     DEFAULT 'sistema',
  p_forma_pago     TEXT     DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho    RECORD;
  v_item_json   RECORD;
  v_total_items NUMERIC(12,4) := 0;
BEGIN
  -- 1. Validar permisos
  IF p_usuario_rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo administración puede editar despachos a profundidad';
  END IF;

  -- 2. Bloquear despacho
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.estado IN ('entregada', 'anulada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: No se puede editar un despacho %', v_despacho.estado;
  END IF;

  -- 3. Devolver stock anterior al inventario SOLO de productos que sí son del inventario
  UPDATE public.productos p
  SET stock_actual = p.stock_actual + di.cantidad
  FROM public.notas_despacho_items di
  WHERE p.id = di.producto_id 
    AND di.despacho_id = p_despacho_id
    AND di.producto_id IS NOT NULL;

  -- 4. Borrar ítems viejos
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 5. Insertar nuevos ítems y descontar stock
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER, origen TEXT,
    es_prestamo BOOLEAN
  ) LOOP

    -- Validar y descontar stock SOLO si es producto de inventario (física y contablemente sale de almacén)
    IF v_item_json.producto_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.productos
        WHERE id = v_item_json.producto_id AND stock_actual >= v_item_json.cantidad
      ) THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE: El producto "%" no tiene stock suficiente', v_item_json.nombre_snap;
      END IF;

      -- Descontar stock
      UPDATE public.productos
      SET stock_actual = stock_actual - v_item_json.cantidad
      WHERE id = v_item_json.producto_id;
    END IF;

    -- Insertar ítem (si es préstamo, se guarda con total_linea_usd = 0 en el despacho, pero precio unitario original para referencia)
    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original,
      cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden, origen,
      es_prestamo
    ) VALUES (
      p_despacho_id,
      v_item_json.producto_id,
      v_item_json.codigo_snap,
      v_item_json.nombre_snap,
      v_item_json.unidad_snap,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      COALESCE(v_item_json.descuento_pct, 0),
      CASE WHEN COALESCE(v_item_json.es_prestamo, FALSE) THEN 0.0000 
           ELSE (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100)) END,
      v_item_json.orden,
      COALESCE(v_item_json.origen, CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END),
      COALESCE(v_item_json.es_prestamo, FALSE)
    );

    -- Sumar al total financiero del despacho únicamente si NO es un préstamo
    IF NOT COALESCE(v_item_json.es_prestamo, FALSE) THEN
      v_total_items := v_total_items
        + (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100));
    END IF;
  END LOOP;

  -- 6. Recalcular total de la cabecera Y actualizar pagos si se proporcionan
  UPDATE public.notas_despacho
  SET 
    total_usd = v_total_items + COALESCE(flete_usd, 0) + COALESCE(corte_usd, 0) - COALESCE(descuento_total_usd, 0),
    forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
    forma_pago = COALESCE(p_forma_pago, forma_pago)
  WHERE id = p_despacho_id;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := p_usuario_nombre,
    p_usuario_rol    := p_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'total_anterior', v_despacho.total_usd,
      'total_nuevo',    (v_total_items + COALESCE(v_despacho.flete_usd, 0) + COALESCE(v_despacho.corte_usd, 0) - COALESCE(v_despacho.descuento_total_usd, 0)),
      'pagos_actualizados', (p_forma_pago IS NOT NULL)
    )
  );

END;
$$;
