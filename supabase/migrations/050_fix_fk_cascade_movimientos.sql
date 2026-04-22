-- 050: Borrar producto registra en kardex + preserva historial
-- Los movimientos son auditoría y NO se deben borrar con el producto.
-- Al borrar un producto:
--   1. Se registra egreso del stock restante
--   2. producto_id queda NULL en movimientos (ON DELETE SET NULL)
--   3. producto_nombre permanece como snapshot

-- Revertir cualquier CASCADE anterior
ALTER TABLE public.inventario_movimientos
  DROP CONSTRAINT IF EXISTS inventario_movimientos_producto_id_fkey;

-- producto_id puede ser NULL (producto borrado, pero historial persiste)
ALTER TABLE public.inventario_movimientos
  ALTER COLUMN producto_id DROP NOT NULL;

ALTER TABLE public.inventario_movimientos
  ADD CONSTRAINT inventario_movimientos_producto_id_fkey
  FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE SET NULL;

-- RPC para borrar producto con registro en kardex
CREATE OR REPLACE FUNCTION public.borrar_producto_con_kardex(p_producto_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true AND u.rol = 'supervisor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo supervisores pueden borrar productos';
  END IF;

  SELECT * INTO v_producto
  FROM public.productos WHERE id = p_producto_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  -- Siempre registrar eliminación en kardex (incluso con stock 0)
  v_lote_id := gen_random_uuid();
  INSERT INTO public.inventario_movimientos
    (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
     cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
  VALUES
    (v_lote_id, 'egreso', 'Producto eliminado del sistema', 'ajuste_inventario',
     v_producto.id, v_producto.nombre, GREATEST(v_producto.stock_actual, 0),
     v_producto.stock_actual, 0,
     v_usuario_id, v_usuario_nombre, v_usuario_color);

  -- Borrar producto (movimientos quedan con producto_id = NULL, producto_nombre intacto)
  DELETE FROM public.productos WHERE id = p_producto_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.borrar_producto_con_kardex(UUID) TO authenticated;
