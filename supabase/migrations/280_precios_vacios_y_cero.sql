-- 280_precios_vacios_y_cero.sql
--
-- Detalle menor del informe de precios (2026-10-24): "los precios no se pueden
-- borrar (dejarlos vacíos no limpia el valor)" + "mostrar el precio 0 tal cual".
--
-- ARREGLO: se fija de forma explícita el contrato de guardado de precios:
--   * precio_2 / precio_3 / porcentajes: envío directo — un campo vacío se
--     guarda como NULL (sí limpia el valor anterior). Antes COALESCE(p_precio_2,
--     precio_2) interpretaba NULL como "conservar" y vaciar no funcionaba.
--   * precio_usd: la columna no admite NULL, así que "vacío" = 0, y el precio 0
--     se muestra y se vende tal cual (ver detalle "precio 0" del mismo informe).
--   * El precio 0 de Precio 2/3 se guarda y viaja como 0 (no se convierte en
--     null; el API lo escondía — arreglado en el Worker).
--
-- Cuerpo: el vivo de supabase/release/main/05_inventory_guardrails_and_reconciliation.sql
-- (definición canónica de actualizar_producto_con_kardex_tenant_safe, la RPC que
-- usa /api/productos/actualizar) salvo por las líneas de precios del UPDATE.
-- Si el cuerpo vivo se reescribe desde un backup con semántica COALESCE
-- (null = conservar), vaciar un precio deja de funcionar: esta migración lo
-- vuelve a fijar.
-- Rollback: supabase/migrations/280_precios_vacios_y_cero_rollback.sql
-- (restaura la pre-imagen exacta del cuerpo previo; ver cabecera del archivo).

BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex_tenant_safe(
  p_cuenta_id          UUID,
  p_usuario_id         UUID,
  p_producto_id        UUID,
  p_usuario_nombre     TEXT DEFAULT NULL,
  p_usuario_color      TEXT DEFAULT NULL,
  p_codigo             TEXT DEFAULT NULL,
  p_nombre             TEXT DEFAULT NULL,
  p_descripcion        TEXT DEFAULT NULL,
  p_categoria          TEXT DEFAULT NULL,
  p_unidad             TEXT DEFAULT NULL,
  p_precio_usd         NUMERIC DEFAULT NULL,
  p_costo_usd          NUMERIC DEFAULT NULL,
  p_stock_actual       NUMERIC DEFAULT NULL,
  p_stock_minimo       NUMERIC DEFAULT NULL,
  p_imagen_url         TEXT DEFAULT NULL,
  p_precio_2           NUMERIC DEFAULT NULL,
  p_precio_3           NUMERIC DEFAULT NULL,
  p_precio1_porcentaje NUMERIC DEFAULT NULL,
  p_precio2_porcentaje NUMERIC DEFAULT NULL,
  p_precio3_porcentaje NUMERIC DEFAULT NULL,
  p_idempotency_key    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor           RECORD;
  v_producto        RECORD;
  v_old_stock       NUMERIC(12,4);
  v_new_stock       NUMERIC(12,4);
  v_diff            NUMERIC(12,4);
  v_allow_negative  BOOLEAN := FALSE;
  v_lote_id         UUID;
  v_guard           JSONB;
  v_resultado       JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_usuario_id IS NULL OR p_producto_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_PRODUCTO_ACTUALIZAR_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'product_update'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol
  INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE
    AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_PRODUCTO_NO_AUTORIZADO'; END IF;

  SELECT * INTO v_producto
  FROM public.productos
  WHERE id = p_producto_id AND cuenta_id = p_cuenta_id AND activo = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE'; END IF;

  v_old_stock := COALESCE(v_producto.stock_actual, 0);
  v_new_stock := COALESCE(p_stock_actual, v_old_stock);
  IF v_new_stock < 0 THEN
    SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
    INTO v_allow_negative
    FROM public.configuracion_negocio cn WHERE cn.cuenta_id = p_cuenta_id LIMIT 1;
    IF NOT v_allow_negative THEN RAISE EXCEPTION 'STOCK_NEGATIVO_NO_PERMITIDO'; END IF;
  END IF;
  v_diff := ROUND((v_new_stock - v_old_stock)::NUMERIC, 4);

  -- 280: contrato de precios (vacío = NULL = limpiado; precio 0 = válido).
  UPDATE public.productos
  SET codigo = COALESCE(NULLIF(btrim(p_codigo), ''), codigo),
      nombre = COALESCE(NULLIF(btrim(p_nombre), ''), nombre),
      descripcion = CASE WHEN p_descripcion IS NULL THEN descripcion ELSE NULLIF(btrim(p_descripcion), '') END,
      categoria = CASE WHEN p_categoria IS NULL THEN categoria ELSE NULLIF(btrim(p_categoria), '') END,
      unidad = COALESCE(NULLIF(btrim(p_unidad), ''), unidad),
      precio_usd = COALESCE(p_precio_usd, 0),
      costo_usd = COALESCE(p_costo_usd, costo_usd),
      stock_actual = v_new_stock,
      stock_minimo = COALESCE(p_stock_minimo, stock_minimo),
      imagen_url = CASE WHEN p_imagen_url IS NULL THEN imagen_url ELSE NULLIF(btrim(p_imagen_url), '') END,
      precio_2 = p_precio_2,
      precio_3 = p_precio_3,
      precio1_porcentaje = p_precio1_porcentaje,
      precio2_porcentaje = p_precio2_porcentaje,
      precio3_porcentaje = p_precio3_porcentaje,
      actualizado_en = now()
  WHERE id = p_producto_id;

  IF v_diff <> 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id,
      CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
      'Ajuste de stock al editar producto', 'ajuste_inventario',
      p_producto_id, COALESCE(NULLIF(btrim(p_nombre), ''), v_producto.nombre),
      abs(v_diff), v_old_stock, v_new_stock, v_actor.id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor.nombre),
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'product_update', p_producto_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );
  END IF;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'id', p_producto_id, 'stock_anterior', v_old_stock,
    'stock_nuevo', v_new_stock, 'lote_id', v_lote_id,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
