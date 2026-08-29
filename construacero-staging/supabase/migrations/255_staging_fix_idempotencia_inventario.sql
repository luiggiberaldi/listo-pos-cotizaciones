-- 255_staging_fix_idempotencia_inventario.sql
--
-- BUG FIX detectado por el E2E determinista (paso 41, 2026-08-28):
-- Los tres wrappers _staging de inventario reservan la operación con
-- p_idempotency_key (staging_reservar_operacion), pero NO la reenvían a la
-- función atómica interna. Las atómicas exigen la key
-- (RAISE 'IDEMPOTENCY_KEY_OBLIGATORIA' si IS NULL), por lo que los endpoints
--   POST /api/inventario/movimiento        (aplicar_movimiento_inventario_atomico_staging)
--   POST /api/inventario/transformar       (transformar_inventario_atomico_staging)
--   POST /api/inventario/devolver-prestamo (devolver_prestamo_inventario_atomico_staging)
-- fallan siempre con HTTP 400.
--
-- Fix: reenviar p_idempotency_key como último argumento de la llamada interna.
-- Aditivo: CREATE OR REPLACE con la misma firma. No cambia esquema ni datos.
-- Idempotente: seguro de re-ejecutar.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Wrapper de movimiento de inventario (ingreso/egreso por lote)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_movimiento_inventario_atomico_staging(
  p_cuenta_id uuid,
  p_tipo tipo_movimiento,
  p_motivo text,
  p_motivo_tipo motivo_movimiento DEFAULT 'otro',
  p_items jsonb DEFAULT '[]'::jsonb,
  p_usuario_id uuid DEFAULT NULL,
  p_usuario_nombre text DEFAULT NULL,
  p_usuario_color text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res    JSONB;
  v_result JSONB;
BEGIN
  v_res := public.staging_reservar_operacion(p_cuenta_id, p_idempotency_key, 'movimiento_inventario');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.aplicar_movimiento_inventario_atomico(
    p_cuenta_id, p_tipo, p_motivo, p_motivo_tipo, p_items,
    p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_idempotency_key
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(p_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Wrapper de transformación de inventario
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transformar_inventario_atomico_staging(
  p_cuenta_id uuid,
  p_origen_producto_id uuid,
  p_origen_cantidad numeric,
  p_destino_producto_id uuid,
  p_destino_cantidad numeric,
  p_motivo text,
  p_usuario_id uuid DEFAULT NULL,
  p_usuario_nombre text DEFAULT NULL,
  p_usuario_color text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res    JSONB;
  v_result JSONB;
BEGIN
  v_res := public.staging_reservar_operacion(p_cuenta_id, p_idempotency_key, 'transformacion_inventario');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.transformar_inventario_atomico(
    p_cuenta_id, p_origen_producto_id, p_origen_cantidad,
    p_destino_producto_id, p_destino_cantidad, p_motivo,
    p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_idempotency_key
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(p_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Wrapper de devolución de préstamo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_prestamo_inventario_atomico_staging(
  p_cuenta_id uuid,
  p_prestamo_id uuid,
  p_cantidad numeric,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res    JSONB;
  v_result JSONB;
BEGIN
  v_res := public.staging_reservar_operacion(p_cuenta_id, p_idempotency_key, 'devolucion_prestamo');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.devolver_prestamo_inventario_atomico(
    p_cuenta_id, p_prestamo_id, p_cantidad,
    p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_idempotency_key
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(p_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.aplicar_movimiento_inventario_atomico_staging(uuid, tipo_movimiento, text, motivo_movimiento, jsonb, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transformar_inventario_atomico_staging(uuid, uuid, numeric, uuid, numeric, text, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.devolver_prestamo_inventario_atomico_staging(uuid, uuid, numeric, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_inventario_atomico_staging(uuid, tipo_movimiento, text, motivo_movimiento, jsonb, uuid, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.transformar_inventario_atomico_staging(uuid, uuid, numeric, uuid, numeric, text, uuid, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.devolver_prestamo_inventario_atomico_staging(uuid, uuid, numeric, uuid, text, text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
