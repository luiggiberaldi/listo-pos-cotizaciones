-- ═════════════════════════════════════════════════════════════════════════════
-- 08_bloqueo_stock_aprobacion_review.sql
-- Bloqueo de inventario al aprobar despachos (pendiente→despachada).
-- Espejo del comportamiento validado en staging (migración 268 + E2E 123/123 ×3).
-- Plan: bloqueo lógico al aprobar; descuento físico y Kardex siguen SOLO al
-- entregar (223/04 sin cambios — se verifican byte a byte en el postflight).
--
-- Contenido:
--   1) Toggle configuracion_negocio.bloqueo_stock_aprobacion (DEFAULT FALSE)
--   2) RPC aprobar_despacho_inventario_atomico (función NUEVA — no redefinición)
--
-- REGLAS DE SEGURIDAD:
--   · El toggle nace OFF: cero cambio de comportamiento hasta su activación.
--   · Función nueva, sin tocar ninguna existente (lección 262→263).
--   · Idempotente: IF NOT EXISTS / OR REPLACE.
--   · Venta Anticipada (permitir_stock_negativo) se respeta dentro de la RPC.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Toggle por cuenta (default OFF)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS bloqueo_stock_aprobacion BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RPC de aprobación con bloqueo de stock (idéntica a staging 268)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_despacho_inventario_atomico(
  p_despacho_id     UUID,
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
  v_despacho      RECORD;
  v_cfg           RECORD;
  v_item          RECORD;
  v_producto      RECORD;
  v_comprometido  NUMERIC(12,2);
  v_disponible    NUMERIC(12,2);
  v_productos     JSONB := '[]'::JSONB;
  v_bloquear      BOOLEAN := FALSE;
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;
  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  -- Serializa aprobaciones concurrentes del mismo despacho.
  SELECT id, cuenta_id, estado, numero
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;
  IF v_despacho.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: solo pendiente→despachada (estado actual: %)', v_despacho.estado;
  END IF;

  -- La configuración de la cuenta es la fuente de verdad (mismo patrón que 223).
  SELECT COALESCE(cn.bloqueo_stock_aprobacion, FALSE) AS bloquear,
         COALESCE(cn.permitir_stock_negativo, FALSE) AS permitir_negativo
  INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  v_bloquear := COALESCE(v_cfg.bloquear, FALSE);
  IF NOT v_bloquear THEN
    -- Toggle apagado: no-op explícito (el Worker continúa con la ruta legacy).
    RETURN jsonb_build_object('ok', TRUE, 'bloqueo_aplicado', FALSE, 'despacho_id', p_despacho_id);
  END IF;

  -- Agrupar por producto (mismo criterio de 223): evita validar dos veces líneas
  -- repetidas y excluye artículos externos/préstamos.
  FOR v_item IN
    SELECT
      ndi.producto_id,
      MAX(ndi.nombre_snap) AS nombre_snap,
      SUM(ndi.cantidad)::NUMERIC(10,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
    GROUP BY ndi.producto_id
    ORDER BY ndi.producto_id
  LOOP
    -- FOR UPDATE del producto serializa aprobaciones concurrentes que comparten stock.
    SELECT id, nombre, stock_actual, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
    END IF;
    IF v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_INVALIDA: %', v_item.nombre_snap;
    END IF;

    -- Comprometido por OTROS despachos aprobados del mismo tenant (regla 222),
    -- con filtro de origen inventario (los externos no consumen stock).
    SELECT COALESCE(SUM(ndi.cantidad), 0)::NUMERIC(12,2)
    INTO v_comprometido
    FROM public.notas_despacho_items ndi
    JOIN public.notas_despacho nd ON nd.id = ndi.despacho_id
    WHERE ndi.producto_id = v_item.producto_id
      AND nd.estado = 'despachada'
      AND nd.id <> p_despacho_id
      AND nd.cuenta_id = v_despacho.cuenta_id
      AND COALESCE(ndi.origen, 'inventario') = 'inventario';

    v_disponible := COALESCE(v_producto.stock_actual, 0) - COALESCE(v_comprometido, 0);
    IF v_disponible < v_item.cantidad AND NOT COALESCE(v_cfg.permitir_negativo, FALSE) THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_BLOQUEO: "%" disponible % (físico %, comprometido %), requerido %',
        v_producto.nombre, v_disponible, v_producto.stock_actual, COALESCE(v_comprometido, 0), v_item.cantidad;
    END IF;

    v_productos := v_productos || jsonb_build_object(
      'producto_id',   v_producto.id,
      'nombre',        v_producto.nombre,
      'fisico',        v_producto.stock_actual,
      'comprometido',  COALESCE(v_comprometido, 0),
      'disponible',    v_disponible,
      'requerido',     v_item.cantidad
    );
  END LOOP;

  -- Mismo efecto que el PATCH legacy del Worker (estado + timestamps + aprobador).
  UPDATE public.notas_despacho
  SET estado = 'despachada',
      despachada_en = COALESCE(despachada_en, now()),
      aprobado_por_nombre = trim(p_usuario_nombre)
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'bloqueo_aplicado', TRUE,
    'despacho_id', p_despacho_id,
    'venta_anticipada', COALESCE(v_cfg.permitir_negativo, FALSE),
    'productos', v_productos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprobar_despacho_inventario_atomico(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprobar_despacho_inventario_atomico(UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_despacho_inventario_atomico(UUID, UUID, TEXT, TEXT)
  TO authenticated;

COMMIT;

-- Post-apply inmediato: flag de verificación (lo consume el postflight)
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='configuracion_negocio'
            AND column_name='bloqueo_stock_aprobacion') AS toggle_ok,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='aprobar_despacho_inventario_atomico') AS rpc_ok;
