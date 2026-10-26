-- 278_staging_batch_ingest_no_pisa_precios.sql
--
-- El ingreso de lote (batch ingest) reescribía el precio_usd de los productos
-- EXISTENTES con el valor que traía la fila de la lista (pre-cargado al abrir
-- la pantalla). Resultado: "cambio el precio, confirmo, y un momento después
-- vuelve el precio antiguo" — el precio se guardaba bien y otro flujo lo pisaba.
-- (Misma familia de bugs que DES-04161/DES-04243: un flujo escribe datos que
-- otro proceso revierte.)
--
-- ARREGLO: los precios de venta SOLO se fijan al CREAR el producto. Un ingreso
-- de lote a un producto existente únicamente suma (o sobrescribe) existencias y
-- puede actualizar el costo si el operador lo marcó explícitamente. Nunca toca
-- precio_usd, precio_2, precio_3 ni los porcentajes.
--
-- Solo staging. El cuerpo de la función es idéntico al de la migración 246
-- salvo por el UPDATE de productos existentes.
-- Rollback: 278_rollback.sql (restaura el cuerpo de 246 byte a byte).

BEGIN;

CREATE OR REPLACE FUNCTION public.ingresar_lote_inventario_atomico(
  p_cuenta_id      UUID,
  p_motivo         TEXT,
  p_productos      JSONB,
  p_usuario_id     UUID DEFAULT NULL,
  p_usuario_nombre TEXT DEFAULT NULL,
  p_usuario_color  TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT gen_random_uuid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actor_id       UUID;
  v_allow_negative BOOLEAN := FALSE;
  v_lote_id        UUID := gen_random_uuid();
  v_result         JSONB;
  v_existing       JSONB;
  v_nuevo_stock    NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_movimientos    INTEGER := 0;
  v_procesados     INTEGER := 0;
  v_nuevos         INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_motivo IS NULL
     OR char_length(trim(p_motivo)) = 0
     OR p_productos IS NULL
     OR jsonb_typeof(p_productos) <> 'array'
     OR jsonb_array_length(p_productos) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INGESTA_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT resultado
    INTO v_existing
    FROM public.inventario_operaciones_staging
    WHERE cuenta_id = p_cuenta_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND AND v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    IF NOT FOUND THEN
      INSERT INTO public.inventario_operaciones_staging
        (idempotency_key, cuenta_id, operacion_tipo)
      VALUES (p_idempotency_key, p_cuenta_id, 'batch_ingest');
    END IF;
  END IF;

  SELECT u.id
  INTO v_actor_id
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND u.cuenta_id = p_cuenta_id
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    SELECT u.id
    INTO v_actor_id
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id
    LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = p_cuenta_id
  LIMIT 1;

  DROP TABLE IF EXISTS pg_temp.tmp_ingesta_staging;
  CREATE TEMP TABLE tmp_ingesta_staging (
    fila                 INTEGER NOT NULL,
    producto_id          UUID,
    is_nuevo             BOOLEAN NOT NULL,
    codigo               TEXT,
    nombre               TEXT,
    descripcion          TEXT,
    categoria            TEXT,
    unidad               TEXT,
    cantidad             NUMERIC(12,4),
    costo_usd            NUMERIC(12,4),
    precio_usd           NUMERIC(12,4),
    precio_2             NUMERIC(12,4),
    precio_3             NUMERIC(12,4),
    precio1_porcentaje   NUMERIC(12,4),
    precio2_porcentaje   NUMERIC(12,4),
    precio3_porcentaje   NUMERIC(12,4),
    modo_existente       TEXT,
    actualizar_costo     BOOLEAN
  ) ON COMMIT DROP;

  INSERT INTO tmp_ingesta_staging (
    fila, producto_id, is_nuevo, codigo, nombre, descripcion, categoria,
    unidad, cantidad, costo_usd, precio_usd, precio_2, precio_3,
    precio1_porcentaje, precio2_porcentaje, precio3_porcentaje,
    modo_existente, actualizar_costo
  )
  SELECT row_number() OVER ()::INTEGER,
         r.producto_id,
         COALESCE(r.is_nuevo, r.producto_id IS NULL),
         NULLIF(trim(r.codigo), ''),
         NULLIF(trim(r.nombre), ''),
         NULLIF(trim(r.descripcion), ''),
         NULLIF(trim(r.categoria), ''),
         COALESCE(NULLIF(trim(r.unidad), ''), 'und'),
         r.cantidad,
         r.costo_usd,
         r.precio_usd,
         r.precio_2,
         r.precio_3,
         r.precio1_porcentaje,
         r.precio2_porcentaje,
         r.precio3_porcentaje,
         COALESCE(NULLIF(trim(r.modo_existente), ''), 'sumar'),
         COALESCE(r.actualizar_costo, FALSE)
  FROM jsonb_to_recordset(p_productos) AS r(
    producto_id UUID,
    is_nuevo BOOLEAN,
    codigo TEXT,
    nombre TEXT,
    descripcion TEXT,
    categoria TEXT,
    unidad TEXT,
    cantidad NUMERIC,
    costo_usd NUMERIC,
    precio_usd NUMERIC,
    precio_2 NUMERIC,
    precio_3 NUMERIC,
    precio1_porcentaje NUMERIC,
    precio2_porcentaje NUMERIC,
    precio3_porcentaje NUMERIC,
    modo_existente TEXT,
    actualizar_costo BOOLEAN
  );

  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE nombre IS NULL OR cantidad IS NULL OR cantidad <= 0) THEN
    RAISE EXCEPTION 'ITEM_INGESTA_INVALIDO';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE is_nuevo AND producto_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_NUEVO_CON_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE NOT is_nuevo AND producto_id IS NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_EXISTENTE_SIN_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE NOT is_nuevo AND modo_existente NOT IN ('sumar', 'sobrescribir')) THEN
    RAISE EXCEPTION 'MODO_INGESTA_INVALIDO';
  END IF;
  IF EXISTS (SELECT producto_id FROM tmp_ingesta_staging WHERE NOT is_nuevo GROUP BY producto_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'PRODUCTO_REPETIDO_EN_INGESTA';
  END IF;
  IF EXISTS (SELECT codigo FROM tmp_ingesta_staging WHERE is_nuevo AND codigo IS NOT NULL GROUP BY codigo HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'CODIGO_REPETIDO_EN_INGESTA';
  END IF;

  UPDATE tmp_ingesta_staging
  SET producto_id = gen_random_uuid()
  WHERE is_nuevo;

  -- Bloquear y actualizar existentes en orden determinista.
  FOR v_item IN
    SELECT * FROM tmp_ingesta_staging
    WHERE NOT is_nuevo
    ORDER BY producto_id
  LOOP
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_item.producto_id
      AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.producto_id;
    END IF;

    v_nuevo_stock := CASE
      WHEN v_item.modo_existente = 'sobrescribir' THEN v_item.cantidad
      ELSE ROUND((COALESCE(v_producto.stock_actual, 0) + v_item.cantidad)::NUMERIC, 2)
    END;
    v_diff := ROUND((v_nuevo_stock - COALESCE(v_producto.stock_actual, 0))::NUMERIC, 2);

    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" quedaría en %', v_producto.nombre, v_nuevo_stock;
    END IF;

    -- ARREGLO 278: los precios de venta NO se tocan en productos existentes.
    -- Antes se pisaba precio_usd con el valor de la lista (pre-cargado al abrir
    -- la pantalla) y el precio nuevo que el usuario acababa de guardar "volvía"
    -- al antiguo. Los precios solo se fijan en el INSERT de productos nuevos.
    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        costo_usd = CASE WHEN v_item.actualizar_costo THEN COALESCE(v_item.costo_usd, 0) ELSE costo_usd END,
        actualizado_en = now()
    WHERE id = v_producto.id;

    IF v_diff <> 0 THEN
      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
        cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
        usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
        idempotency_key
      ) VALUES (
        v_lote_id,
        CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
        trim(p_motivo),
        CASE WHEN v_item.modo_existente = 'sumar' AND v_diff > 0
          THEN 'compra_proveedor'::motivo_movimiento
          ELSE 'ajuste_inventario'::motivo_movimiento END,
        v_producto.id, v_producto.nombre, abs(v_diff),
        COALESCE(v_producto.stock_actual, 0), v_nuevo_stock,
        v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
        p_usuario_color, p_cuenta_id, 'batch_ingest', v_lote_id,
        'batch_ingest:' || v_item.fila, p_idempotency_key
      );
      v_movimientos := v_movimientos + 1;
    END IF;
    v_procesados := v_procesados + 1;
  END LOOP;

  -- Crear nuevos productos y su ingreso inicial en la misma transacción.
  FOR v_item IN
    SELECT * FROM tmp_ingesta_staging
    WHERE is_nuevo
    ORDER BY fila
  LOOP
    INSERT INTO public.productos (
      id, codigo, nombre, descripcion, categoria, unidad,
      precio_usd, costo_usd, stock_actual, stock_minimo,
      activo, cuenta_id, precio_2, precio_3,
      precio1_porcentaje, precio2_porcentaje, precio3_porcentaje,
      creado_en, actualizado_en
    ) VALUES (
      v_item.producto_id, v_item.codigo, v_item.nombre, v_item.descripcion,
      v_item.categoria, v_item.unidad, COALESCE(v_item.precio_usd, 0),
      COALESCE(v_item.costo_usd, 0), v_item.cantidad, 0, TRUE, p_cuenta_id,
      v_item.precio_2, v_item.precio_3, v_item.precio1_porcentaje,
      v_item.precio2_porcentaje, v_item.precio3_porcentaje, now(), now()
    );

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id, 'ingreso', trim(p_motivo), 'compra_proveedor',
      v_item.producto_id, v_item.nombre, v_item.cantidad, 0, v_item.cantidad,
      v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
      p_usuario_color, p_cuenta_id, 'batch_ingest', v_lote_id,
      'batch_ingest:' || v_item.fila, p_idempotency_key
    );
    v_movimientos := v_movimientos + 1;
    v_procesados := v_procesados + 1;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'procesados', v_procesados,
    'nuevos', v_nuevos,
    'movimientos', v_movimientos,
    'idempotency_key', p_idempotency_key
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE public.inventario_operaciones_staging
    SET resultado = v_result, actualizado_en = now()
    WHERE cuenta_id = p_cuenta_id
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ingresar_lote_inventario_atomico(UUID, TEXT, JSONB, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.ingresar_lote_inventario_atomico(UUID, TEXT, JSONB, UUID, TEXT, TEXT, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
