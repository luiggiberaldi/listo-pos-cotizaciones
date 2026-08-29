-- 246_staging_kardex_provenance_batch_reconciliation.sql
--
-- Cierra los caminos que todavía podían hacer PATCH de stock y POST de Kardex
-- por separado. También deja una reconciliación histórica reversible por lote.
-- Solo staging: no aplicar en producción sin revisión y backup.

BEGIN;

ALTER TABLE public.inventario_movimientos
  ADD COLUMN IF NOT EXISTS origen_tipo TEXT,
  ADD COLUMN IF NOT EXISTS origen_id UUID,
  ADD COLUMN IF NOT EXISTS origen_referencia TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE INDEX IF NOT EXISTS idx_mov_origen_staging
  ON public.inventario_movimientos(origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS idx_mov_idempotency_staging
  ON public.inventario_movimientos(cuenta_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventario_operaciones_staging (
  idempotency_key UUID NOT NULL,
  cuenta_id       UUID NOT NULL,
  operacion_tipo  TEXT NOT NULL,
  resultado       JSONB,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.kardex_reconciliaciones_staging (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key            UUID NOT NULL,
  ancla_key            TEXT NOT NULL,
  cuenta_id            UUID NOT NULL,
  producto_id          UUID NOT NULL,
  movimiento_ancla_id  UUID,
  movimiento_correctivo_id UUID,
  clase                TEXT NOT NULL,
  delta                NUMERIC(12,4) NOT NULL,
  stock_anterior       NUMERIC(12,4) NOT NULL,
  stock_nuevo          NUMERIC(12,4) NOT NULL,
  motivo               TEXT NOT NULL,
  aplicado_por         UUID,
  aplicado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_key, ancla_key)
);

CREATE INDEX IF NOT EXISTS idx_kardex_recon_staging_producto
  ON public.kardex_reconciliaciones_staging(cuenta_id, producto_id, aplicado_en DESC);

ALTER TABLE public.inventario_operaciones_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kardex_reconciliaciones_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventario_operaciones_staging FROM PUBLIC, authenticated;
REVOKE ALL ON public.kardex_reconciliaciones_staging FROM PUBLIC, authenticated;

-- Las funciones históricas no recibían provenance estructurado. Este trigger
-- al menos clasifica su origen y extrae la referencia visible del despacho,
-- sin modificar filas históricas ni inventar un UUID de origen.
CREATE OR REPLACE FUNCTION public.enriquecer_proveniencia_kardex_staging()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numero TEXT;
BEGIN
  IF NEW.origen_tipo IS NULL THEN
    NEW.origen_tipo := CASE COALESCE(NEW.motivo_tipo::TEXT, 'otro')
      WHEN 'venta' THEN 'despacho'
      WHEN 'devolucion' THEN 'devolucion'
      WHEN 'ajuste_inventario' THEN 'ajuste_inventario'
      WHEN 'compra_proveedor' THEN 'compra'
      WHEN 'transferencia' THEN 'transferencia'
      ELSE 'otro'
    END;
  END IF;

  IF NEW.origen_referencia IS NULL THEN
    v_numero := substring(COALESCE(NEW.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)');
    IF v_numero IS NOT NULL THEN
      NEW.origen_referencia := 'despacho_numero:' || v_numero;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_proveniencia_kardex_staging
  ON public.inventario_movimientos;
CREATE TRIGGER trg_enriquecer_proveniencia_kardex_staging
  BEFORE INSERT ON public.inventario_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.enriquecer_proveniencia_kardex_staging();

-- Ingesta masiva: crea productos nuevos y actualiza existentes bajo el mismo
-- lock/transacción. La categoría enum se mantiene compatible con staging.
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

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        costo_usd = CASE WHEN v_item.actualizar_costo THEN COALESCE(v_item.costo_usd, 0) ELSE costo_usd END,
        precio_usd = CASE WHEN COALESCE(v_item.precio_usd, 0) > 0 THEN v_item.precio_usd ELSE precio_usd END,
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

-- Reconciliación histórica controlada: solo inserta movimientos compensatorios
-- explícitos; nunca actualiza ni borra los movimientos originales.
CREATE OR REPLACE FUNCTION public.reconciliar_kardex_staging(
  p_cuenta_id       UUID,
  p_batch_key       UUID,
  p_propuestas      JSONB,
  p_usuario_id      UUID DEFAULT NULL,
  p_usuario_nombre  TEXT DEFAULT NULL,
  p_usuario_color   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actual         RECORD;
  v_anterior       RECORD;
  v_actor_id       UUID;
  v_lote_id        UUID := gen_random_uuid();
  v_corr_id        UUID;
  v_result         JSONB;
  v_existing       JSONB;
  v_delta          NUMERIC(12,4);
  v_stock_anterior NUMERIC(12,4);
  v_stock_nuevo    NUMERIC(12,4);
  v_insert_time    TIMESTAMPTZ;
  v_ancla_key      TEXT;
  v_aplicados      INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_batch_key IS NULL
     OR p_propuestas IS NULL
     OR jsonb_typeof(p_propuestas) <> 'array'
     OR jsonb_array_length(p_propuestas) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_RECONCILIACION_INVALIDOS';
  END IF;

  SELECT resultado
  INTO v_existing
  FROM public.inventario_operaciones_staging
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_batch_key
  FOR UPDATE;
  IF FOUND AND v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.inventario_operaciones_staging
      (idempotency_key, cuenta_id, operacion_tipo)
    VALUES (p_batch_key, p_cuenta_id, 'kardex_reconciliation');
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
    RAISE EXCEPTION 'USUARIO_RECONCILIACION_NO_ENCONTRADO';
  END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_reconciliacion_staging;
  CREATE TEMP TABLE tmp_reconciliacion_staging (
    clase                    TEXT,
    producto_id              UUID,
    movimiento_id            UUID,
    movimiento_numero       INTEGER,
    movimiento_anterior_id   UUID,
    stock_anterior_esperado  NUMERIC(12,4),
    stock_actual_movimiento  NUMERIC(12,4),
    stock_actual_catalogo    NUMERIC(12,4),
    delta                    NUMERIC(12,4),
    reason                   TEXT
  ) ON COMMIT DROP;

  INSERT INTO tmp_reconciliacion_staging
  SELECT r.clase, r.producto_id, r.movimiento_id, r.movimiento_numero,
         r.movimiento_anterior_id, r.stock_anterior_esperado,
         r.stock_actual_movimiento, r.stock_actual_catalogo, r.delta,
         COALESCE(r.reason, '')
  FROM jsonb_to_recordset(p_propuestas) AS r(
    clase TEXT,
    producto_id UUID,
    movimiento_id UUID,
    movimiento_numero INTEGER,
    movimiento_anterior_id UUID,
    stock_anterior_esperado NUMERIC,
    stock_actual_movimiento NUMERIC,
    stock_actual_catalogo NUMERIC,
    delta NUMERIC,
    reason TEXT
  );

  FOR v_item IN
    SELECT * FROM tmp_reconciliacion_staging
    ORDER BY producto_id, movimiento_numero NULLS LAST, clase
  LOOP
    IF v_item.clase NOT IN ('continuity_gap', 'stock_actual_vs_kardex')
       OR v_item.producto_id IS NULL THEN
      RAISE EXCEPTION 'PROPUESTA_RECONCILIACION_INVALIDA';
    END IF;

    v_ancla_key := CASE
      WHEN v_item.clase = 'continuity_gap' THEN v_item.movimiento_id::TEXT
      ELSE v_item.producto_id::TEXT || ':stock_actual'
    END;

    IF EXISTS (
      SELECT 1 FROM public.kardex_reconciliaciones_staging
      WHERE batch_key = p_batch_key AND ancla_key = v_ancla_key
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_RECONCILIACION_NO_ENCONTRADO: %', v_item.producto_id;
    END IF;

    IF v_item.clase = 'continuity_gap' THEN
      SELECT * INTO v_actual
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_id
        AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'MOVIMIENTO_ANCLA_NO_ENCONTRADO: %', v_item.movimiento_id;
      END IF;

      SELECT * INTO v_anterior
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_anterior_id
        AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'MOVIMIENTO_ANTERIOR_NO_ENCONTRADO: %', v_item.movimiento_anterior_id;
      END IF;

      v_delta := ROUND((v_actual.stock_anterior - v_anterior.stock_nuevo)::NUMERIC, 4);
      IF abs(v_delta - COALESCE(v_item.delta, v_delta)) > 0.01
         OR abs(v_actual.stock_anterior - COALESCE(v_item.stock_actual_movimiento, v_actual.stock_anterior)) > 0.01
         OR abs(v_anterior.stock_nuevo - COALESCE(v_item.stock_anterior_esperado, v_anterior.stock_nuevo)) > 0.01 THEN
        RAISE EXCEPTION 'PROPUESTA_RECONCILIACION_DESACTUALIZADA: %', v_item.movimiento_id;
      END IF;

      v_stock_anterior := v_anterior.stock_nuevo;
      v_stock_nuevo := v_actual.stock_anterior;
      v_insert_time := v_actual.creado_en - interval '1 microsecond';
    ELSE
      SELECT * INTO v_actual
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_id
        AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ULTIMO_MOVIMIENTO_NO_ENCONTRADO: %', v_item.movimiento_id;
      END IF;
      IF abs(COALESCE(v_item.stock_anterior_esperado, v_actual.stock_nuevo) - v_actual.stock_nuevo) > 0.01
         OR abs(COALESCE(v_item.stock_actual_catalogo, v_producto.stock_actual) - v_producto.stock_actual) > 0.01
         OR abs(v_actual.stock_nuevo + COALESCE(v_item.delta, 0) - v_producto.stock_actual) > 0.01 THEN
        RAISE EXCEPTION 'PROPUESTA_STOCK_CATALOGO_DESACTUALIZADA: %', v_item.producto_id;
      END IF;

      v_stock_anterior := v_actual.stock_nuevo;
      v_stock_nuevo := v_producto.stock_actual;
      v_delta := v_stock_nuevo - v_stock_anterior;
      v_insert_time := GREATEST(now(), v_actual.creado_en + interval '1 microsecond');
    END IF;

    IF abs(v_delta) <= 0.01 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key, creado_en
    ) VALUES (
      v_lote_id,
      CASE WHEN v_delta > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
      left('Reconciliación Kardex staging [' || v_item.clase || '] ancla '
        || COALESCE(v_item.movimiento_numero::TEXT, v_item.movimiento_id::TEXT)
        || ': ' || COALESCE(NULLIF(trim(v_item.reason), ''), 'brecha de continuidad'), 500),
      'ajuste_inventario', v_producto.id, v_producto.nombre, abs(v_delta),
      v_stock_anterior, v_stock_nuevo, v_actor_id,
      COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Reconciliación staging'),
      p_usuario_color, p_cuenta_id, 'reconciliacion_kardex',
      COALESCE(v_item.movimiento_id, v_item.producto_id),
      v_ancla_key, p_batch_key, v_insert_time
    )
    RETURNING id INTO v_corr_id;

    INSERT INTO public.kardex_reconciliaciones_staging (
      batch_key, ancla_key, cuenta_id, producto_id, movimiento_ancla_id,
      movimiento_correctivo_id, clase, delta, stock_anterior, stock_nuevo,
      motivo, aplicado_por
    ) VALUES (
      p_batch_key, v_ancla_key, p_cuenta_id, v_producto.id,
      v_item.movimiento_id, v_corr_id, v_item.clase, v_delta,
      v_stock_anterior, v_stock_nuevo,
      left('Reconciliación Kardex staging [' || v_item.clase || '] ' || v_ancla_key, 500),
      v_actor_id
    );
    v_aplicados := v_aplicados + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', TRUE,
    'transaccion_atomica', TRUE,
    'batch_key', p_batch_key,
    'lote_id', v_lote_id,
    'aplicados', v_aplicados
  );

  UPDATE public.inventario_operaciones_staging
  SET resultado = v_result, actualizado_en = now()
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_batch_key;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ingresar_lote_inventario_atomico(UUID, TEXT, JSONB, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.ingresar_lote_inventario_atomico(UUID, TEXT, JSONB, UUID, TEXT, TEXT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.reconciliar_kardex_staging(UUID, UUID, JSONB, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_kardex_staging(UUID, UUID, JSONB, UUID, TEXT, TEXT)
  TO service_role;

NOTIFY pgrST, 'reload schema';
COMMIT;
