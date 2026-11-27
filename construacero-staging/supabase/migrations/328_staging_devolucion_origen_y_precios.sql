-- 328_staging_devolucion_origen_y_precios.sql — Solo STAGING (OP-2026-095 Fase 3, hallazgo A6)
-- Fortalece registrar_devolucion_inventario_atomica (321):
--   1) Valida que el precio unitario devuelto no supere el precio de la línea del despacho (+0.02).
--   2) Valida que cada fila de intercambio cumpla total_usd ≈ cantidad * precio_unit_usd.
--   3) Guarda origen_tipo = 'devolucion', origen_id = p_despacho_id y origen_referencia = 'DES-...'
--      en inventario_movimientos para dejar de generar filas "sin origen" en el Kardex.
-- Rollback: 328_staging_devolucion_origen_y_precios_rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_devolucion_inventario_atomica(
  p_despacho_id uuid,
  p_devoluciones jsonb,
  p_intercambios jsonb DEFAULT '[]'::jsonb,
  p_motivo text DEFAULT NULL::text,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid,
  p_total_devuelto_usd numeric DEFAULT 0,
  p_total_intercambio_usd numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho       RECORD;
  v_ndi            RECORD;
  v_producto       RECORD;
  v_usuario_fk     UUID;
  v_item           RECORD;
  v_delta          RECORD;
  v_lote_id        UUID := gen_random_uuid();
  v_allow_negative BOOLEAN := FALSE;
  v_nuevo_stock    NUMERIC(12,4);
  v_nuevo_total    NUMERIC(12,4);
  v_movimientos    INTEGER := 0;
  v_desp_ref       TEXT;
BEGIN
  IF p_despacho_id IS NULL
     OR p_devoluciones IS NULL
     OR jsonb_typeof(p_devoluciones) <> 'array'
     OR jsonb_array_length(p_devoluciones) = 0
     OR p_motivo IS NULL
     OR char_length(trim(p_motivo)) = 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_INVALIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: El despacho debe estar entregado';
  END IF;

  v_desp_ref := CASE
    WHEN v_despacho.numero IS NOT NULL THEN 'DES-' || lpad(v_despacho.numero::TEXT, 5, '0')
    ELSE p_despacho_id::TEXT
  END;

  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;

  IF v_usuario_fk IS NULL THEN
    SELECT u.id
    INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre
    LIMIT 1;
  END IF;

  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  CREATE TEMP TABLE tmp_devolucion_deltas (
    producto_id UUID NOT NULL,
    nombre_snap TEXT NOT NULL,
    tipo_operacion TEXT NOT NULL CHECK (tipo_operacion IN ('ingreso', 'egreso')),
    delta NUMERIC(12,4) NOT NULL DEFAULT 0,
    PRIMARY KEY (producto_id, tipo_operacion)
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_devolucion_solicitudes (
    despacho_item_id UUID PRIMARY KEY,
    cantidad NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_intercambio_solicitudes (
    producto_id UUID PRIMARY KEY,
    cantidad NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_devoluciones) AS x(
      despacho_item_id UUID,
      producto_id UUID,
      nombre_snap TEXT,
      codigo_snap TEXT,
      unidad_snap TEXT,
      cantidad_devuelta NUMERIC,
      precio_unit_usd NUMERIC,
      total_devuelto_usd NUMERIC,
      origen TEXT
    )
  LOOP
    IF v_item.cantidad_devuelta IS NULL OR v_item.cantidad_devuelta <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_DEVOLUCION_INVALIDA: %', v_item.nombre_snap;
    END IF;

    IF v_item.despacho_item_id IS NOT NULL THEN
      SELECT id, producto_id, origen, es_prestamo, cantidad, nombre_snap
      INTO v_ndi
      FROM public.notas_despacho_items
      WHERE id = v_item.despacho_item_id
        AND despacho_id = p_despacho_id;
      IF FOUND AND COALESCE(v_ndi.es_prestamo, FALSE) = TRUE THEN
        RAISE EXCEPTION 'ITEM_PRESTAMO_NO_DEVOLVIBLE_PARCIAL: %', COALESCE(v_ndi.nombre_snap, v_item.nombre_snap);
      END IF;
    END IF;

    IF v_item.producto_id IS NULL THEN
      CONTINUE;
    END IF;

    IF COALESCE(v_item.origen, 'inventario') = 'inventario' THEN
      IF v_item.despacho_item_id IS NULL THEN
        RAISE EXCEPTION 'ITEM_DESPACHO_OBLIGATORIO: %', v_item.nombre_snap;
      END IF;

      INSERT INTO tmp_devolucion_solicitudes (despacho_item_id, cantidad)
      VALUES (v_item.despacho_item_id, v_item.cantidad_devuelta)
      ON CONFLICT (despacho_item_id) DO UPDATE
        SET cantidad = tmp_devolucion_solicitudes.cantidad + EXCLUDED.cantidad;

      IF NOT EXISTS (
        SELECT 1
        FROM public.notas_despacho_items ndi
        WHERE ndi.id = v_item.despacho_item_id
          AND ndi.despacho_id = p_despacho_id
          AND ndi.producto_id = v_item.producto_id
          AND COALESCE(ndi.origen, 'inventario') = 'inventario'
          AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
          AND v_item.cantidad_devuelta <= ndi.cantidad - COALESCE((
            SELECT SUM(dd.cantidad_devuelta)
            FROM public.despacho_devoluciones dd
            WHERE dd.despacho_id = p_despacho_id
              AND dd.despacho_item_id = ndi.id
          ), 0)
      ) THEN
        RAISE EXCEPTION 'SALDO_DEVOLUCION_INVALIDO: %', v_item.nombre_snap;
      END IF;
    ELSIF COALESCE(v_item.origen, '') = 'intercambio' THEN
      INSERT INTO tmp_intercambio_solicitudes (producto_id, cantidad)
      VALUES (v_item.producto_id, v_item.cantidad_devuelta)
      ON CONFLICT (producto_id) DO UPDATE
        SET cantidad = tmp_intercambio_solicitudes.cantidad + EXCLUDED.cantidad;

      IF v_item.cantidad_devuelta > (
        SELECT COALESCE(SUM(di.cantidad), 0)
        FROM public.despacho_devolucion_intercambios di
        WHERE di.despacho_id = p_despacho_id
          AND di.producto_id = v_item.producto_id
      ) - (
        SELECT COALESCE(SUM(dd.cantidad_devuelta), 0)
        FROM public.despacho_devoluciones dd
        WHERE dd.despacho_id = p_despacho_id
          AND dd.despacho_item_id IS NULL
          AND dd.producto_id = v_item.producto_id
      ) THEN
        RAISE EXCEPTION 'SALDO_INTERCAMBIO_INVALIDO: %', v_item.nombre_snap;
      END IF;
    END IF;

    IF COALESCE(v_item.origen, 'inventario') IN ('inventario', 'intercambio') THEN
      INSERT INTO tmp_devolucion_deltas (producto_id, nombre_snap, tipo_operacion, delta)
      VALUES (v_item.producto_id, COALESCE(v_item.nombre_snap, 'Producto'), 'ingreso', v_item.cantidad_devuelta)
      ON CONFLICT (producto_id, tipo_operacion) DO UPDATE
        SET delta = tmp_devolucion_deltas.delta + EXCLUDED.delta;
    END IF;
  END LOOP;

  -- Validaciones de integridad (M4 + OP-2026-095 A6): producto, origen, precio y totales.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(despacho_item_id UUID, producto_id UUID, origen TEXT,
         cantidad_devuelta NUMERIC, precio_unit_usd NUMERIC, total_devuelto_usd NUMERIC)
    JOIN public.notas_despacho_items ndi ON ndi.id = x.despacho_item_id AND ndi.despacho_id = p_despacho_id
    WHERE x.producto_id IS DISTINCT FROM ndi.producto_id
       OR COALESCE(x.origen, 'inventario') IS DISTINCT FROM COALESCE(ndi.origen, 'inventario')
  ) THEN
    RAISE EXCEPTION 'DEVOLUCION_NO_COINCIDE_CON_LINEA_DEL_DESPACHO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(despacho_item_id UUID, precio_unit_usd NUMERIC)
    JOIN public.notas_despacho_items ndi ON ndi.id = x.despacho_item_id AND ndi.despacho_id = p_despacho_id
    WHERE COALESCE(x.precio_unit_usd, 0) > COALESCE(ndi.precio_unit_usd, 0) + 0.02
  ) THEN
    RAISE EXCEPTION 'PRECIO_DEVOLUCION_SUPERA_DESPACHO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(despacho_item_id UUID, cantidad_devuelta NUMERIC,
         precio_unit_usd NUMERIC, total_devuelto_usd NUMERIC)
    WHERE x.despacho_item_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.notas_despacho_items ndi
                      WHERE ndi.id = x.despacho_item_id AND ndi.despacho_id = p_despacho_id)
  ) THEN
    RAISE EXCEPTION 'ITEM_NO_PERTENECE_AL_DESPACHO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(cantidad_devuelta NUMERIC, precio_unit_usd NUMERIC, total_devuelto_usd NUMERIC)
    WHERE COALESCE(x.precio_unit_usd, 0) < 0
       OR abs(COALESCE(x.total_devuelto_usd, 0) - ROUND(COALESCE(x.cantidad_devuelta, 0) * COALESCE(x.precio_unit_usd, 0), 4)) > 0.01
  ) THEN
    RAISE EXCEPTION 'TOTAL_DE_FILA_DEVOLUCION_INCONSISTENTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(cantidad NUMERIC, precio_unit_usd NUMERIC, total_usd NUMERIC)
    WHERE COALESCE(x.precio_unit_usd, 0) < 0
       OR abs(COALESCE(x.total_usd, 0) - ROUND(COALESCE(x.cantidad, 0) * COALESCE(x.precio_unit_usd, 0), 4)) > 0.01
  ) THEN
    RAISE EXCEPTION 'TOTAL_DE_FILA_INTERCAMBIO_INCONSISTENTE';
  END IF;

  IF COALESCE(p_total_devuelto_usd, 0) < 0
     OR COALESCE(p_total_devuelto_usd, 0) > (
       SELECT COALESCE(SUM(x.total_devuelto_usd), 0)
       FROM jsonb_to_recordset(p_devoluciones) AS x(total_devuelto_usd NUMERIC)
     ) + 0.01 THEN
    RAISE EXCEPTION 'TOTAL_DEVUELTO_SUPERA_LAS_FILAS';
  END IF;

  IF abs(COALESCE(p_total_intercambio_usd, 0) - (
       SELECT COALESCE(SUM(COALESCE(x.total_usd, 0)), 0)
       FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(total_usd NUMERIC)
     )) > 0.01 THEN
    RAISE EXCEPTION 'TOTAL_INTERCAMBIO_INCONSISTENTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_devolucion_solicitudes s
    JOIN public.notas_despacho_items ndi ON ndi.id = s.despacho_item_id
    WHERE ndi.despacho_id = p_despacho_id
      AND s.cantidad > ndi.cantidad - COALESCE((
        SELECT SUM(dd.cantidad_devuelta)
        FROM public.despacho_devoluciones dd
        WHERE dd.despacho_id = p_despacho_id
          AND dd.despacho_item_id = ndi.id
      ), 0)
  ) THEN
    RAISE EXCEPTION 'SALDO_DEVOLUCION_INVALIDO: la cantidad solicitada supera el saldo disponible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_intercambio_solicitudes s
    WHERE s.cantidad > (
      SELECT COALESCE(SUM(di.cantidad), 0)
      FROM public.despacho_devolucion_intercambios di
      WHERE di.despacho_id = p_despacho_id
        AND di.producto_id = s.producto_id
    ) - (
      SELECT COALESCE(SUM(dd.cantidad_devuelta), 0)
      FROM public.despacho_devoluciones dd
      WHERE dd.despacho_id = p_despacho_id
        AND dd.despacho_item_id IS NULL
        AND dd.producto_id = s.producto_id
    )
  ) THEN
    RAISE EXCEPTION 'SALDO_INTERCAMBIO_INVALIDO: la cantidad solicitada supera el saldo disponible';
  END IF;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(
      producto_id UUID,
      nombre_snap TEXT,
      codigo_snap TEXT,
      unidad_snap TEXT,
      cantidad NUMERIC,
      precio_unit_usd NUMERIC,
      total_usd NUMERIC,
      stock_actual NUMERIC,
      nuevo_stock NUMERIC
    )
  LOOP
    IF v_item.producto_id IS NULL OR v_item.cantidad IS NULL OR v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'INTERCAMBIO_INVALIDO: %', v_item.nombre_snap;
    END IF;

    INSERT INTO tmp_devolucion_deltas (producto_id, nombre_snap, tipo_operacion, delta)
    VALUES (v_item.producto_id, COALESCE(v_item.nombre_snap, 'Producto'), 'egreso', -v_item.cantidad)
    ON CONFLICT (producto_id, tipo_operacion) DO UPDATE
      SET delta = tmp_devolucion_deltas.delta + EXCLUDED.delta;
  END LOOP;

  FOR v_delta IN
    SELECT producto_id, nombre_snap, tipo_operacion, delta
    FROM tmp_devolucion_deltas
    WHERE delta <> 0
    ORDER BY producto_id, tipo_operacion DESC
  LOOP
    SELECT id, nombre, stock_actual, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_delta.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR (v_delta.tipo_operacion = 'egreso' AND v_producto.activo IS NOT TRUE) THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_delta.nombre_snap;
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + v_delta.delta)::NUMERIC, 4);
    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_PARA_INTERCAMBIO: "%" tiene % y requiere %',
        v_producto.nombre, v_producto.stock_actual, abs(v_delta.delta);
    END IF;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        actualizado_en = now()
    WHERE id = v_producto.id;

    -- OP-2026-095 (A6): registrar origen_tipo/origen_id/origen_referencia en Kardex.
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre, cantidad,
      stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color, cuenta_id,
      origen_tipo, origen_id, origen_referencia
    ) VALUES (
      v_lote_id,
      v_delta.tipo_operacion::tipo_movimiento,
      'Devolución parcial de despacho #' || v_despacho.numero,
      'devolucion',
      v_producto.id,
      COALESCE(v_delta.nombre_snap, v_producto.nombre),
      abs(v_delta.delta),
      COALESCE(v_producto.stock_actual, 0),
      v_nuevo_stock,
      v_usuario_fk,
      trim(p_usuario_nombre),
      p_usuario_color,
      v_producto.cuenta_id,
      'devolucion',
      p_despacho_id,
      v_desp_ref
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  INSERT INTO public.despacho_devoluciones (
    despacho_id, despacho_item_id, producto_id,
    nombre_snap, codigo_snap, unidad_snap,
    cantidad_devuelta, precio_unit_usd, total_devuelto_usd,
    motivo, registrado_por, registrado_por_nombre,
    cotizacion_reemplazo_id
  )
  SELECT
    p_despacho_id,
    x.despacho_item_id,
    x.producto_id,
    COALESCE(x.nombre_snap, 'Producto'),
    x.codigo_snap,
    COALESCE(x.unidad_snap, 'und'),
    x.cantidad_devuelta,
    COALESCE(x.precio_unit_usd, 0),
    COALESCE(x.total_devuelto_usd, 0),
    trim(p_motivo),
    v_usuario_fk,
    trim(p_usuario_nombre),
    p_cotizacion_reemplazo_id
  FROM jsonb_to_recordset(p_devoluciones) AS x(
    despacho_item_id UUID,
    producto_id UUID,
    nombre_snap TEXT,
    codigo_snap TEXT,
    unidad_snap TEXT,
    cantidad_devuelta NUMERIC,
    precio_unit_usd NUMERIC,
    total_devuelto_usd NUMERIC
  );

  INSERT INTO public.despacho_devolucion_intercambios (
    despacho_id, producto_id, nombre_snap, codigo_snap,
    unidad_snap, cantidad, precio_unit_usd, total_usd, registrado_por
  )
  SELECT
    p_despacho_id,
    x.producto_id,
    COALESCE(x.nombre_snap, 'Producto'),
    x.codigo_snap,
    COALESCE(x.unidad_snap, 'und'),
    x.cantidad,
    COALESCE(x.precio_unit_usd, 0),
    COALESCE(x.total_usd, 0),
    v_usuario_fk
  FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(
    producto_id UUID,
    nombre_snap TEXT,
    codigo_snap TEXT,
    unidad_snap TEXT,
    cantidad NUMERIC,
    precio_unit_usd NUMERIC,
    total_usd NUMERIC
  );

  v_nuevo_total := ROUND((COALESCE(v_despacho.total_usd, 0)
    - COALESCE(p_total_devuelto_usd, 0)
    + COALESCE(p_total_intercambio_usd, 0))::NUMERIC, 4);

  UPDATE public.notas_despacho
  SET tiene_devoluciones = TRUE,
      total_usd = v_nuevo_total
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'total_usd', v_nuevo_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_devolucion_inventario_atomica(uuid, jsonb, jsonb, text, uuid, text, text, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_inventario_atomica(uuid, jsonb, jsonb, text, uuid, text, text, uuid, numeric, numeric) TO service_role;

COMMIT;
