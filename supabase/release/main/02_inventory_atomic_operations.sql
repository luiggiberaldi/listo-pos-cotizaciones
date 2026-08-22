-- 02_inventory_atomic_operations.sql
-- REVIEW ONLY — proyecto principal.
--
-- Este archivo no reemplaza las RPC históricas. Publica nombres nuevos y
-- explícitos para que Worker/UI puedan migrarse por etapas sin overloads ni
-- CREATE OR REPLACE sobre contratos existentes.

BEGIN;

-- SAFETY GATE: elimina este bloque únicamente después de aprobar backup,
-- historial remoto, firmas, grants, pruebas y rollback.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 02_inventory_atomic_operations.sql no debe ejecutarse todavía';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.productos') IS NULL
     OR to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.inventario_operaciones') IS NULL
     OR to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.configuracion_negocio') IS NULL
     OR to_regclass('public.cliente_prestamos') IS NULL
     OR to_regclass('public.notas_despacho') IS NULL
     OR to_regclass('public.clientes') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: ejecutar/revisar 01_kardex_provenance.sql primero';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'tipo_movimiento'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'motivo_movimiento'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: enums de Kardex ausentes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('productos', 'id'), ('productos', 'nombre'), ('productos', 'stock_actual'),
      ('productos', 'stock_minimo'), ('productos', 'activo'), ('productos', 'cuenta_id'),
      ('productos', 'actualizado_en'), ('productos', 'precio_usd'), ('productos', 'costo_usd'),
      ('productos', 'precio_2'), ('productos', 'precio_3'),
      ('productos', 'precio1_porcentaje'), ('productos', 'precio2_porcentaje'),
      ('productos', 'precio3_porcentaje'), ('productos', 'codigo'), ('productos', 'descripcion'),
      ('productos', 'categoria'), ('productos', 'unidad'), ('productos', 'imagen_url'),
      ('inventario_movimientos', 'id'), ('inventario_movimientos', 'lote_id'),
      ('inventario_movimientos', 'tipo'), ('inventario_movimientos', 'motivo'),
      ('inventario_movimientos', 'motivo_tipo'), ('inventario_movimientos', 'producto_id'),
      ('inventario_movimientos', 'producto_nombre'), ('inventario_movimientos', 'cantidad'),
      ('inventario_movimientos', 'stock_anterior'), ('inventario_movimientos', 'stock_nuevo'),
      ('inventario_movimientos', 'usuario_id'), ('inventario_movimientos', 'usuario_nombre'),
      ('inventario_movimientos', 'usuario_color'), ('inventario_movimientos', 'cuenta_id'),
      ('inventario_movimientos', 'numero'), ('inventario_movimientos', 'creado_en'),
      ('inventario_movimientos', 'origen_tipo'), ('inventario_movimientos', 'origen_id'),
      ('inventario_movimientos', 'origen_referencia'), ('inventario_movimientos', 'idempotency_key'),
      ('usuarios', 'id'), ('usuarios', 'nombre'), ('usuarios', 'rol'), ('usuarios', 'activo'),
      ('usuarios', 'color'), ('usuarios', 'cuenta_id'),
      ('configuracion_negocio', 'cuenta_id'), ('configuracion_negocio', 'permitir_stock_negativo'),
      ('cliente_prestamos', 'id'), ('cliente_prestamos', 'cliente_id'),
      ('cliente_prestamos', 'despacho_id'), ('cliente_prestamos', 'producto_id'),
      ('cliente_prestamos', 'cantidad_prestada'), ('cliente_prestamos', 'cantidad_devuelta'),
      ('cliente_prestamos', 'cantidad_facturada'), ('cliente_prestamos', 'estado'),
      ('notas_despacho', 'id'), ('notas_despacho', 'numero'), ('notas_despacho', 'cuenta_id'),
      ('clientes', 'id'), ('clientes', 'cuenta_id')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = required.table_name
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: columnas del contrato principal no coinciden';
  END IF;
END
$$;

-- Movimiento manual por lote: bloquea todos los productos en orden
-- determinista, actualiza stock y escribe el Kardex dentro de una transacción.
CREATE OR REPLACE FUNCTION public.aplicar_movimiento_inventario_atomico(
  p_cuenta_id       UUID,
  p_tipo            tipo_movimiento,
  p_motivo          TEXT,
  p_motivo_tipo     motivo_movimiento DEFAULT 'otro',
  p_items           JSONB DEFAULT '[]'::JSONB,
  p_usuario_id      UUID DEFAULT NULL,
  p_usuario_nombre  TEXT DEFAULT NULL,
  p_usuario_color   TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
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
  v_actor_nombre   TEXT;
  v_actor_color    TEXT;
  v_allow_negative BOOLEAN := FALSE;
  v_lote_id        UUID := gen_random_uuid();
  v_nuevo_stock    NUMERIC(12,4);
  v_movimientos    INTEGER := 0;
  v_primer_numero  INTEGER;
  v_guard           JSONB;
  v_resultado       JSONB;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_tipo IS NULL
     OR p_motivo IS NULL
     OR btrim(p_motivo) = ''
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_MOVIMIENTO_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'inventory_movement'
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
    AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    SELECT u.id, u.nombre, u.color
    INTO v_actor_id, v_actor_nombre, v_actor_color
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

  DROP TABLE IF EXISTS pg_temp.tmp_movimiento_inventario_principal;
  CREATE TEMP TABLE tmp_movimiento_inventario_principal (
    producto_id UUID PRIMARY KEY,
    cantidad NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      producto_id UUID,
      cantidad NUMERIC
    )
  LOOP
    IF v_item.producto_id IS NULL
       OR v_item.cantidad IS NULL
       OR v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'ITEM_MOVIMIENTO_INVALIDO';
    END IF;

    INSERT INTO tmp_movimiento_inventario_principal (producto_id, cantidad)
    VALUES (v_item.producto_id, v_item.cantidad)
    ON CONFLICT (producto_id) DO UPDATE
      SET cantidad = tmp_movimiento_inventario_principal.cantidad + EXCLUDED.cantidad;
  END LOOP;

  FOR v_item IN
    SELECT producto_id, cantidad
    FROM tmp_movimiento_inventario_principal
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

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0)
      + CASE WHEN p_tipo = 'ingreso' THEN v_item.cantidad ELSE -v_item.cantidad END)::NUMERIC, 4);

    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" tiene % y se intenta retirar %',
        v_producto.nombre, v_producto.stock_actual, v_item.cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre, cantidad,
      stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color, cuenta_id,
      origen_tipo, origen_id, origen_referencia, idempotency_key
    ) VALUES (
      v_lote_id, p_tipo, btrim(p_motivo), COALESCE(p_motivo_tipo, 'otro'),
      v_producto.id, v_producto.nombre, ROUND(v_item.cantidad::NUMERIC, 4),
      COALESCE(v_producto.stock_actual, 0), v_nuevo_stock,
      v_actor_id, COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'movimiento_inventario', v_lote_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  SELECT MIN(numero)
  INTO v_primer_numero
  FROM public.inventario_movimientos
  WHERE lote_id = v_lote_id;

  v_resultado := jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'numero', v_primer_numero,
    'movimientos', v_movimientos,
    'stock_negativo_permitido', v_allow_negative,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- Transformación: egreso del origen e ingreso al destino con el mismo lote.
CREATE OR REPLACE FUNCTION public.transformar_inventario_atomico(
  p_cuenta_id             UUID,
  p_origen_producto_id    UUID,
  p_origen_cantidad       NUMERIC,
  p_destino_producto_id   UUID,
  p_destino_cantidad      NUMERIC,
  p_motivo                TEXT,
  p_usuario_id            UUID DEFAULT NULL,
  p_usuario_nombre        TEXT DEFAULT NULL,
  p_usuario_color         TEXT DEFAULT NULL,
  p_idempotency_key       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked          RECORD;
  v_origen          RECORD;
  v_destino         RECORD;
  v_actor_id        UUID;
  v_actor_nombre    TEXT;
  v_actor_color     TEXT;
  v_allow_negative  BOOLEAN := FALSE;
  v_stock_origen    NUMERIC(12,4);
  v_stock_destino   NUMERIC(12,4);
  v_lote_id         UUID := gen_random_uuid();
  v_primer_numero   INTEGER;
  v_guard           JSONB;
  v_resultado       JSONB;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_origen_producto_id IS NULL
     OR p_destino_producto_id IS NULL
     OR p_origen_producto_id = p_destino_producto_id
     OR p_origen_cantidad IS NULL OR p_origen_cantidad <= 0
     OR p_destino_cantidad IS NULL OR p_destino_cantidad <= 0
     OR p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_TRANSFORMACION_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'inventory_transformation'
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
    AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    SELECT u.id, u.nombre, u.color
    INTO v_actor_id, v_actor_nombre, v_actor_color
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id
    LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO'; END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = p_cuenta_id
  LIMIT 1;

  FOR v_locked IN
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    FROM public.productos p
    WHERE p.id IN (p_origen_producto_id, p_destino_producto_id)
      AND p.cuenta_id = p_cuenta_id
    ORDER BY p.id
    FOR UPDATE
  LOOP
    IF v_locked.id = p_origen_producto_id THEN
      v_origen := v_locked;
    ELSE
      v_destino := v_locked;
    END IF;
  END LOOP;

  IF v_origen.id IS NULL OR v_origen.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'PRODUCTO_ORIGEN_NO_DISPONIBLE';
  END IF;
  IF v_destino.id IS NULL OR v_destino.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'PRODUCTO_DESTINO_NO_DISPONIBLE';
  END IF;

  v_stock_origen := ROUND((COALESCE(v_origen.stock_actual, 0) - p_origen_cantidad)::NUMERIC, 4);
  v_stock_destino := ROUND((COALESCE(v_destino.stock_actual, 0) + p_destino_cantidad)::NUMERIC, 4);

  IF v_stock_origen < 0 AND NOT v_allow_negative THEN
    RAISE EXCEPTION 'STOCK_INSUFICIENTE_ORIGEN: "%" tiene % y se intenta retirar %',
      v_origen.nombre, v_origen.stock_actual, p_origen_cantidad;
  END IF;

  UPDATE public.productos SET stock_actual = v_stock_origen, actualizado_en = now()
  WHERE id = v_origen.id;
  UPDATE public.productos SET stock_actual = v_stock_destino, actualizado_en = now()
  WHERE id = v_destino.id;

  INSERT INTO public.inventario_movimientos (
    lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
    cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
    usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
    idempotency_key
  ) VALUES
    (
      v_lote_id, 'egreso', btrim(p_motivo), 'transferencia',
      v_origen.id, v_origen.nombre, ROUND(p_origen_cantidad::NUMERIC, 4),
      v_origen.stock_actual, v_stock_origen, v_actor_id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'transformacion_inventario', v_lote_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    ),
    (
      v_lote_id, 'ingreso', btrim(p_motivo), 'transferencia',
      v_destino.id, v_destino.nombre, ROUND(p_destino_cantidad::NUMERIC, 4),
      v_destino.stock_actual, v_stock_destino, v_actor_id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'transformacion_inventario', v_lote_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );

  SELECT MIN(numero) INTO v_primer_numero
  FROM public.inventario_movimientos WHERE lote_id = v_lote_id;

  v_resultado := jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'numero', v_primer_numero,
    'origen', jsonb_build_object('id', v_origen.id, 'nombre', v_origen.nombre, 'stock_nuevo', v_stock_origen),
    'destino', jsonb_build_object('id', v_destino.id, 'nombre', v_destino.nombre, 'stock_nuevo', v_stock_destino),
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- Devolución física de un préstamo. La relación tenant se verifica por el
-- despacho o cliente asociado al préstamo antes de tocar producto alguno.
CREATE OR REPLACE FUNCTION public.devolver_prestamo_inventario_atomico(
  p_cuenta_id       UUID,
  p_prestamo_id     UUID,
  p_cantidad        NUMERIC,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT DEFAULT NULL,
  p_usuario_color   TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prestamo        RECORD;
  v_producto        RECORD;
  v_actor_id        UUID;
  v_actor_nombre    TEXT;
  v_actor_color     TEXT;
  v_restante        NUMERIC(12,4);
  v_nueva_devuelta  NUMERIC(12,4);
  v_nuevo_estado    TEXT := 'pendiente';
  v_nuevo_stock     NUMERIC(12,4);
  v_lote_id         UUID := gen_random_uuid();
  v_movimiento_num  INTEGER;
  v_guard            JSONB;
  v_resultado       JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_prestamo_id IS NULL
     OR p_cantidad IS NULL OR p_cantidad <= 0 OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_PRESTAMO_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'loan_return'
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
  WHERE u.id = p_usuario_id AND u.activo = TRUE AND u.cuenta_id = p_cuenta_id
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    SELECT u.id, u.nombre, u.color
    INTO v_actor_id, v_actor_nombre, v_actor_color
    FROM public.usuarios u
    WHERE u.activo = TRUE AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO'; END IF;

  SELECT cp.*, nd.numero AS despacho_numero,
         nd.cuenta_id AS despacho_cuenta_id,
         c.cuenta_id AS cliente_cuenta_id
  INTO v_prestamo
  FROM public.cliente_prestamos cp
  LEFT JOIN public.notas_despacho nd ON nd.id = cp.despacho_id
  LEFT JOIN public.clientes c ON c.id = cp.cliente_id
  WHERE cp.id = p_prestamo_id
    AND (nd.cuenta_id = p_cuenta_id OR c.cuenta_id = p_cuenta_id)
  FOR UPDATE OF cp;

  IF NOT FOUND THEN RAISE EXCEPTION 'PRESTAMO_NO_ENCONTRADO'; END IF;

  v_restante := GREATEST(0,
    COALESCE(v_prestamo.cantidad_prestada, 0)
    - COALESCE(v_prestamo.cantidad_devuelta, 0)
    - COALESCE(v_prestamo.cantidad_facturada, 0));
  IF p_cantidad > v_restante + 0.0001 THEN
    RAISE EXCEPTION 'SALDO_PRESTAMO_INVALIDO: disponible %, solicitado %', v_restante, p_cantidad;
  END IF;

  v_nueva_devuelta := COALESCE(v_prestamo.cantidad_devuelta, 0) + p_cantidad;
  IF v_nueva_devuelta + COALESCE(v_prestamo.cantidad_facturada, 0)
      >= COALESCE(v_prestamo.cantidad_prestada, 0) - 0.0001 THEN
    v_nuevo_estado := 'devuelto';
  ELSIF v_nueva_devuelta > 0 THEN
    v_nuevo_estado := 'devuelto_parcial';
  END IF;

  IF v_prestamo.producto_id IS NOT NULL THEN
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_prestamo.producto_id AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_PRESTAMO_NO_DISPONIBLE';
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + p_cantidad)::NUMERIC, 4);
    UPDATE public.productos SET stock_actual = v_nuevo_stock, actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id, 'ingreso',
      'Devolución de préstamo — Despacho #' || COALESCE(v_prestamo.despacho_numero::TEXT, 'N/A'),
      'devolucion', v_producto.id, v_producto.nombre, ROUND(p_cantidad::NUMERIC, 4),
      v_producto.stock_actual, v_nuevo_stock, v_actor_id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'loan_return', p_prestamo_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    ) RETURNING numero INTO v_movimiento_num;
  END IF;

  UPDATE public.cliente_prestamos
  SET cantidad_devuelta = v_nueva_devuelta, estado = v_nuevo_estado
  WHERE id = p_prestamo_id;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'prestamo_id', p_prestamo_id,
    'nuevo_estado', v_nuevo_estado, 'cantidad_devuelta', v_nueva_devuelta,
    'lote_id', CASE WHEN v_prestamo.producto_id IS NOT NULL THEN v_lote_id ELSE NULL END,
    'numero', v_movimiento_num, 'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- Ingreso masivo de productos nuevos/existentes. La fila de producto y su
-- movimiento inicial se escriben en la misma transacción y lote.
CREATE OR REPLACE FUNCTION public.ingresar_lote_inventario_atomico(
  p_cuenta_id       UUID,
  p_motivo          TEXT,
  p_productos       JSONB,
  p_usuario_id      UUID DEFAULT NULL,
  p_usuario_nombre  TEXT DEFAULT NULL,
  p_usuario_color   TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
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
  v_actor_nombre   TEXT;
  v_actor_color    TEXT;
  v_allow_negative BOOLEAN := FALSE;
  v_lote_id        UUID := gen_random_uuid();
  v_nuevo_stock    NUMERIC(12,4);
  v_diff           NUMERIC(12,4);
  v_resultado      JSONB;
  v_guard          JSONB;
  v_movimientos    INTEGER := 0;
  v_procesados     INTEGER := 0;
  v_nuevos         INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_motivo IS NULL OR btrim(p_motivo) = ''
     OR p_productos IS NULL OR jsonb_typeof(p_productos) <> 'array'
     OR jsonb_array_length(p_productos) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INGESTA_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'batch_ingest'
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
  WHERE u.id = p_usuario_id AND u.activo = TRUE AND u.cuenta_id = p_cuenta_id
    AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    SELECT u.id, u.nombre, u.color
    INTO v_actor_id, v_actor_nombre, v_actor_color
    FROM public.usuarios u
    WHERE u.activo = TRUE AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO'; END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn WHERE cn.cuenta_id = p_cuenta_id LIMIT 1;

  DROP TABLE IF EXISTS pg_temp.tmp_ingesta_inventario_principal;
  CREATE TEMP TABLE tmp_ingesta_inventario_principal (
    fila INTEGER NOT NULL,
    producto_id UUID,
    is_nuevo BOOLEAN NOT NULL,
    codigo TEXT,
    nombre TEXT,
    descripcion TEXT,
    categoria TEXT,
    unidad TEXT,
    cantidad NUMERIC(12,4),
    costo_usd NUMERIC(12,4),
    precio_usd NUMERIC(12,4),
    precio_2 NUMERIC(12,4),
    precio_3 NUMERIC(12,4),
    precio1_porcentaje NUMERIC(12,4),
    precio2_porcentaje NUMERIC(12,4),
    precio3_porcentaje NUMERIC(12,4),
    modo_existente TEXT,
    actualizar_costo BOOLEAN
  ) ON COMMIT DROP;

  INSERT INTO tmp_ingesta_inventario_principal (
    fila, producto_id, is_nuevo, codigo, nombre, descripcion, categoria,
    unidad, cantidad, costo_usd, precio_usd, precio_2, precio_3,
    precio1_porcentaje, precio2_porcentaje, precio3_porcentaje,
    modo_existente, actualizar_costo
  )
  SELECT row_number() OVER ()::INTEGER, r.producto_id,
         COALESCE(r.is_nuevo, r.producto_id IS NULL),
         NULLIF(btrim(r.codigo), ''), NULLIF(btrim(r.nombre), ''),
         NULLIF(btrim(r.descripcion), ''), NULLIF(btrim(r.categoria), ''),
         COALESCE(NULLIF(btrim(r.unidad), ''), 'und'), r.cantidad,
         r.costo_usd, r.precio_usd, r.precio_2, r.precio_3,
         r.precio1_porcentaje, r.precio2_porcentaje, r.precio3_porcentaje,
         COALESCE(NULLIF(btrim(r.modo_existente), ''), 'sumar'),
         COALESCE(r.actualizar_costo, FALSE)
  FROM jsonb_to_recordset(p_productos) AS r(
    producto_id UUID, is_nuevo BOOLEAN, codigo TEXT, nombre TEXT,
    descripcion TEXT, categoria TEXT, unidad TEXT, cantidad NUMERIC,
    costo_usd NUMERIC, precio_usd NUMERIC, precio_2 NUMERIC, precio_3 NUMERIC,
    precio1_porcentaje NUMERIC, precio2_porcentaje NUMERIC,
    precio3_porcentaje NUMERIC, modo_existente TEXT, actualizar_costo BOOLEAN
  );

  IF EXISTS (SELECT 1 FROM tmp_ingesta_inventario_principal
             WHERE nombre IS NULL OR cantidad IS NULL OR cantidad <= 0) THEN
    RAISE EXCEPTION 'ITEM_INGESTA_INVALIDO';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_inventario_principal
             WHERE is_nuevo AND producto_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_NUEVO_CON_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_inventario_principal
             WHERE NOT is_nuevo AND producto_id IS NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_EXISTENTE_SIN_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_inventario_principal
             WHERE NOT is_nuevo AND modo_existente NOT IN ('sumar', 'sobrescribir')) THEN
    RAISE EXCEPTION 'MODO_INGESTA_INVALIDO';
  END IF;
  IF EXISTS (SELECT codigo FROM tmp_ingesta_inventario_principal
             WHERE is_nuevo AND codigo IS NOT NULL
             GROUP BY codigo HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'CODIGO_REPETIDO_EN_INGESTA';
  END IF;

  UPDATE tmp_ingesta_inventario_principal
  SET producto_id = gen_random_uuid()
  WHERE is_nuevo;

  FOR v_item IN
    SELECT * FROM tmp_ingesta_inventario_principal
    WHERE NOT is_nuevo ORDER BY producto_id
  LOOP
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_item.producto_id AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.producto_id;
    END IF;

    v_nuevo_stock := CASE WHEN v_item.modo_existente = 'sobrescribir'
      THEN v_item.cantidad
      ELSE ROUND((COALESCE(v_producto.stock_actual, 0) + v_item.cantidad)::NUMERIC, 4)
    END;
    v_diff := ROUND((v_nuevo_stock - COALESCE(v_producto.stock_actual, 0))::NUMERIC, 4);
    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" quedaría en %', v_producto.nombre, v_nuevo_stock;
    END IF;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        costo_usd = CASE WHEN v_item.actualizar_costo THEN COALESCE(v_item.costo_usd, 0) ELSE costo_usd END,
        precio_usd = CASE WHEN COALESCE(v_item.precio_usd, 0) > 0 THEN v_item.precio_usd ELSE precio_usd END,
        precio_2 = COALESCE(v_item.precio_2, precio_2),
        precio_3 = COALESCE(v_item.precio_3, precio_3),
        precio1_porcentaje = COALESCE(v_item.precio1_porcentaje, precio1_porcentaje),
        precio2_porcentaje = COALESCE(v_item.precio2_porcentaje, precio2_porcentaje),
        precio3_porcentaje = COALESCE(v_item.precio3_porcentaje, precio3_porcentaje),
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
        btrim(p_motivo),
        CASE WHEN v_diff > 0 THEN 'compra_proveedor'::motivo_movimiento
             ELSE 'ajuste_inventario'::motivo_movimiento END,
        v_producto.id, v_producto.nombre, abs(v_diff),
        COALESCE(v_producto.stock_actual, 0), v_nuevo_stock, v_actor_id,
        COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
        COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
        'batch_ingest', v_lote_id, 'batch_ingest:' || v_item.fila,
        p_idempotency_key
      );
      v_movimientos := v_movimientos + 1;
    END IF;
    v_procesados := v_procesados + 1;
  END LOOP;

  FOR v_item IN
    SELECT * FROM tmp_ingesta_inventario_principal
    WHERE is_nuevo ORDER BY fila
  LOOP
    INSERT INTO public.productos (
      id, codigo, nombre, descripcion, categoria, unidad,
      precio_usd, costo_usd, stock_actual, stock_minimo, activo, cuenta_id,
      precio_2, precio_3, precio1_porcentaje, precio2_porcentaje,
      precio3_porcentaje, creado_en, actualizado_en
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
      v_lote_id, 'ingreso', btrim(p_motivo), 'compra_proveedor',
      v_item.producto_id, v_item.nombre, v_item.cantidad, 0, v_item.cantidad,
      v_actor_id, COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'batch_ingest', v_lote_id, 'batch_ingest:' || v_item.fila,
      p_idempotency_key
    );
    v_movimientos := v_movimientos + 1;
    v_procesados := v_procesados + 1;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'lote_id', v_lote_id, 'procesados', v_procesados,
    'nuevos', v_nuevos, 'movimientos', v_movimientos,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$$;

REVOKE ALL ON FUNCTION public.aplicar_movimiento_inventario_atomico(UUID, tipo_movimiento, TEXT, motivo_movimiento, JSONB, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transformar_inventario_atomico(UUID, UUID, NUMERIC, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolver_prestamo_inventario_atomico(UUID, UUID, NUMERIC, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingresar_lote_inventario_atomico(UUID, TEXT, JSONB, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_inventario_atomico(UUID, tipo_movimiento, TEXT, motivo_movimiento, JSONB, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.transformar_inventario_atomico(UUID, UUID, NUMERIC, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.devolver_prestamo_inventario_atomico(UUID, UUID, NUMERIC, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingresar_lote_inventario_atomico(UUID, TEXT, JSONB, UUID, TEXT, TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
