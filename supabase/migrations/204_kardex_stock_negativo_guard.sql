-- Migration 204: Guardarraíl de stock no negativo en la RPC actualizar_producto_con_kardex
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
  v_rol            TEXT;
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_old_stock      NUMERIC(10,2);
  v_new_stock      NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  -- Validar rol permitido (supervisor, administracion, jefe, desarrollador)
  v_rol := public.get_rol_actual();
  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'Solo supervisores, jefes, administración o desarrolladores pueden editar productos';
  END IF;

  -- Guardarraíl: impedir stock negativo
  IF p_stock_actual IS NOT NULL AND p_stock_actual < 0 THEN
    RAISE EXCEPTION 'El stock no puede ser negativo. Valor recibido: %', p_stock_actual;
  END IF;

  -- Obtener usuario
  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id;

  -- Obtener stock anterior
  SELECT * INTO v_producto FROM public.productos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  v_old_stock := COALESCE(v_producto.stock_actual, 0);
  v_new_stock := COALESCE(p_stock_actual, 0);
  v_diff      := v_new_stock - v_old_stock;

  -- Actualizar producto
  UPDATE public.productos SET
    codigo        = COALESCE(p_codigo, codigo),
    nombre        = COALESCE(NULLIF(p_nombre, ''), nombre),
    descripcion   = p_descripcion,
    categoria     = COALESCE(p_categoria, categoria),
    unidad        = COALESCE(p_unidad, unidad),
    precio_usd    = COALESCE(p_precio_usd, precio_usd),
    costo_usd     = COALESCE(p_costo_usd, costo_usd),
    stock_actual  = v_new_stock,
    stock_minimo  = COALESCE(p_stock_minimo, stock_minimo),
    imagen_url    = COALESCE(p_imagen_url, imagen_url),
    actualizado_en = NOW()
  WHERE id = p_id;

  -- Registrar en Kardex si hubo cambio en stock_actual
  IF v_diff <> 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color,
      cuenta_id
    ) VALUES (
      v_lote_id,
      CASE WHEN v_diff > 0 THEN 'ingreso' ELSE 'egreso' END,
      'Ajuste de stock al editar producto',
      'ajuste_inventario',
      p_id,
      COALESCE(NULLIF(p_nombre, ''), v_producto.nombre),
      ABS(v_diff),
      v_old_stock,
      v_new_stock,
      v_usuario_id,
      v_usuario_nombre,
      v_usuario_color,
      v_producto.cuenta_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'stock_anterior', v_old_stock, 'stock_nuevo', v_new_stock);
END;
$$;
