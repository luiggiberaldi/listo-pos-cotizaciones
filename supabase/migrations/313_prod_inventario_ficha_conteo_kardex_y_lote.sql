-- 313_prod_inventario_ficha_conteo_kardex_y_lote.sql — PRODUCCIÓN (OP-2026-097)
-- 1) Ficha de producto (actualizar_producto_con_kardex_tenant_safe): bloquea editar stock_actual directo (N25).
-- 2) Conteo físico atómico (ajustar_conteo_inventario_atomico): ajusta stock con control de concurrencia.
-- 3) Reversión de Kardex (revertir_movimiento_inventario_atomico): lista de PERMITIDOS (solo ajustes manuales y conteos) + índice anti-doble-reverso (N26/M1).
-- 4) Ingreso por lote (ingresar_lote_inventario_atomico): solo SUMA (elimina 'sobrescribir', conserva precios, consolida repetidos N34).
-- 5) Borrado seguro de producto (borrar_producto_con_kardex_tenant_safe): impide borrar productos con historial y corrige signo negativo (N33).
-- Rollback: 313_prod_inventario_ficha_conteo_kardex_y_lote_rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex_tenant_safe(
  p_cuenta_id uuid,
  p_usuario_id uuid,
  p_producto_id uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_codigo text DEFAULT NULL::text,
  p_nombre text DEFAULT NULL::text,
  p_descripcion text DEFAULT NULL::text,
  p_categoria text DEFAULT NULL::text,
  p_unidad text DEFAULT NULL::text,
  p_precio_usd numeric DEFAULT NULL::numeric,
  p_costo_usd numeric DEFAULT NULL::numeric,
  p_stock_actual numeric DEFAULT NULL::numeric,
  p_stock_minimo numeric DEFAULT NULL::numeric,
  p_imagen_url text DEFAULT NULL::text,
  p_precio_2 numeric DEFAULT NULL::numeric,
  p_precio_3 numeric DEFAULT NULL::numeric,
  p_precio1_porcentaje numeric DEFAULT NULL::numeric,
  p_precio2_porcentaje numeric DEFAULT NULL::numeric,
  p_precio3_porcentaje numeric DEFAULT NULL::numeric,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor           RECORD;
  v_producto        RECORD;
  v_old_stock       NUMERIC(12,4);
  v_requested_stock NUMERIC(12,4);
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

  v_old_stock := ROUND(COALESCE(v_producto.stock_actual, 0)::NUMERIC, 4);
  IF p_stock_actual IS NOT NULL THEN
    v_requested_stock := ROUND(p_stock_actual::NUMERIC, 4);
    IF v_requested_stock <> v_old_stock THEN
      RAISE EXCEPTION 'USAR_CONTEO_FISICO_PARA_MODIFICAR_STOCK';
    END IF;
  END IF;

  -- 279: contrato de precios (vacío = NULL, precio 0 = válido)
  UPDATE public.productos
  SET codigo = NULLIF(btrim(COALESCE(p_codigo, '')), ''),
      nombre = COALESCE(NULLIF(btrim(p_nombre), ''), nombre),
      descripcion = CASE WHEN p_descripcion IS NULL THEN NULL ELSE NULLIF(btrim(p_descripcion), '') END,
      categoria = CASE WHEN p_categoria IS NULL THEN NULL ELSE NULLIF(btrim(p_categoria), '') END,
      unidad = COALESCE(NULLIF(btrim(p_unidad), ''), unidad),
      precio_usd = COALESCE(p_precio_usd, 0),
      costo_usd = p_costo_usd,
      stock_minimo = COALESCE(p_stock_minimo, stock_minimo),
      imagen_url = NULLIF(btrim(COALESCE(p_imagen_url, '')), ''),
      precio_2 = p_precio_2,
      precio_3 = p_precio_3,
      precio1_porcentaje = p_precio1_porcentaje,
      precio2_porcentaje = p_precio2_porcentaje,
      precio3_porcentaje = p_precio3_porcentaje,
      actualizado_en = now()
  WHERE id = p_producto_id;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'id', p_producto_id, 'stock_anterior', v_old_stock,
    'stock_nuevo', v_old_stock, 'lote_id', NULL,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_conteo_inventario_atomico(
  p_cuenta_id uuid,
  p_motivo text,
  p_items jsonb,
  p_usuario_id uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actor_id       UUID;
  v_actor_nombre   TEXT;
  v_actor_color    TEXT;
  v_allow_negative BOOLEAN := FALSE;
  v_lote_id        UUID := gen_random_uuid();
  v_old_stock      NUMERIC(12,4);
  v_target_stock   NUMERIC(12,4);
  v_diff           NUMERIC(12,4);
  v_movimientos    INTEGER := 0;
  v_sin_cambios    INTEGER := 0;
  v_primer_numero  INTEGER;
  v_detalles       JSONB := '[]'::JSONB;
  v_guard          JSONB;
  v_resultado      JSONB;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_motivo IS NULL
     OR btrim(p_motivo) = ''
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
     OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_CONTEO_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'physical_count'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color
  INTO v_actor_id, v_actor_nombre, v_actor_color
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND u.cuenta_id = p_cuenta_id
    AND u.rol IN ('administracion', 'jefe', 'desarrollador')
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'ROL_NO_AUTORIZADO_CONTEO';
  END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = p_cuenta_id
  LIMIT 1;

  DROP TABLE IF EXISTS pg_temp.tmp_conteo_fisico_items;
  CREATE TEMP TABLE tmp_conteo_fisico_items (
    producto_id UUID PRIMARY KEY,
    stock_contado NUMERIC(12,4) NOT NULL,
    stock_esperado NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      producto_id UUID,
      stock_contado NUMERIC,
      stock_esperado NUMERIC
    )
  LOOP
    IF v_item.producto_id IS NULL
       OR v_item.stock_contado IS NULL
       OR v_item.stock_esperado IS NULL THEN
      RAISE EXCEPTION 'ITEM_CONTEO_INVALIDO';
    END IF;

    BEGIN
      INSERT INTO tmp_conteo_fisico_items (producto_id, stock_contado, stock_esperado)
      VALUES (
        v_item.producto_id,
        ROUND(v_item.stock_contado::NUMERIC, 4),
        ROUND(v_item.stock_esperado::NUMERIC, 4)
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ITEM_DUPLICADO_EN_CONTEO: %', v_item.producto_id;
    END;
  END LOOP;

  FOR v_item IN
    SELECT producto_id, stock_contado, stock_esperado
    FROM tmp_conteo_fisico_items
    ORDER BY producto_id
  LOOP
    SELECT p.id, p.nombre, p.stock_actual, p.activo
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_item.producto_id
      AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.producto_id;
    END IF;

    v_old_stock := ROUND(COALESCE(v_producto.stock_actual, 0)::NUMERIC, 4);
    IF v_old_stock <> v_item.stock_esperado THEN
      RAISE EXCEPTION 'CONFLICTO_CONCURRENCIA_STOCK: "%" cambió en el servidor (era % y se esperaba %)',
        v_producto.nombre, v_old_stock, v_item.stock_esperado;
    END IF;

    v_target_stock := v_item.stock_contado;
    IF v_target_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_NEGATIVO_NO_PERMITIDO: "%"', v_producto.nombre;
    END IF;

    v_diff := ROUND((v_target_stock - v_old_stock)::NUMERIC, 4);
    IF v_diff = 0 THEN
      v_sin_cambios := v_sin_cambios + 1;
      v_detalles := v_detalles || jsonb_build_object(
        'producto_id', v_producto.id,
        'nombre', v_producto.nombre,
        'stock_anterior', v_old_stock,
        'stock_nuevo', v_target_stock,
        'delta', 0
      );
      CONTINUE;
    END IF;

    UPDATE public.productos
    SET stock_actual = v_target_stock,
        actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre, cantidad,
      stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color, cuenta_id,
      origen_tipo, origen_id, origen_referencia, idempotency_key
    ) VALUES (
      v_lote_id,
      CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
      'Conteo físico: ' || btrim(p_motivo),
      'ajuste_inventario',
      v_producto.id, v_producto.nombre, abs(v_diff),
      v_old_stock, v_target_stock,
      v_actor_id, COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'conteo_fisico', v_lote_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );

    v_movimientos := v_movimientos + 1;
    v_detalles := v_detalles || jsonb_build_object(
      'producto_id', v_producto.id,
      'nombre', v_producto.nombre,
      'stock_anterior', v_old_stock,
      'stock_nuevo', v_target_stock,
      'delta', v_diff
    );
  END LOOP;

  IF v_movimientos > 0 THEN
    SELECT MIN(numero) INTO v_primer_numero
    FROM public.inventario_movimientos
    WHERE lote_id = v_lote_id;
  ELSE
    v_lote_id := NULL;
  END IF;

  v_resultado := jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'numero', v_primer_numero,
    'movimientos', v_movimientos,
    'sin_cambios', v_sin_cambios,
    'detalles', v_detalles,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_mov_reverso_unico
  ON public.inventario_movimientos (cuenta_id, origen_referencia)
  WHERE origen_referencia LIKE 'REVERSO_DE:%';

CREATE OR REPLACE FUNCTION public.revertir_movimiento_inventario_atomico(
  p_cuenta_id uuid,
  p_movimiento_id uuid,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orig            public.inventario_movimientos%ROWTYPE;
  v_producto        RECORD;
  v_actor_id        UUID;
  v_actor_nombre    TEXT;
  v_actor_color     TEXT;
  v_allow_negative  BOOLEAN := FALSE;
  v_lote_id         UUID := gen_random_uuid();
  v_nuevo_stock     NUMERIC(12,4);
  v_tipo_inverso    public.tipo_movimiento;
  v_guard           JSONB;
  v_numero          INTEGER;
BEGIN
  IF p_cuenta_id IS NULL OR p_movimiento_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSION_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'inventory_reversal'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color
    INTO v_actor_id, v_actor_nombre, v_actor_color
    FROM public.usuarios u
   WHERE u.id = p_usuario_id
     AND u.activo = TRUE
     AND u.cuenta_id = p_cuenta_id
     AND u.rol IN ('administracion', 'jefe', 'desarrollador')
   LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'ROL_NO_AUTORIZADO_PARA_REVERTIR';
  END IF;

  -- Lock de fila origen evita doble reversión concurrente con claves distintas
  SELECT * INTO v_orig
    FROM public.inventario_movimientos m
   WHERE m.id = p_movimiento_id
     AND m.cuenta_id = p_cuenta_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_ENCONTRADO_O_CUENTA_AJENA';
  END IF;

  -- OP-2026-086 (M1): lista de PERMITIDOS. Solo ajustes manuales y conteos físicos.
  -- Se bloquean ventas, devoluciones y movimientos viejos sin origen (origen_tipo NULL).
  IF v_orig.motivo_tipo NOT IN ('compra_proveedor','ajuste_inventario','merma','transferencia','otro') THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_REVERTIBLE_TIPO_%', v_orig.motivo_tipo::text;
  END IF;

  IF v_orig.origen_tipo IS NULL OR v_orig.origen_tipo NOT IN (
    'movimiento_inventario', 'conteo_fisico', 'ajuste_inventario', 'compra', 'transferencia', 'otro'
  ) THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_REVERTIBLE_ORIGEN_%', COALESCE(v_orig.origen_tipo, 'sin_origen');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventario_movimientos r
     WHERE r.origen_referencia = 'REVERSO_DE:' || p_movimiento_id::text
       AND r.cuenta_id = p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'MOVIMIENTO_YA_REVERTIDO';
  END IF;

  SELECT p.id, p.stock_actual, COALESCE(cn.permitir_stock_negativo, FALSE) AS neg
    INTO v_producto
    FROM public.productos p
    LEFT JOIN public.configuracion_negocio cn ON cn.cuenta_id = p.cuenta_id
   WHERE p.id = v_orig.producto_id
     AND p.cuenta_id = p_cuenta_id
   FOR UPDATE OF p
   LIMIT 1;

  IF v_producto.id IS NULL THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  v_allow_negative := v_producto.neg;
  v_tipo_inverso := CASE WHEN v_orig.tipo = 'ingreso' THEN 'egreso'::public.tipo_movimiento
                          ELSE 'ingreso'::public.tipo_movimiento END;

  v_nuevo_stock := ROUND((v_producto.stock_actual
                 + CASE WHEN v_tipo_inverso = 'ingreso' THEN v_orig.cantidad
                        ELSE -v_orig.cantidad END)::NUMERIC, 4);

  IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
    RAISE EXCEPTION 'STOCK_NEGATIVO_NO_PERMITIDO';
  END IF;

  UPDATE public.productos
     SET stock_actual = v_nuevo_stock,
         actualizado_en = now()
   WHERE id = v_orig.producto_id;

  INSERT INTO public.inventario_movimientos (
    lote_id, tipo, motivo, producto_id, producto_nombre, cantidad,
    stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color,
    cuenta_id, motivo_tipo, origen_tipo, origen_id, origen_referencia, idempotency_key
  ) VALUES (
    v_lote_id,
    v_tipo_inverso,
    'Reverso de ' || v_orig.motivo,
    v_orig.producto_id,
    v_orig.producto_nombre,
    v_orig.cantidad,
    v_producto.stock_actual,
    v_nuevo_stock,
    v_actor_id,
    COALESCE(p_usuario_nombre, v_actor_nombre),
    COALESCE(p_usuario_color, v_actor_color),
    p_cuenta_id,
    v_orig.motivo_tipo,
    'reversion_inventario',
    v_orig.id,
    'REVERSO_DE:' || v_orig.id::text,
    p_idempotency_key
  )
  RETURNING numero INTO v_numero;

  DECLARE
    v_resultado JSONB := jsonb_build_object(
      'ok', TRUE,
      'lote_id', v_lote_id,
      'numero', v_numero,
      'numero_origen', v_orig.numero,
      'movimiento_origen', v_orig.id,
      'tipo_inverso', v_tipo_inverso::text,
      'cantidad', v_orig.cantidad,
      'stock_nuevo', v_nuevo_stock
    );
  BEGIN
    PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
    RETURN v_resultado;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingresar_lote_inventario_atomico(
  p_cuenta_id uuid,
  p_motivo text,
  p_productos jsonb,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actor_id       UUID;
  v_allow_negative BOOLEAN := FALSE;
  v_lote_id        UUID := gen_random_uuid();
  v_result         JSONB;
  v_existing       JSONB;
  v_nuevo_stock    NUMERIC(12,4);
  v_diff           NUMERIC(12,4);
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
    FROM public.inventario_operaciones
    WHERE cuenta_id = p_cuenta_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND AND v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    IF NOT FOUND THEN
      INSERT INTO public.inventario_operaciones
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

  DROP TABLE IF EXISTS pg_temp.tmp_ingesta_lote;
  CREATE TEMP TABLE tmp_ingesta_lote (
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

  INSERT INTO tmp_ingesta_lote (
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

  IF EXISTS (SELECT 1 FROM tmp_ingesta_lote WHERE nombre IS NULL OR cantidad IS NULL OR cantidad <= 0) THEN
    RAISE EXCEPTION 'ITEM_INGESTA_INVALIDO';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_lote WHERE is_nuevo AND producto_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_NUEVO_CON_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_lote WHERE NOT is_nuevo AND producto_id IS NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_EXISTENTE_SIN_ID';
  END IF;
  -- OP-2026-086 (Decisión 2 del dueño): el ingreso por lote solo SUMA; 'sobrescribir' se eliminó.
  IF EXISTS (SELECT 1 FROM tmp_ingesta_lote WHERE NOT is_nuevo AND modo_existente = 'sobrescribir') THEN
    RAISE EXCEPTION 'MODO_SOBRESCRIBIR_ELIMINADO_USAR_CONTEO_FISICO';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_lote WHERE NOT is_nuevo AND modo_existente <> 'sumar') THEN
    RAISE EXCEPTION 'MODO_INGESTA_INVALIDO';
  END IF;

  -- N34: Permitir filas repetidas cuando todas usan modo 'sumar'; rechazar mezcla con 'sobrescribir'.
  IF EXISTS (
    SELECT 1
    FROM tmp_ingesta_lote
    WHERE NOT is_nuevo
    GROUP BY producto_id
    HAVING count(*) > 1 AND bool_or(modo_existente = 'sobrescribir')
  ) THEN
    RAISE EXCEPTION 'MODO_INGESTA_CONFLICTIVO';
  END IF;

  -- N34: Permitir códigos repetidos en nuevos solo si coinciden nombre y unidad (se suman sus cantidades).
  IF EXISTS (
    SELECT 1
    FROM tmp_ingesta_lote
    WHERE is_nuevo AND codigo IS NOT NULL
    GROUP BY upper(codigo)
    HAVING count(DISTINCT (upper(nombre) || '|' || upper(unidad))) > 1
  ) THEN
    RAISE EXCEPTION 'CODIGO_REPETIDO_EN_INGESTA';
  END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_ingesta_lote_cons;
  CREATE TEMP TABLE tmp_ingesta_lote_cons (LIKE pg_temp.tmp_ingesta_lote) ON COMMIT DROP;

  INSERT INTO tmp_ingesta_lote_cons
  SELECT
    MIN(fila)::INTEGER,
    producto_id,
    FALSE,
    MAX(codigo),
    (array_agg(nombre ORDER BY fila DESC))[1],
    (array_agg(descripcion ORDER BY fila DESC))[1],
    (array_agg(categoria ORDER BY fila DESC))[1],
    (array_agg(unidad ORDER BY fila DESC))[1],
    ROUND(SUM(cantidad)::NUMERIC, 4),
    COALESCE(
      (array_agg(costo_usd ORDER BY fila DESC) FILTER (WHERE actualizar_costo AND costo_usd IS NOT NULL))[1],
      (array_agg(costo_usd ORDER BY fila DESC))[1]
    ),
    (array_agg(precio_usd ORDER BY fila DESC))[1],
    (array_agg(precio_2 ORDER BY fila DESC))[1],
    (array_agg(precio_3 ORDER BY fila DESC))[1],
    (array_agg(precio1_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio2_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio3_porcentaje ORDER BY fila DESC))[1],
    MIN(modo_existente),
    bool_or(actualizar_costo)
  FROM pg_temp.tmp_ingesta_lote
  WHERE NOT is_nuevo
  GROUP BY producto_id;

  INSERT INTO tmp_ingesta_lote_cons
  SELECT
    MIN(fila)::INTEGER,
    NULL::UUID,
    TRUE,
    (array_agg(codigo ORDER BY fila))[1],
    (array_agg(nombre ORDER BY fila))[1],
    (array_agg(descripcion ORDER BY fila DESC))[1],
    (array_agg(categoria ORDER BY fila DESC))[1],
    (array_agg(unidad ORDER BY fila))[1],
    ROUND(SUM(cantidad)::NUMERIC, 4),
    COALESCE(
      (array_agg(costo_usd ORDER BY fila DESC) FILTER (WHERE costo_usd IS NOT NULL))[1],
      0
    ),
    (array_agg(precio_usd ORDER BY fila DESC) FILTER (WHERE precio_usd IS NOT NULL))[1],
    (array_agg(precio_2 ORDER BY fila DESC))[1],
    (array_agg(precio_3 ORDER BY fila DESC))[1],
    (array_agg(precio1_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio2_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio3_porcentaje ORDER BY fila DESC))[1],
    'sumar',
    FALSE
  FROM pg_temp.tmp_ingesta_lote
  WHERE is_nuevo
  GROUP BY COALESCE(NULLIF(upper(codigo), ''), '__FILA__' || fila::text);

  TRUNCATE pg_temp.tmp_ingesta_lote;
  INSERT INTO pg_temp.tmp_ingesta_lote SELECT * FROM pg_temp.tmp_ingesta_lote_cons;

  UPDATE tmp_ingesta_lote
  SET producto_id = gen_random_uuid()
  WHERE is_nuevo;

  -- Bloquear y actualizar existentes en orden determinista.
  FOR v_item IN
    SELECT * FROM tmp_ingesta_lote
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
      WHEN v_item.modo_existente = 'sobrescribir' THEN ROUND(v_item.cantidad::NUMERIC, 4)
      ELSE ROUND((COALESCE(v_producto.stock_actual, 0) + v_item.cantidad)::NUMERIC, 4)
    END;
    v_diff := ROUND((v_nuevo_stock - COALESCE(v_producto.stock_actual, 0))::NUMERIC, 4);

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
        v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador'),
        p_usuario_color, p_cuenta_id, 'batch_ingest', v_lote_id,
        'batch_ingest:' || v_item.fila, p_idempotency_key
      );
      v_movimientos := v_movimientos + 1;
    END IF;
    v_procesados := v_procesados + 1;
  END LOOP;

  -- Crear nuevos productos y su ingreso inicial en la misma transacción.
  FOR v_item IN
    SELECT * FROM tmp_ingesta_lote
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
      COALESCE(v_item.costo_usd, 0), ROUND(v_item.cantidad::NUMERIC, 4), 0, TRUE, p_cuenta_id,
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
      v_item.producto_id, v_item.nombre, ROUND(v_item.cantidad::NUMERIC, 4), 0, ROUND(v_item.cantidad::NUMERIC, 4),
      v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador'),
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
    UPDATE public.inventario_operaciones
    SET resultado = v_result, actualizado_en = now()
    WHERE cuenta_id = p_cuenta_id
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.borrar_producto_con_kardex_tenant_safe(
  p_cuenta_id uuid,
  p_producto_id uuid,
  p_usuario_id uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_confirmacion text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- N33: Si el producto participó en ventas, cotizaciones, préstamos, devoluciones o ajustes,
  -- debe archivarse (activo = FALSE) para conservar trazabilidad; no se elimina físicamente.
  IF EXISTS (SELECT 1 FROM public.cotizacion_items ci WHERE ci.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.notas_despacho_items ndi WHERE ndi.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.cliente_prestamos cp WHERE cp.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.despacho_devoluciones dd WHERE dd.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.despacho_devolucion_intercambios di WHERE di.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (
       SELECT 1 FROM public.inventario_movimientos im
       WHERE im.producto_id = p_producto_id
         AND im.cuenta_id = p_cuenta_id
         AND COALESCE(im.origen_tipo, '') <> 'product_create'
       LIMIT 1
     )
  THEN
    RAISE EXCEPTION 'PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO: "%"', v_producto.nombre;
  END IF;

  IF COALESCE(v_producto.stock_actual, 0) <> 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id,
      CASE
        WHEN v_producto.stock_actual < 0 THEN 'ingreso'::tipo_movimiento
        ELSE 'egreso'::tipo_movimiento
      END,
      'Producto eliminado del sistema', 'ajuste_inventario',
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
$function$;

REVOKE ALL ON FUNCTION public.actualizar_producto_con_kardex_tenant_safe(uuid, uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex_tenant_safe(uuid, uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.ajustar_conteo_inventario_atomico(uuid, text, jsonb, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_conteo_inventario_atomico(uuid, text, jsonb, uuid, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.revertir_movimiento_inventario_atomico(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_movimiento_inventario_atomico(uuid, uuid, uuid, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.ingresar_lote_inventario_atomico(uuid, text, jsonb, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingresar_lote_inventario_atomico(uuid, text, jsonb, uuid, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.borrar_producto_con_kardex_tenant_safe(uuid, uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.borrar_producto_con_kardex_tenant_safe(uuid, uuid, uuid, text, text, text, uuid) TO service_role;

COMMIT;
