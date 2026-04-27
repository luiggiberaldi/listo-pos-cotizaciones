-- 076_fix_imagen_url_preserve.sql
-- Bug: al editar un producto, el RPC siempre sobreescribe imagen_url.
-- Si p_imagen_url llega NULL (default), borra la foto existente.
-- Fix: usar COALESCE para preservar la imagen existente cuando no se pasa una nueva.
-- La imagen se maneja después del RPC (upload/delete), así que el RPC
-- solo debe preservar lo que ya existe.

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
  p_imagen_url   TEXT DEFAULT NULL,
  p_precio_2     NUMERIC DEFAULT NULL,
  p_precio_3     NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_old_stock      NUMERIC(10,2);
  v_new_stock      NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores o administración pueden editar productos';
  END IF;

  SELECT stock_actual INTO v_old_stock
  FROM public.productos
  WHERE id = p_id AND activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  v_new_stock := COALESCE(p_stock_actual, 0);
  v_diff := v_new_stock - v_old_stock;

  UPDATE public.productos SET
    codigo       = NULLIF(trim(p_codigo), ''),
    nombre       = trim(p_nombre),
    descripcion  = NULLIF(trim(p_descripcion), ''),
    categoria    = NULLIF(trim(p_categoria), ''),
    unidad       = COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
    precio_usd   = COALESCE(p_precio_usd, 0),
    precio_2     = p_precio_2,
    precio_3     = p_precio_3,
    costo_usd    = p_costo_usd,
    stock_actual = v_new_stock,
    stock_minimo = COALESCE(p_stock_minimo, 0),
    -- Preservar imagen existente si no se pasa una nueva
    imagen_url   = COALESCE(NULLIF(trim(p_imagen_url), ''), imagen_url),
    actualizado_en = now()
  WHERE id = p_id
  RETURNING * INTO v_producto;

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
    'precio_2', v_producto.precio_2,
    'precio_3', v_producto.precio_3,
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
