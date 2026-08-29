-- 248_staging_inventory_guardrails.sql
--
-- Hardening final de staging para los caminos que todavía dependían de RPCs
-- históricas de producto o de DELETE separados. No aplicar en producción sin
-- revisar firmas, permisos y un backup del proyecto destino.

BEGIN;

-- Completa la trazabilidad de cualquier movimiento nuevo, incluso cuando una
-- RPC histórica todavía no envía las columnas añadidas en 246/247.
CREATE OR REPLACE FUNCTION public.enriquecer_proveniencia_kardex_staging()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero  TEXT;
  v_cuenta  UUID;
BEGIN
  IF NEW.cuenta_id IS NULL AND NEW.producto_id IS NOT NULL THEN
    SELECT p.cuenta_id
      INTO v_cuenta
    FROM public.productos p
    WHERE p.id = NEW.producto_id;
    NEW.cuenta_id := v_cuenta;
  END IF;

  IF NEW.origen_tipo IS NULL THEN
    NEW.origen_tipo := CASE COALESCE(NEW.motivo_tipo::TEXT, 'otro')
      WHEN 'venta' THEN 'despacho'
      WHEN 'devolucion' THEN 'devolucion'
      WHEN 'ajuste_inventario' THEN 'ajuste_inventario'
      WHEN 'compra_proveedor' THEN 'compra'
      WHEN 'transferencia' THEN 'transferencia'
      ELSE 'otro'
    END;
  END IF;

  IF NEW.origen_id IS NULL THEN
    NEW.origen_id := NEW.lote_id;
  END IF;

  -- Para operaciones históricas que no reciben una clave de cliente, el lote
  -- es la identidad mínima de la operación. Los wrappers nuevos sustituyen
  -- este valor por la clave de idempotencia enviada por el cliente.
  IF NEW.idempotency_key IS NULL THEN
    NEW.idempotency_key := NEW.lote_id;
  END IF;

  IF NEW.origen_referencia IS NULL THEN
    v_numero := substring(COALESCE(NEW.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)');
    IF v_numero IS NOT NULL THEN
      NEW.origen_referencia := 'despacho_numero:' || v_numero;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_proveniencia_kardex_staging
  ON public.inventario_movimientos;
CREATE TRIGGER trg_enriquecer_proveniencia_kardex_staging
  BEFORE INSERT ON public.inventario_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.enriquecer_proveniencia_kardex_staging();

-- Producto create/update/delete: el código de staging usa estas fachadas para
-- verificar tenant antes de delegar la lógica financiera ya existente. Las
-- fachadas conservan la firma canónica de 233 y evitan overloads PostgREST.
CREATE OR REPLACE FUNCTION public.crear_producto_con_kardex_staging(
  p_codigo TEXT DEFAULT NULL,
  p_nombre TEXT DEFAULT '',
  p_descripcion TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL,
  p_unidad TEXT DEFAULT 'und',
  p_precio_usd NUMERIC DEFAULT 0,
  p_costo_usd NUMERIC DEFAULT NULL,
  p_stock_actual NUMERIC DEFAULT 0,
  p_stock_minimo NUMERIC DEFAULT 0,
  p_imagen_url TEXT DEFAULT NULL,
  p_precio_2 NUMERIC DEFAULT NULL,
  p_precio_3 NUMERIC DEFAULT NULL,
  p_precio1_porcentaje NUMERIC DEFAULT NULL,
  p_precio2_porcentaje NUMERIC DEFAULT NULL,
  p_precio3_porcentaje NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID := auth.uid();
BEGIN
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_STAGING_NO_ENCONTRADA';
  END IF;

  RETURN public.crear_producto_con_kardex(
    p_codigo, p_nombre, p_descripcion, p_categoria, p_unidad,
    p_precio_usd, p_costo_usd, p_stock_actual, p_stock_minimo,
    p_imagen_url, p_precio_2, p_precio_3,
    p_precio1_porcentaje, p_precio2_porcentaje, p_precio3_porcentaje
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex_staging(
  p_id UUID,
  p_codigo TEXT DEFAULT NULL,
  p_nombre TEXT DEFAULT '',
  p_descripcion TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL,
  p_unidad TEXT DEFAULT 'und',
  p_precio_usd NUMERIC DEFAULT 0,
  p_costo_usd NUMERIC DEFAULT NULL,
  p_stock_actual NUMERIC DEFAULT 0,
  p_stock_minimo NUMERIC DEFAULT 0,
  p_imagen_url TEXT DEFAULT NULL,
  p_precio_2 NUMERIC DEFAULT NULL,
  p_precio_3 NUMERIC DEFAULT NULL,
  p_precio1_porcentaje NUMERIC DEFAULT NULL,
  p_precio2_porcentaje NUMERIC DEFAULT NULL,
  p_precio3_porcentaje NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID := auth.uid();
BEGIN
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_STAGING_NO_ENCONTRADA';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.productos
    WHERE id = p_id
      AND cuenta_id = v_cuenta_id
      AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'PRODUCTO_STAGING_NO_DISPONIBLE';
  END IF;

  RETURN public.actualizar_producto_con_kardex(
    p_id, p_codigo, p_nombre, p_descripcion, p_categoria, p_unidad,
    p_precio_usd, p_costo_usd, p_stock_actual, p_stock_minimo,
    p_imagen_url, p_precio_2, p_precio_3,
    p_precio1_porcentaje, p_precio2_porcentaje, p_precio3_porcentaje
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.borrar_producto_con_kardex_staging(
  p_producto_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID := auth.uid();
BEGIN
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_STAGING_NO_ENCONTRADA';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.productos
    WHERE id = p_producto_id
      AND cuenta_id = v_cuenta_id
  ) THEN
    RAISE EXCEPTION 'PRODUCTO_STAGING_NO_DISPONIBLE';
  END IF;

  PERFORM public.borrar_producto_con_kardex(p_producto_id);
END;
$$;

-- Limpieza total de inventario como una sola transacción. Se usa únicamente
-- desde el Worker autenticado y conserva la semántica existente: al borrar el
-- catálogo también se borra su Kardex, pero nunca queda una mitad aplicada.
CREATE OR REPLACE FUNCTION public.limpiar_inventario_atomico_staging(
  p_cuenta_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movimientos INTEGER := 0;
  v_productos INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_STAGING_OBLIGATORIA';
  END IF;

  DELETE FROM public.inventario_movimientos m
  WHERE m.cuenta_id = p_cuenta_id
     OR (m.cuenta_id IS NULL AND m.producto_id IN (
       SELECT p.id FROM public.productos p WHERE p.cuenta_id = p_cuenta_id
     ));
  GET DIAGNOSTICS v_movimientos = ROW_COUNT;

  DELETE FROM public.productos
  WHERE cuenta_id = p_cuenta_id;
  GET DIAGNOSTICS v_productos = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'cuenta_id', p_cuenta_id,
    'movimientos_eliminados', v_movimientos,
    'productos_eliminados', v_productos,
    'transaccion_atomica', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crear_producto_con_kardex_staging(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.actualizar_producto_con_kardex_staging(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.borrar_producto_con_kardex_staging(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.limpiar_inventario_atomico_staging(UUID)
  FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_producto_con_kardex_staging(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex_staging(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.borrar_producto_con_kardex_staging(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpiar_inventario_atomico_staging(UUID)
  TO service_role;

-- Después de migrar el código, las firmas históricas no se exponen a
-- authenticated; el Worker y la UI deben pasar por las fachadas tenant-safe.
REVOKE EXECUTE ON FUNCTION public.crear_producto_con_kardex(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.actualizar_producto_con_kardex(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.borrar_producto_con_kardex(UUID)
  FROM authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
