-- ═══════════════════════════════════════════════════════════════════════════
-- 051: Fix kardex egresos al crear despacho + stock comprometido correcto
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEMA 1: crear_nota_despacho descuenta stock pero no registra egreso en
--             inventario_movimientos → el kardex siempre muestra 0 egresos.
--
-- PROBLEMA 2: obtener_stock_comprometido cuenta cotizaciones en estado
--             'enviada'/'aceptada' sin excluir las que ya tienen despacho
--             activo → el producto sigue mostrando "comprometido" aunque
--             ya salió del inventario.
--
-- APLICAR EN: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Agregar valor 'venta' al enum motivo_movimiento ─────────────────────
ALTER TYPE motivo_movimiento ADD VALUE IF NOT EXISTS 'venta';

-- ─── 2. Recrear crear_nota_despacho con registro de kardex ──────────────────
CREATE OR REPLACE FUNCTION public.crear_nota_despacho(
  p_cotizacion_id  UUID,
  p_notas          TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_cotizacion     RECORD;
  v_item           RECORD;
  v_stock_actual   NUMERIC;
  v_stock_antes    NUMERIC(10,2);
  v_stock_nuevo    NUMERIC(10,2);
  v_despacho_id    UUID;
  v_lote_id        UUID := gen_random_uuid();
BEGIN
  -- 1. Solo supervisores activos
  SELECT nombre, color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden crear notas de despacho';
  END IF;

  -- 2. Bloquear y obtener la cotización
  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Validar estado
  IF v_cotizacion.estado NOT IN ('enviada', 'aceptada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar enviada o aceptada para despachar';
  END IF;

  IF v_cotizacion.estado = 'enviada' THEN
    UPDATE public.cotizaciones SET estado = 'aceptada' WHERE id = p_cotizacion_id;
  END IF;

  -- 4. Idempotencia
  IF EXISTS (SELECT 1 FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id) THEN
    RAISE EXCEPTION 'DESPACHO_EXISTENTE: Ya existe una nota de despacho para esta cotización';
  END IF;

  -- 5. Primera pasada: validar stock de todos los productos
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_item.producto_id AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO: El producto "%" ya no existe o está inactivo', v_item.nombre_snap;
    END IF;

    IF v_stock_actual < v_item.cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" requiere % pero solo hay % disponible',
        v_item.nombre_snap, v_item.cantidad, v_stock_actual;
    END IF;
  END LOOP;

  -- 6. Crear la nota de despacho con el mismo número que la cotización
  INSERT INTO public.notas_despacho (
    numero, cotizacion_id, cliente_id, vendedor_id, transportista_id,
    estado, total_usd, notas, creado_por
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_cotizacion.numero,
    p_cotizacion_id, v_cotizacion.cliente_id, v_cotizacion.vendedor_id,
    v_cotizacion.transportista_id,
    'pendiente', v_cotizacion.total_usd, p_notas, v_usuario_id
  )
  RETURNING id INTO v_despacho_id;

  -- 7. Segunda pasada: descontar stock Y registrar kardex egreso
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_antes
    FROM public.productos
    WHERE id = v_item.producto_id;

    v_stock_nuevo := v_stock_antes - v_item.cantidad;

    UPDATE public.productos
    SET stock_actual = v_stock_nuevo,
        actualizado_en = now()
    WHERE id = v_item.producto_id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color
    ) VALUES (
      v_lote_id,
      'egreso',
      'Nota de despacho #' || v_cotizacion.numero,
      'venta',
      v_item.producto_id, v_item.nombre_snap,
      v_item.cantidad, v_stock_antes, v_stock_nuevo,
      v_usuario_id, v_usuario_nombre, v_usuario_color
    );
  END LOOP;

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := v_despacho_id,
    p_meta           := jsonb_build_object(
      'cotizacion_id', p_cotizacion_id,
      'total_usd', v_cotizacion.total_usd
    )
  );

  RETURN v_despacho_id;
END;
$$;

-- ─── 3. Excluir cotizaciones despachadas del stock comprometido ──────────────
CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido()
RETURNS TABLE (
  producto_id        UUID,
  total_comprometido NUMERIC(12,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ci.producto_id,
    SUM(ci.cantidad) AS total_comprometido
  FROM public.cotizacion_items ci
  JOIN public.cotizaciones c ON c.id = ci.cotizacion_id
  WHERE c.estado IN ('enviada', 'aceptada')
    AND ci.producto_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = c.id
        AND nd.estado != 'anulada'
    )
  GROUP BY ci.producto_id;
$$;

-- ─── 4. Misma corrección en el detalle ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido_detalle(p_producto_id UUID DEFAULT NULL)
RETURNS TABLE (
  producto_id       UUID,
  producto_nombre   TEXT,
  cantidad          NUMERIC(10,2),
  vendedor_id       UUID,
  vendedor_nombre   TEXT,
  cotizacion_id     UUID,
  cotizacion_numero TEXT,
  cotizacion_estado TEXT,
  cotizacion_fecha  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ci.producto_id,
    ci.nombre_snap AS producto_nombre,
    ci.cantidad,
    c.vendedor_id,
    u.nombre AS vendedor_nombre,
    c.id AS cotizacion_id,
    c.numero AS cotizacion_numero,
    c.estado::TEXT AS cotizacion_estado,
    c.creado_en AS cotizacion_fecha
  FROM public.cotizacion_items ci
  JOIN public.cotizaciones c ON c.id = ci.cotizacion_id
  JOIN public.usuarios u ON u.id = c.vendedor_id
  WHERE c.estado IN ('enviada', 'aceptada')
    AND ci.producto_id IS NOT NULL
    AND (p_producto_id IS NULL OR ci.producto_id = p_producto_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = c.id
        AND nd.estado != 'anulada'
    )
  ORDER BY ci.producto_id, c.creado_en DESC;
$$;
