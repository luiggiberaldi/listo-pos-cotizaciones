-- 048: Kardex profesional
-- Añade correlativos, categorías de motivo, y color de usuario a movimientos

-- ─── 1. Enum de categorías de motivo ────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE motivo_movimiento AS ENUM (
    'compra_proveedor',
    'ajuste_inventario',
    'merma',
    'devolucion',
    'transferencia',
    'otro'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Nuevas columnas ────────────────────────────────────────────────────
-- Correlativo secuencial (MOV-00001)
ALTER TABLE public.inventario_movimientos
  ADD COLUMN IF NOT EXISTS numero INTEGER GENERATED ALWAYS AS IDENTITY;

-- Categoría de motivo
ALTER TABLE public.inventario_movimientos
  ADD COLUMN IF NOT EXISTS motivo_tipo motivo_movimiento NOT NULL DEFAULT 'otro';

-- Color del usuario (denormalizado, sigue patrón de usuario_nombre)
ALTER TABLE public.inventario_movimientos
  ADD COLUMN IF NOT EXISTS usuario_color TEXT DEFAULT NULL;

-- ─── 3. Índice sobre correlativo ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mov_numero ON public.inventario_movimientos(numero DESC);

-- ─── 4. Reemplazar RPC aplicar_movimiento_lote ─────────────────────────────
-- DROP primero por cambio de tipo de retorno (UUID → JSONB)
DROP FUNCTION IF EXISTS public.aplicar_movimiento_lote(tipo_movimiento, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.aplicar_movimiento_lote(
  p_tipo        tipo_movimiento,
  p_motivo      TEXT,
  p_motivo_tipo motivo_movimiento DEFAULT 'otro',
  p_items       JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote_id        UUID := gen_random_uuid();
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_item           JSONB;
  v_producto       RECORD;
  v_cantidad       NUMERIC(10,2);
  v_nuevo_stock    NUMERIC(10,2);
  v_primer_numero  INTEGER;
BEGIN
  -- Validar que sea supervisor activo
  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true AND u.rol = 'supervisor';

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
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id, p_tipo, trim(p_motivo), p_motivo_tipo, v_producto.id, v_producto.nombre,
       v_cantidad, v_producto.stock_actual, v_nuevo_stock, v_usuario_id, v_usuario_nombre, v_usuario_color);
  END LOOP;

  -- Obtener el primer correlativo del lote
  SELECT numero INTO v_primer_numero
  FROM public.inventario_movimientos
  WHERE lote_id = v_lote_id
  ORDER BY numero ASC LIMIT 1;

  RETURN jsonb_build_object('lote_id', v_lote_id, 'numero', v_primer_numero);
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_lote(tipo_movimiento, TEXT, motivo_movimiento, JSONB)
  TO authenticated;

-- ─── 5. Actualizar reiniciar_correlativos ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.reiniciar_correlativos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ALTER SEQUENCE cotizaciones_numero_seq RESTART WITH 1;
  ALTER SEQUENCE notas_despacho_numero_seq RESTART WITH 1;
  ALTER SEQUENCE inventario_movimientos_numero_seq RESTART WITH 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reiniciar_correlativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reiniciar_correlativos() TO authenticated;
