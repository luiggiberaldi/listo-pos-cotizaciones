-- 049: Stock inicial registra movimiento en kardex
-- Cuando se crea un producto con stock > 0, se registra como ingreso automático

CREATE OR REPLACE FUNCTION public.crear_producto_con_kardex(
  p_codigo       TEXT DEFAULT NULL,
  p_nombre       TEXT DEFAULT '',
  p_descripcion  TEXT DEFAULT NULL,
  p_categoria    TEXT DEFAULT NULL,
  p_unidad       TEXT DEFAULT 'und',
  p_precio_usd   NUMERIC DEFAULT 0,
  p_costo_usd    NUMERIC DEFAULT NULL,
  p_stock_actual NUMERIC DEFAULT 0,
  p_stock_minimo NUMERIC DEFAULT 0,
  p_imagen_url   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  -- Validar supervisor activo
  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true AND u.rol = 'supervisor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo supervisores pueden crear productos';
  END IF;

  -- Insertar producto
  INSERT INTO public.productos
    (codigo, nombre, descripcion, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, imagen_url)
  VALUES
    (NULLIF(trim(p_codigo), ''), trim(p_nombre), NULLIF(trim(p_descripcion), ''),
     NULLIF(trim(p_categoria), ''), COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
     COALESCE(p_precio_usd, 0), p_costo_usd, COALESCE(p_stock_actual, 0),
     COALESCE(p_stock_minimo, 0), NULLIF(trim(p_imagen_url), ''))
  RETURNING * INTO v_producto;

  -- Si tiene stock inicial > 0, registrar movimiento
  IF v_producto.stock_actual > 0 THEN
    v_lote_id := gen_random_uuid();

    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id, 'ingreso', 'Stock inicial al crear producto', 'ajuste_inventario',
       v_producto.id, v_producto.nombre, v_producto.stock_actual, 0, v_producto.stock_actual,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_producto_con_kardex(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT)
  TO authenticated;

-- También para actualización de stock: registrar cambio en kardex
CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex(
  p_id           UUID,
  p_codigo       TEXT DEFAULT NULL,
  p_nombre       TEXT DEFAULT '',
  p_descripcion  TEXT DEFAULT NULL,
  p_categoria    TEXT DEFAULT NULL,
  p_unidad       TEXT DEFAULT 'und',
  p_precio_usd   NUMERIC DEFAULT 0,
  p_costo_usd    NUMERIC DEFAULT NULL,
  p_stock_actual NUMERIC DEFAULT 0,
  p_stock_minimo NUMERIC DEFAULT 0,
  p_imagen_url   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_old_stock      NUMERIC(10,2);
  v_new_stock      NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  -- Validar supervisor activo
  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true AND u.rol = 'supervisor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo supervisores pueden editar productos';
  END IF;

  -- Obtener stock anterior
  SELECT stock_actual INTO v_old_stock
  FROM public.productos
  WHERE id = p_id AND activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  v_new_stock := COALESCE(p_stock_actual, 0);
  v_diff := v_new_stock - v_old_stock;

  -- Actualizar producto
  UPDATE public.productos SET
    codigo       = NULLIF(trim(p_codigo), ''),
    nombre       = trim(p_nombre),
    descripcion  = NULLIF(trim(p_descripcion), ''),
    categoria    = NULLIF(trim(p_categoria), ''),
    unidad       = COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
    precio_usd   = COALESCE(p_precio_usd, 0),
    costo_usd    = p_costo_usd,
    stock_actual = v_new_stock,
    stock_minimo = COALESCE(p_stock_minimo, 0),
    imagen_url   = NULLIF(trim(p_imagen_url), ''),
    actualizado_en = now()
  WHERE id = p_id
  RETURNING * INTO v_producto;

  -- Si cambió el stock, registrar movimiento
  IF v_diff != 0 THEN
    v_lote_id := gen_random_uuid();

    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id,
       CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
       'Ajuste de stock al editar producto',
       'ajuste_inventario',
       v_producto.id, v_producto.nombre,
       abs(v_diff), v_old_stock, v_new_stock,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT)
  TO authenticated;
