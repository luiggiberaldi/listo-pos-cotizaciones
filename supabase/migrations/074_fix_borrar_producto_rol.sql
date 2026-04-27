-- 074_fix_borrar_producto_rol.sql
-- borrar_producto_con_kardex checked u.rol = 'supervisor' directly,
-- excluding 'desarrollador' (mapped to supervisor) and 'administracion'.
-- Fix: use get_rol_actual() and accept both 'supervisor' and 'administracion'.

CREATE OR REPLACE FUNCTION public.borrar_producto_con_kardex(p_producto_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores o administración pueden borrar productos';
  END IF;

  SELECT * INTO v_producto
  FROM public.productos WHERE id = p_producto_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  v_lote_id := gen_random_uuid();
  INSERT INTO public.inventario_movimientos
    (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
     cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
  VALUES
    (v_lote_id, 'egreso', 'Producto eliminado del sistema', 'ajuste_inventario',
     v_producto.id, v_producto.nombre, GREATEST(v_producto.stock_actual, 0),
     v_producto.stock_actual, 0,
     v_usuario_id, v_usuario_nombre, v_usuario_color);

  DELETE FROM public.productos WHERE id = p_producto_id;
END;
$$;
