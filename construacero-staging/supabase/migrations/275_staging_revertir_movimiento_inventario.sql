-- 275_staging_revertir_movimiento_inventario.sql
-- Release 15 — RPC de reversión de movimientos manuales de Kardex (staging).
--
-- Crea public.revertir_movimiento_inventario_atomico: aplica el movimiento
-- inverso (ingreso<->egreso, misma cantidad) como FILA NUEVA del kardex,
-- nunca DELETE/UPDATE. Guardas:
--   · movimiento existe y pertenece a la cuenta
--   · motivo_tipo manual (compra_proveedor/ajuste_inventario/merma/devolucion/
--     transferencia/otro); 'venta' NO revertible (finanzas del despacho)
--   · no revertido antes (NOT EXISTS por origen_referencia 'REVERSO_DE:<id>')
--   · actor con rol autorizado (administracion/jefe/desarrollador)
--   · idempotencia vía inventario_operaciones (mismo patrón que la RPC viva)
--   · respeta permitir_stock_negativo de configuracion_negocio
-- Auditoría: no aquí — el Worker registra REVERSION_INVENTARIO (best-effort).

-- Precondiciones
DO $$
BEGIN
  IF to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.inventario_operaciones') IS NULL
     OR to_regclass('public.productos') IS NULL
     OR to_regclass('public.configuracion_negocio') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas base ausentes';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.revertir_movimiento_inventario_atomico(
  p_cuenta_id        UUID,
  p_movimiento_id    UUID,
  p_usuario_id       UUID DEFAULT NULL,
  p_usuario_nombre   TEXT DEFAULT NULL,
  p_usuario_color    TEXT DEFAULT NULL,
  p_idempotency_key  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  -- Guard de idempotencia PRIMERO (mismo patrón que la RPC viva): un reintento
  -- de red con la misma clave devuelve el resultado cacheado aunque el actor
  -- haya cambiado o el movimiento ya esté revertido.
  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'inventory_reversal'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  -- Actor autorizado: solo administracion/jefe/desarrollador
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

  -- Movimiento origen: debe existir y pertenecer a la cuenta
  SELECT * INTO v_orig
    FROM public.inventario_movimientos m
   WHERE m.id = p_movimiento_id
     AND m.cuenta_id = p_cuenta_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_ENCONTRADO_O_CUENTA_AJENA';
  END IF;

  -- Solo movimientos MANUALES por motivo_tipo (la venta pertenece al flujo del
  -- despacho: finanzas + reversiones propias 224/232). El trigger de
  -- provenance rellena origen_tipo en TODO insert, así que NO es usable como
  -- discriminador de manuales; motivo_tipo sí lo es.
  IF v_orig.motivo_tipo NOT IN ('compra_proveedor','ajuste_inventario','merma','devolucion','transferencia','otro') THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_REVERTIBLE_TIPO_%', v_orig.motivo_tipo::text;
  END IF;

  -- No revertir dos veces
  IF EXISTS (
    SELECT 1 FROM public.inventario_movimientos r
     WHERE r.origen_referencia = 'REVERSO_DE:' || p_movimiento_id::text
       AND r.cuenta_id = p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'MOVIMIENTO_YA_REVERTIDO';
  END IF;

  -- Lock del producto y stock actual
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
$fn$;

-- Grants: solo service_role via Worker; anon/authenticated sin acceso directo
REVOKE ALL ON FUNCTION public.revertir_movimiento_inventario_atomico(UUID,UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
