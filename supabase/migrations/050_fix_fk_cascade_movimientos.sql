-- 050: Fix FK constraint para permitir borrar productos con movimientos
-- Antes: borrar un producto con kardex daba 409 Conflict por FK constraint
-- Ahora: CASCADE borra automáticamente los movimientos asociados

ALTER TABLE public.inventario_movimientos
  DROP CONSTRAINT IF EXISTS inventario_movimientos_producto_id_fkey;

ALTER TABLE public.inventario_movimientos
  ADD CONSTRAINT inventario_movimientos_producto_id_fkey
  FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;
