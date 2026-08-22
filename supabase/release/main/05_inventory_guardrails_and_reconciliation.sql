-- 05_inventory_guardrails_and_reconciliation.sql
-- REVIEW ONLY — proyecto principal.
--
-- Cierra los caminos directos de stock/productos y deja la reconciliación
-- histórica explícita, por batch y reversible mediante movimientos compensatorios.
-- No borra ni reescribe movimientos originales durante una reconciliación.

BEGIN;

-- SAFETY GATE: elimina este bloque únicamente después de aprobar backup,
-- historial, revisión humana de propuestas y rollback ensayado.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 05_inventory_guardrails_and_reconciliation.sql no debe ejecutarse todavía';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.productos') IS NULL
     OR to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.inventario_operaciones') IS NULL
     OR to_regclass('public.kardex_reconciliaciones') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: ejecutar/revisar 01 antes de 05';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Fachadas tenant-safe de catálogo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crear_producto_con_kardex_tenant_safe(
  p_cuenta_id          UUID,
  p_usuario_id         UUID,
  p_usuario_nombre     TEXT DEFAULT NULL,
  p_usuario_color      TEXT DEFAULT NULL,
  p_codigo             TEXT DEFAULT NULL,
  p_nombre             TEXT DEFAULT NULL,
  p_descripcion        TEXT DEFAULT NULL,
  p_categoria          TEXT DEFAULT NULL,
  p_unidad             TEXT DEFAULT 'und',
  p_precio_usd         NUMERIC DEFAULT 0,
  p_costo_usd          NUMERIC DEFAULT NULL,
  p_stock_actual       NUMERIC DEFAULT 0,
  p_stock_minimo       NUMERIC DEFAULT 0,
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
  v_actor       RECORD;
  v_producto    RECORD;
  v_lote_id     UUID;
  v_guard       JSONB;
  v_resultado   JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_usuario_id IS NULL
     OR p_nombre IS NULL OR btrim(p_nombre) = ''
     OR COALESCE(p_stock_actual, 0) < 0 THEN
    RAISE EXCEPTION 'PARAMETROS_PRODUCTO_CREAR_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'product_create'
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

  INSERT INTO public.productos (
    codigo, nombre, descripcion, categoria, unidad, precio_usd, costo_usd,
    stock_actual, stock_minimo, imagen_url, precio_2, precio_3,
    precio1_porcentaje, precio2_porcentaje, precio3_porcentaje,
    activo, cuenta_id, creado_en, actualizado_en
  ) VALUES (
    NULLIF(btrim(p_codigo), ''), btrim(p_nombre), NULLIF(btrim(p_descripcion), ''),
    NULLIF(btrim(p_categoria), ''), COALESCE(NULLIF(btrim(p_unidad), ''), 'und'),
    COALESCE(p_precio_usd, 0), p_costo_usd, COALESCE(p_stock_actual, 0),
    COALESCE(p_stock_minimo, 0), NULLIF(btrim(p_imagen_url), ''),
    p_precio_2, p_precio_3, p_precio1_porcentaje, p_precio2_porcentaje,
    p_precio3_porcentaje, TRUE, p_cuenta_id, now(), now()
  ) RETURNING * INTO v_producto;

  IF v_producto.stock_actual > 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id, 'ingreso', 'Stock inicial al crear producto',
      'ajuste_inventario', v_producto.id, v_producto.nombre,
      v_producto.stock_actual, 0, v_producto.stock_actual, v_actor.id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor.nombre),
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'product_create', v_producto.id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );
  END IF;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'id', v_producto.id, 'codigo', v_producto.codigo,
    'nombre', v_producto.nombre, 'stock_actual', v_producto.stock_actual,
    'lote_id', v_lote_id, 'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

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

  UPDATE public.productos
  SET codigo = COALESCE(NULLIF(btrim(p_codigo), ''), codigo),
      nombre = COALESCE(NULLIF(btrim(p_nombre), ''), nombre),
      descripcion = CASE WHEN p_descripcion IS NULL THEN descripcion ELSE NULLIF(btrim(p_descripcion), '') END,
      categoria = CASE WHEN p_categoria IS NULL THEN categoria ELSE NULLIF(btrim(p_categoria), '') END,
      unidad = COALESCE(NULLIF(btrim(p_unidad), ''), unidad),
      precio_usd = COALESCE(p_precio_usd, precio_usd),
      costo_usd = COALESCE(p_costo_usd, costo_usd),
      stock_actual = v_new_stock,
      stock_minimo = COALESCE(p_stock_minimo, stock_minimo),
      imagen_url = CASE WHEN p_imagen_url IS NULL THEN imagen_url ELSE NULLIF(btrim(p_imagen_url), '') END,
      precio_2 = COALESCE(p_precio_2, precio_2),
      precio_3 = COALESCE(p_precio_3, precio_3),
      precio1_porcentaje = COALESCE(p_precio1_porcentaje, precio1_porcentaje),
      precio2_porcentaje = COALESCE(p_precio2_porcentaje, precio2_porcentaje),
      precio3_porcentaje = COALESCE(p_precio3_porcentaje, precio3_porcentaje),
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

CREATE OR REPLACE FUNCTION public.borrar_producto_con_kardex_tenant_safe(
  p_cuenta_id       UUID,
  p_producto_id     UUID,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT DEFAULT NULL,
  p_usuario_color   TEXT DEFAULT NULL,
  p_confirmacion    TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      RECORD;
  v_producto   RECORD;
  v_lote_id    UUID;
  v_guard      JSONB;
  v_resultado  JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_producto_id IS NULL OR p_usuario_id IS NULL
     OR COALESCE(p_confirmacion, '') <> 'BORRAR_PRODUCTO' THEN
    RAISE EXCEPTION 'CONFIRMACION_BORRADO_PRODUCTO_INVALIDA';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'product_delete'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol IN ('administracion', 'jefe', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_BORRADO_NO_AUTORIZADO'; END IF;

  SELECT * INTO v_producto
  FROM public.productos
  WHERE id = p_producto_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE'; END IF;

  IF COALESCE(v_producto.stock_actual, 0) <> 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id, 'egreso', 'Producto eliminado del sistema', 'ajuste_inventario',
      p_producto_id, v_producto.nombre, abs(v_producto.stock_actual),
      v_producto.stock_actual, 0, v_actor.id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor.nombre),
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'product_delete', p_producto_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );
  END IF;

  DELETE FROM public.productos WHERE id = p_producto_id AND cuenta_id = p_cuenta_id;
  v_resultado := jsonb_build_object(
    'ok', TRUE, 'producto_id', p_producto_id,
    'movimiento_lote_id', v_lote_id, 'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- Limpieza destructiva queda detrás de doble control: rol desarrollador y una
-- frase que incluye el tenant. No debe ser usada en tenants productivos sin
-- una ventana aprobada y un backup restaurable.
CREATE OR REPLACE FUNCTION public.limpiar_inventario_atomico(
  p_cuenta_id       UUID,
  p_usuario_id      UUID,
  p_confirmacion    TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       RECORD;
  v_movimientos INTEGER := 0;
  v_productos   INTEGER := 0;
  v_guard       JSONB;
  v_resultado   JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_usuario_id IS NULL
     OR COALESCE(p_confirmacion, '') <> 'LIMPIAR_INVENTARIO:' || p_cuenta_id::TEXT THEN
    RAISE EXCEPTION 'CONFIRMACION_LIMPIEZA_INVALIDA';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'inventory_clear'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol = 'desarrollador'
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIMPIEZA_REQUIERE_DESARROLLADOR'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.kardex_reconciliaciones
    WHERE cuenta_id = p_cuenta_id AND estado = 'aplicado'
  ) THEN
    RAISE EXCEPTION 'LIMPIEZA_BLOQUEADA_POR_RECONCILIACIONES';
  END IF;

  DELETE FROM public.inventario_movimientos m
  WHERE m.cuenta_id = p_cuenta_id
     OR (m.cuenta_id IS NULL AND m.producto_id IN (
       SELECT p.id FROM public.productos p WHERE p.cuenta_id = p_cuenta_id
     ));
  GET DIAGNOSTICS v_movimientos = ROW_COUNT;

  DELETE FROM public.productos WHERE cuenta_id = p_cuenta_id;
  GET DIAGNOSTICS v_productos = ROW_COUNT;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'cuenta_id', p_cuenta_id,
    'movimientos_eliminados', v_movimientos,
    'productos_eliminados', v_productos,
    'transaccion_atomica', TRUE,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- ---------------------------------------------------------------------------
-- Reconciliación histórica por propuestas read-only previamente aprobadas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconciliar_kardex(
  p_cuenta_id       UUID,
  p_batch_key       UUID,
  p_propuestas      JSONB,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
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
  v_actor          RECORD;
  v_guard          JSONB;
  v_resultado      JSONB;
  v_lote_id        UUID := gen_random_uuid();
  v_corr_id        UUID;
  v_delta          NUMERIC(12,4);
  v_stock_anterior NUMERIC(12,4);
  v_stock_nuevo    NUMERIC(12,4);
  v_insert_time    TIMESTAMPTZ;
  v_ancla_key      TEXT;
  v_aplicados      INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL OR p_usuario_id IS NULL
     OR p_propuestas IS NULL OR jsonb_typeof(p_propuestas) <> 'array'
     OR jsonb_array_length(p_propuestas) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_RECONCILIACION_INVALIDOS';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_batch_key, 'kardex_reconciliation'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol IN ('administracion', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_RECONCILIACION_NO_AUTORIZADO'; END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_reconciliacion_principal;
  CREATE TEMP TABLE tmp_reconciliacion_principal (
    clase TEXT,
    producto_id UUID,
    movimiento_id UUID,
    movimiento_numero INTEGER,
    movimiento_anterior_id UUID,
    stock_anterior_esperado NUMERIC(12,4),
    stock_actual_movimiento NUMERIC(12,4),
    stock_actual_catalogo NUMERIC(12,4),
    delta NUMERIC(12,4),
    reason TEXT
  ) ON COMMIT DROP;

  INSERT INTO tmp_reconciliacion_principal
  SELECT r.clase, r.producto_id, r.movimiento_id, r.movimiento_numero,
         r.movimiento_anterior_id, r.stock_anterior_esperado,
         r.stock_actual_movimiento, r.stock_actual_catalogo, r.delta,
         COALESCE(r.reason, '')
  FROM jsonb_to_recordset(p_propuestas) AS r(
    clase TEXT, producto_id UUID, movimiento_id UUID,
    movimiento_numero INTEGER, movimiento_anterior_id UUID,
    stock_anterior_esperado NUMERIC, stock_actual_movimiento NUMERIC,
    stock_actual_catalogo NUMERIC, delta NUMERIC, reason TEXT
  );

  FOR v_item IN
    SELECT * FROM tmp_reconciliacion_principal
    ORDER BY producto_id, movimiento_numero NULLS LAST, clase
  LOOP
    IF v_item.clase NOT IN ('continuity_gap', 'stock_actual_vs_kardex')
       OR v_item.producto_id IS NULL THEN
      RAISE EXCEPTION 'PROPUESTA_RECONCILIACION_INVALIDA';
    END IF;

    v_ancla_key := CASE WHEN v_item.clase = 'continuity_gap'
      THEN v_item.movimiento_id::TEXT
      ELSE v_item.producto_id::TEXT || ':stock_actual' END;

    IF EXISTS (
      SELECT 1 FROM public.kardex_reconciliaciones
      WHERE batch_key = p_batch_key AND ancla_key = v_ancla_key
    ) THEN CONTINUE; END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_RECONCILIACION_NO_ENCONTRADO'; END IF;

    IF v_item.clase = 'continuity_gap' THEN
      SELECT * INTO v_actual
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_id AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'MOVIMIENTO_ANCLA_NO_ENCONTRADO'; END IF;

      SELECT * INTO v_anterior
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_anterior_id
        AND producto_id = v_item.producto_id AND cuenta_id = p_cuenta_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MOVIMIENTO_ANTERIOR_NO_ENCONTRADO'; END IF;

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
      WHERE id = v_item.movimiento_id AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'ULTIMO_MOVIMIENTO_NO_ENCONTRADO'; END IF;

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

    IF abs(v_delta) <= 0.01 THEN CONTINUE; END IF;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key, creado_en
    ) VALUES (
      v_lote_id,
      CASE WHEN v_delta > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
      left('Reconciliación Kardex [' || v_item.clase || '] ancla '
        || COALESCE(v_item.movimiento_numero::TEXT, v_item.movimiento_id::TEXT)
        || ': ' || COALESCE(NULLIF(btrim(v_item.reason), ''), 'brecha de continuidad'), 500),
      'ajuste_inventario', v_producto.id, v_producto.nombre, abs(v_delta),
      v_stock_anterior, v_stock_nuevo, v_actor.id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor.nombre),
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'reconciliacion_kardex', COALESCE(v_item.movimiento_id, v_item.producto_id),
      v_ancla_key, p_batch_key, v_insert_time
    ) RETURNING id INTO v_corr_id;

    INSERT INTO public.kardex_reconciliaciones (
      batch_key, ancla_key, cuenta_id, producto_id,
      movimiento_ancla_id, movimiento_correctivo_id, clase, delta,
      stock_anterior, stock_nuevo,
      stock_catalogo_snapshot, producto_actualizado_en_snapshot,
      motivo, aplicado_por
    ) VALUES (
      p_batch_key, v_ancla_key, p_cuenta_id, v_producto.id,
      v_item.movimiento_id, v_corr_id, v_item.clase, v_delta,
      v_stock_anterior, v_stock_nuevo,
      ROUND(COALESCE(v_producto.stock_actual, 0)::NUMERIC, 4),
      v_producto.actualizado_en,
      left('Reconciliación Kardex [' || v_item.clase || '] ' || v_ancla_key, 500),
      v_actor.id
    );
    v_aplicados := v_aplicados + 1;
  END LOOP;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'transaccion_atomica', TRUE,
    'batch_key', p_batch_key, 'lote_id', v_lote_id,
    'aplicados', v_aplicados
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_batch_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- Rollback por batch: crea movimientos inversos y marca la reconciliación como
-- revertida. Nunca elimina la propuesta, el movimiento original ni la evidencia.
--
-- Guardas obligatorias:
-- 1) el batch debe existir y no puede estar parcialmente revertido;
-- 2) el producto debe conservar exactamente el snapshot de catálogo tomado al aplicar;
-- 3) no puede haber movimientos posteriores al momento de aplicación, salvo las
--    correcciones del propio batch;
-- 4) el rollback NO modifica productos.stock_actual. La reconciliación histórica
--    corrige la secuencia del Kardex, no reescribe el saldo operativo vigente;
-- 5) una clave de rollback repetida devuelve el resultado original.
CREATE OR REPLACE FUNCTION public.revertir_reconciliacion_kardex(
  p_cuenta_id       UUID,
  p_batch_key       UUID,
  p_rollback_key    UUID,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_usuario_color   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row                  RECORD;
  v_corr                 RECORD;
  v_producto             RECORD;
  v_actor                RECORD;
  v_guard                JSONB;
  v_lote_id              UUID := gen_random_uuid();
  v_batch_total          INTEGER := 0;
  v_batch_aplicados      INTEGER := 0;
  v_batch_revertidos     INTEGER := 0;
  v_post_batch_movs      INTEGER := 0;
  v_revertidos           INTEGER := 0;
  v_resultado            JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL OR p_rollback_key IS NULL
     OR p_usuario_id IS NULL OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_ROLLBACK_RECONCILIACION_INVALIDOS';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_rollback_key, 'kardex_reconciliation_rollback'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol IN ('administracion', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_ROLLBACK_NO_AUTORIZADO'; END IF;

  SELECT count(*)::INTEGER,
         count(*) FILTER (WHERE estado = 'aplicado')::INTEGER,
         count(*) FILTER (WHERE estado = 'revertido')::INTEGER
  INTO v_batch_total, v_batch_aplicados, v_batch_revertidos
  FROM public.kardex_reconciliaciones
  WHERE cuenta_id = p_cuenta_id AND batch_key = p_batch_key;

  IF v_batch_total = 0 THEN
    RAISE EXCEPTION 'BATCH_RECONCILIACION_NO_ENCONTRADO';
  END IF;
  IF v_batch_revertidos > 0 AND v_batch_aplicados > 0 THEN
    RAISE EXCEPTION 'BATCH_RECONCILIACION_PARCIALMENTE_REVERTIDO';
  END IF;
  IF v_batch_revertidos = v_batch_total THEN
    RAISE EXCEPTION 'BATCH_RECONCILIACION_YA_REVERTIDO';
  END IF;

  FOR v_row IN
    SELECT * FROM public.kardex_reconciliaciones
    WHERE cuenta_id = p_cuenta_id AND batch_key = p_batch_key
      AND estado = 'aplicado'
    ORDER BY producto_id, aplicado_en, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_corr
    FROM public.inventario_movimientos
    WHERE id = v_row.movimiento_correctivo_id
      AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MOVIMIENTO_CORRECTIVO_NO_ENCONTRADO: %', v_row.id;
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_row.producto_id AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_ROLLBACK_NO_ENCONTRADO: %', v_row.producto_id;
    END IF;

    IF v_row.stock_catalogo_snapshot IS NULL
       OR v_row.producto_actualizado_en_snapshot IS NULL
       OR abs(COALESCE(v_producto.stock_actual, 0)
              - v_row.stock_catalogo_snapshot) > 0.01
       OR v_producto.actualizado_en IS DISTINCT FROM v_row.producto_actualizado_en_snapshot THEN
      RAISE EXCEPTION 'ROLLBACK_BLOQUEADO_PRODUCTO_CAMBIO: %', v_row.producto_id;
    END IF;

    SELECT count(*)::INTEGER INTO v_post_batch_movs
    FROM public.inventario_movimientos m
    WHERE m.cuenta_id = p_cuenta_id
      AND m.producto_id = v_row.producto_id
      AND m.creado_en >= v_row.aplicado_en
      AND NOT EXISTS (
        SELECT 1
        FROM public.kardex_reconciliaciones kr
        WHERE kr.cuenta_id = p_cuenta_id
          AND kr.batch_key = p_batch_key
          AND kr.movimiento_correctivo_id = m.id
      );

    IF v_post_batch_movs > 0 THEN
      RAISE EXCEPTION 'ROLLBACK_BLOQUEADO_MOVIMIENTOS_POSTERIORES: %', v_row.producto_id;
    END IF;

    -- La compensación inversa revierte la secuencia histórica usando los
    -- snapshots del movimiento correctivo. No altera el saldo operativo actual.
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id,
      CASE WHEN v_row.delta > 0 THEN 'egreso'::tipo_movimiento ELSE 'ingreso'::tipo_movimiento END,
      left('Rollback reconciliación Kardex batch ' || p_batch_key::TEXT, 500),
      'ajuste_inventario', v_producto.id, v_producto.nombre, abs(v_row.delta),
      v_corr.stock_nuevo, v_corr.stock_anterior, v_actor.id, p_usuario_nombre,
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'reconciliacion_rollback', v_corr.id,
      'batch:' || p_batch_key::TEXT, p_rollback_key
    );

    UPDATE public.kardex_reconciliaciones
    SET estado = 'revertido', revertido_en = now(), revertido_por = v_actor.id
    WHERE id = v_row.id;
    v_revertidos := v_revertidos + 1;
  END LOOP;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'batch_key', p_batch_key,
    'rollback_key', p_rollback_key, 'lote_id', v_lote_id,
    'revertidos', v_revertidos,
    'producto_stock_modificado', FALSE,
    'guardas', jsonb_build_array(
      'batch_completo', 'snapshot_producto',
      'sin_movimientos_posteriores', 'sin_mutacion_catalogo'
    )
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_rollback_key, v_resultado);
  RETURN v_resultado;
END
$$;

REVOKE ALL ON FUNCTION public.crear_producto_con_kardex_tenant_safe(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.actualizar_producto_con_kardex_tenant_safe(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.borrar_producto_con_kardex_tenant_safe(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpiar_inventario_atomico(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconciliar_kardex(UUID, UUID, JSONB, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revertir_reconciliacion_kardex(UUID, UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_producto_con_kardex_tenant_safe(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex_tenant_safe(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.borrar_producto_con_kardex_tenant_safe(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_inventario_atomico(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconciliar_kardex(UUID, UUID, JSONB, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_reconciliacion_kardex(UUID, UUID, UUID, UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
