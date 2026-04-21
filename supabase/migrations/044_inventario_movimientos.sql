-- 044: Tabla de movimientos de inventario (ingreso/egreso por lotes)
-- y RPC atómica para aplicar movimientos en batch

-- ─── Tipo de movimiento ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tipo_movimiento AS ENUM ('ingreso', 'egreso');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Tabla de movimientos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventario_movimientos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id         UUID NOT NULL,
  tipo            tipo_movimiento NOT NULL,
  motivo          TEXT NOT NULL CHECK (char_length(trim(motivo)) > 0),
  producto_id     UUID NOT NULL REFERENCES public.productos(id),
  producto_nombre TEXT NOT NULL,
  cantidad        NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  stock_anterior  NUMERIC(10,2) NOT NULL,
  stock_nuevo     NUMERIC(10,2) NOT NULL,
  usuario_id      UUID NOT NULL REFERENCES public.usuarios(id),
  usuario_nombre  TEXT NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mov_creado    ON public.inventario_movimientos(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_mov_producto  ON public.inventario_movimientos(producto_id);
CREATE INDEX IF NOT EXISTS idx_mov_lote      ON public.inventario_movimientos(lote_id);
CREATE INDEX IF NOT EXISTS idx_mov_tipo      ON public.inventario_movimientos(tipo);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventario_movimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY movimientos_supervisor_select ON public.inventario_movimientos
  FOR SELECT USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY movimientos_supervisor_insert ON public.inventario_movimientos
  FOR INSERT WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Append-only: no UPDATE ni DELETE

-- ─── RPC: Aplicar movimiento por lotes (atómico) ────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_movimiento_lote(
  p_tipo   tipo_movimiento,
  p_motivo TEXT,
  p_items  JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lote_id        UUID := gen_random_uuid();
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_item           JSONB;
  v_producto       RECORD;
  v_cantidad       NUMERIC(10,2);
  v_nuevo_stock    NUMERIC(10,2);
BEGIN
  -- Validar que sea supervisor activo
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo = true AND rol = 'supervisor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo supervisores pueden ejecutar movimientos de inventario';
  END IF;

  IF p_motivo IS NULL OR char_length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC(10,2);

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    -- Bloquear fila del producto para evitar condiciones de carrera
    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = (v_item->>'producto_id')::UUID AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado o inactivo';
    END IF;

    IF p_tipo = 'egreso' THEN
      v_nuevo_stock := v_producto.stock_actual - v_cantidad;
      IF v_nuevo_stock < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": tiene % y se intenta retirar %',
          v_producto.nombre, v_producto.stock_actual, v_cantidad;
      END IF;
    ELSE
      v_nuevo_stock := v_producto.stock_actual + v_cantidad;
    END IF;

    -- Actualizar stock del producto
    UPDATE public.productos
    SET stock_actual = v_nuevo_stock, actualizado_en = now()
    WHERE id = v_producto.id;

    -- Registrar movimiento
    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, producto_id, producto_nombre, cantidad,
       stock_anterior, stock_nuevo, usuario_id, usuario_nombre)
    VALUES
      (v_lote_id, p_tipo, trim(p_motivo), v_producto.id, v_producto.nombre, v_cantidad,
       v_producto.stock_actual, v_nuevo_stock, v_usuario_id, v_usuario_nombre);
  END LOOP;

  RETURN v_lote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_lote(tipo_movimiento, TEXT, JSONB)
  TO authenticated;
