-- 312_staging_inventario_ficha_y_kardex_rollback.sql
-- Revierte 312_staging_inventario_ficha_y_kardex.sql al estado exacto pre-OP-071 en staging.

BEGIN;

SET LOCAL app.precios_rollback_autorizado = 'REVERTIR_PRECIOS';

DROP FUNCTION IF EXISTS public.ajustar_conteo_inventario_atomico_staging(uuid, text, jsonb, uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.ajustar_conteo_inventario_atomico(uuid, text, jsonb, uuid, text, text, uuid);
DROP INDEX IF EXISTS public.idx_inv_mov_reverso_unico;

CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex_tenant_safe(p_cuenta_id uuid, p_usuario_id uuid, p_producto_id uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_codigo text DEFAULT NULL::text, p_nombre text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_unidad text DEFAULT NULL::text, p_precio_usd numeric DEFAULT NULL::numeric, p_costo_usd numeric DEFAULT NULL::numeric, p_stock_actual numeric DEFAULT NULL::numeric, p_stock_minimo numeric DEFAULT NULL::numeric, p_imagen_url text DEFAULT NULL::text, p_precio_2 numeric DEFAULT NULL::numeric, p_precio_3 numeric DEFAULT NULL::numeric, p_precio1_porcentaje numeric DEFAULT NULL::numeric, p_precio2_porcentaje numeric DEFAULT NULL::numeric, p_precio3_porcentaje numeric DEFAULT NULL::numeric, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.revertir_movimiento_inventario_atomico(p_cuenta_id uuid, p_movimiento_id uuid, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
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

  SELECT * INTO v_orig
    FROM public.inventario_movimientos m
   WHERE m.id = p_movimiento_id
     AND m.cuenta_id = p_cuenta_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_ENCONTRADO_O_CUENTA_AJENA';
  END IF;

  IF v_orig.motivo_tipo NOT IN ('compra_proveedor','ajuste_inventario','merma','devolucion','transferencia','otro') THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_REVERTIBLE_TIPO_%', v_orig.motivo_tipo::text;
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

  v_nuevo_stock := v_producto.stock_actual
                 + CASE WHEN v_tipo_inverso = 'ingreso' THEN v_orig.cantidad
                        ELSE -v_orig.cantidad END;

  IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
    RAISE EXCEPTION 'STOCK_NEGATIVO_NO_PERMITIDO';
  END IF;

  UPDATE public.productos
     SET stock_actual = v_nuevo_stock
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

REVOKE ALL ON FUNCTION public.revertir_movimiento_inventario_atomico(
  uuid, uuid, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
