-- 036_rpc_comisiones.sql
-- RPCs para cálculo y pago de comisiones
-- + Modificación de actualizar_estado_despacho para calcular comisión al entregar

-- ============================================================
-- RPC 1: calcular_comision_despacho
-- Calcula y registra la comisión de un despacho entregado
-- Idempotente: si ya existe comisión, no hace nada
-- ============================================================
CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(
  p_despacho_id UUID
)
RETURNS UUID  -- Retorna el ID de la comisión creada, o NULL si ya existía
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho       RECORD;
  v_config         RECORD;
  v_monto_cabilla  NUMERIC(12,2) := 0;
  v_monto_otros    NUMERIC(12,2) := 0;
  v_item           RECORD;
  v_cat_cabilla    TEXT;
  v_comision_id    UUID;
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despacho_id = p_despacho_id) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho
  SELECT nd.*, c.vendedor_id AS cot_vendedor_id
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  WHERE nd.id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- Obtener configuración de tasas
  SELECT comision_pct_cabilla, comision_pct_otros, comision_categoria_cabilla
  INTO v_config
  FROM public.configuracion_negocio
  WHERE id = 1;

  v_cat_cabilla := lower(trim(v_config.comision_categoria_cabilla));

  -- Recorrer items de la cotización y clasificar por categoría
  FOR v_item IN
    SELECT ci.total_linea_usd, p.categoria
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id
  LOOP
    IF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
      v_monto_cabilla := v_monto_cabilla + COALESCE(v_item.total_linea_usd, 0);
    ELSE
      v_monto_otros := v_monto_otros + COALESCE(v_item.total_linea_usd, 0);
    END IF;
  END LOOP;

  -- Insertar comisión
  INSERT INTO public.comisiones (
    despacho_id, vendedor_id, cotizacion_id,
    monto_cabilla, monto_otros,
    pct_cabilla, pct_otros,
    comision_cabilla, comision_otros, total_comision
  ) VALUES (
    p_despacho_id,
    v_despacho.cot_vendedor_id,
    v_despacho.cotizacion_id,
    v_monto_cabilla,
    v_monto_otros,
    v_config.comision_pct_cabilla,
    v_config.comision_pct_otros,
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2),
    ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2),
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2)
      + ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2)
  )
  RETURNING id INTO v_comision_id;

  RETURN v_comision_id;
END;
$$;


-- ============================================================
-- RPC 2: marcar_comision_pagada
-- Marca una comisión como pagada (solo supervisor)
-- ============================================================
CREATE OR REPLACE FUNCTION public.marcar_comision_pagada(
  p_comision_id UUID
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_comision       RECORD;
BEGIN
  -- Validar supervisor activo
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden marcar comisiones como pagadas';
  END IF;

  -- Bloquear fila
  SELECT * INTO v_comision
  FROM public.comisiones
  WHERE id = p_comision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMISION_NO_ENCONTRADA';
  END IF;

  IF v_comision.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: Esta comisión ya fue marcada como pagada';
  END IF;

  -- Actualizar
  UPDATE public.comisiones
  SET
    estado = 'pagada',
    pagada_en = now(),
    pagada_por = v_usuario_id,
    actualizado_en = now()
  WHERE id = p_comision_id;

  -- Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'PAGAR_COMISION',
    p_entidad_tipo   := 'comision',
    p_entidad_id     := p_comision_id,
    p_meta           := jsonb_build_object(
      'vendedor_id', v_comision.vendedor_id,
      'total_comision', v_comision.total_comision,
      'despacho_id', v_comision.despacho_id
    )
  );
END;
$$;


-- ============================================================
-- RPC 3: actualizar_estado_despacho (REEMPLAZA versión de 022)
-- Agrega: cálculo de comisión al marcar como entregada
-- ============================================================
CREATE OR REPLACE FUNCTION public.actualizar_estado_despacho(
  p_despacho_id   UUID,
  p_nuevo_estado  TEXT
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_despacho       RECORD;
  v_item           RECORD;
BEGIN
  -- 1. Validar caller: solo supervisores activos
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden actualizar despachos';
  END IF;

  -- 2. Obtener y bloquear el despacho
  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- 3. Validar transición de estado
  IF NOT (
    (v_despacho.estado = 'pendiente'  AND p_nuevo_estado IN ('despachada', 'anulada'))
    OR
    (v_despacho.estado = 'despachada' AND p_nuevo_estado IN ('entregada', 'anulada'))
  ) THEN
    RAISE EXCEPTION 'TRANSICION_INVALIDA: No se puede pasar de "%" a "%"',
      v_despacho.estado, p_nuevo_estado;
  END IF;

  -- 4. Si se anula desde pendiente o despachada, restaurar stock
  IF p_nuevo_estado = 'anulada' AND v_despacho.estado IN ('pendiente', 'despachada') THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.cotizacion_items ci
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
        AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.productos
      SET stock_actual = stock_actual + v_item.cantidad
      WHERE id = v_item.producto_id;
    END LOOP;
  END IF;

  -- 5. Actualizar estado
  UPDATE public.notas_despacho
  SET
    estado = p_nuevo_estado,
    despachada_en = CASE WHEN p_nuevo_estado = 'despachada' THEN now() ELSE despachada_en END,
    entregada_en  = CASE WHEN p_nuevo_estado = 'entregada'  THEN now() ELSE entregada_en END
  WHERE id = p_despacho_id;

  -- 6. Si se marcó como entregada, calcular comisión automáticamente
  IF p_nuevo_estado = 'entregada' THEN
    PERFORM public.calcular_comision_despacho(p_despacho_id);
  END IF;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'ACTUALIZAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'estado_anterior', v_despacho.estado,
      'estado_nuevo', p_nuevo_estado,
      'cotizacion_id', v_despacho.cotizacion_id
    )
  );
END;
$$;
