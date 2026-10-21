-- 17_egreso_inventario_aprobacion_apply.sql
-- Release 17 — Egreso de inventario al aprobar despacho (fin del stock comprometido)
--
-- PLAN: docs/plans/2026-10-19-plan-egreso-inventario-al-aprobar-despacho.md
-- APPLY ONLY con service_role (SQL Editor / psql). NO usar `supabase db push`
-- (deriva histórica de migraciones). Ejecutar ANTES del deploy del Worker +
-- frontend (orden del plan §6), inmediatamente seguido del backfill
-- `17_egreso_inventario_backfill.sql`.
--
-- Semántica nueva (transición × efecto en inventario):
--   aprobar (pendiente→despachada)      : −cantidad + kardex 'egreso'   ("Despacho #N aprobado")
--   entregar (→entregada)               : — (solo finanzas)
--   revertir entrega (→despachada)      : — (el egreso ya ocurrió al aprobar)
--   devolver a pendiente / anular desde 'despachada' o 'entregada'
--                                       : +cantidad + kardex 'ingreso'
--   editar items en 'pendiente'         : — (solo reemplaza ítems)
--   editar items en 'despachada'        : ± delta + kardex de ajuste
--
-- Decisión de producto (2026-10-19): la venta NUNCA se bloquea por stock.
-- Stock negativo se permite con alertas (nivel 'BAJO' / 'NEGATIVO') que el
-- Worker propaga a la UI (aprobar, entregar, badge del despacho).
--
-- Columnas nuevas en notas_despacho:
--   alerta_stock        : el despacho salió con stock bajo/negativo al aprobar
--   alerta_stock_items  : detalle jsonb de las alertas de la aprobación
--   egreso_lote_id      : lote del kardex de egreso (idempotencia del backfill
--                         y evidencia de rollback)
--
-- Ventana de cutover: entre este APPLY y el deploy del Worker, no aprobar ni
-- revertir despachos en producción (el Worker legacy no reingresa al devolver
-- desde 'despachada'). El backfill es idempotente por egreso_lote_id.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Columnas de soporte
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS alerta_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerta_stock_items jsonb,
  ADD COLUMN IF NOT EXISTS egreso_lote_id uuid;

COMMENT ON COLUMN public.notas_despacho.alerta_stock IS
  'Release 17: el despacho salió con stock bajo o negativo al aprobar (aviso, nunca bloqueo).';
COMMENT ON COLUMN public.notas_despacho.alerta_stock_items IS
  'Release 17: detalle jsonb [{producto_id,nombre,cantidad,stock_antes,stock_despues,nivel}] de las alertas de aprobación.';
COMMENT ON COLUMN public.notas_despacho.egreso_lote_id IS
  'Release 17: lote_id del kardex de egreso al aprobar (idempotencia de backfill y evidencia de reversión).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. aprobar_despacho_inventario_atomico v3 (T1)
--    Siempre egresa al aprobar; nunca bloquea por stock; devuelve alertas.
--    Retira la ruta no-op del toggle bloqueo_stock_aprobacion.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.aprobar_despacho_inventario_atomico(
  p_despacho_id uuid,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text,
  p_solo_validar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho     RECORD;
  v_cfg          RECORD;
  v_item         RECORD;
  v_producto     RECORD;
  v_lote_id      UUID := gen_random_uuid();
  v_productos    JSONB := '[]'::JSONB;
  v_alertas      JSONB := '[]'::JSONB;
  v_nuevo_stock  NUMERIC(12,2);
  v_nivel        TEXT;
  v_movimientos  INTEGER := 0;
  v_con_alertas  BOOLEAN := FALSE;
  v_solo_validar BOOLEAN := COALESCE(p_solo_validar, FALSE);
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;
  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

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

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE) AS permitir_negativo
  INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  -- Mismo criterio de 223/268: agrupar por producto, solo origen inventario.
  FOR v_item IN
    SELECT
      ndi.producto_id,
      MAX(ndi.nombre_snap) AS nombre_snap,
      SUM(ndi.cantidad)::NUMERIC(10,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
    ORDER BY ndi.producto_id
  LOOP
    SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
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

    v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) - v_item.cantidad;

    -- Release 17: el stock insuficiente NUNCA rechaza — se alerta.
    v_nivel := CASE
      WHEN v_nuevo_stock < 0 THEN 'NEGATIVO'
      WHEN v_nuevo_stock < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
      ELSE NULL
    END;

    v_productos := v_productos || jsonb_build_object(
      'producto_id',   v_producto.id,
      'nombre',        v_producto.nombre,
      'stock_antes',   COALESCE(v_producto.stock_actual, 0),
      'requerido',     v_item.cantidad,
      'stock_despues', v_nuevo_stock,
      'nivel_alerta',  v_nivel
    );

    IF v_nivel IS NOT NULL THEN
      v_con_alertas := TRUE;
      v_alertas := v_alertas || jsonb_build_object(
        'producto_id',   v_producto.id,
        'nombre',        v_producto.nombre,
        'cantidad',      v_item.cantidad,
        'stock_antes',   COALESCE(v_producto.stock_actual, 0),
        'stock_despues', v_nuevo_stock,
        'nivel',         v_nivel
      );
    END IF;

    IF NOT v_solo_validar THEN
      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id,
        tipo,
        motivo,
        motivo_tipo,
        producto_id,
        producto_nombre,
        cantidad,
        stock_anterior,
        stock_nuevo,
        usuario_id,
        usuario_nombre,
        usuario_color,
        cuenta_id
      ) VALUES (
        v_lote_id,
        'egreso',
        CASE
          WHEN v_nuevo_stock < 0 THEN 'Despacho #' || v_despacho.numero || ' aprobado [STOCK NEGATIVO]'
          ELSE 'Despacho #' || v_despacho.numero || ' aprobado'
        END,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        p_usuario_id,
        trim(p_usuario_nombre),
        p_usuario_color,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;
    END IF;
  END LOOP;

  -- Modo solo-lectura: devuelve el análisis proyectado sin cambiar nada.
  IF v_solo_validar THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'solo_validar', TRUE,
      'despacho_id', p_despacho_id,
      'venta_anticipada', COALESCE(v_cfg.permitir_negativo, FALSE),
      'productos', v_productos,
      'alertas_stock', v_alertas,
      'con_alertas', v_con_alertas
    );
  END IF;

  UPDATE public.notas_despacho
  SET estado = 'despachada',
      despachada_en = COALESCE(despachada_en, now()),
      aprobado_por_nombre = trim(p_usuario_nombre),
      alerta_stock = v_con_alertas,
      alerta_stock_items = CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END,
      egreso_lote_id = v_lote_id
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'venta_anticipada', COALESCE(v_cfg.permitir_negativo, FALSE),
    'productos', v_productos,
    'alertas_stock', v_alertas,
    'con_alertas', v_con_alertas,
    'alerta_stock', v_con_alertas,
    -- Compat cutover con el Worker legacy (salta su PATCH y no lee faltantes):
    'bloqueo_aplicado', TRUE,
    'faltantes', '[]'::JSONB,
    'con_faltantes', FALSE
  );
END;
$function$;

COMMENT ON FUNCTION public.aprobar_despacho_inventario_atomico(uuid, uuid, text, text, boolean) IS
  'Main egreso-inventario release 17: egreso + kardex al aprobar (pendiente→despachada); nunca bloquea por stock; alertas nivel BAJO/NEGATIVO.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. confirmar_entrega_inventario_atomica v2 (T2) — entrega SIN inventario.
--    El egreso ya ocurrió al aprobar; la entrega solo cambia estado.
--    Mantiene firma y validaciones; p_permitir_negativo queda sin efecto.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirmar_entrega_inventario_atomica(
  p_despacho_id uuid,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text,
  p_tasa_snapshot numeric DEFAULT NULL::numeric,
  p_permitir_negativo boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_egreso      BOOLEAN := FALSE;
  v_nuevo_stock NUMERIC(12,2);
  v_nivel       TEXT;
  v_alertas     JSONB := '[]'::JSONB;
  v_con_alertas BOOLEAN := FALSE;
  v_movimientos INTEGER := 0;
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: El despacho debe estar pendiente o aprobado';
  END IF;

  -- Entrega directa desde 'pendiente' (auto-entrega): nunca pasó por la v3,
  -- por lo que el egreso ocurre AHORA. Desde 'despachada' el egreso ya ocurrió
  -- al aprobar y la entrega no toca inventario.
  v_egreso := (v_despacho.estado = 'pendiente');

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  -- Release 17: la entrega normal (desde 'despachada') NO toca inventario: el
  -- descuento y el kardex ocurrieron al aprobar (v3) o en el backfill de
  -- cutover. Solo la entrega directa desde 'pendiente' egresa aquí.
  FOR v_item IN
    SELECT
      ndi.producto_id,
      MAX(ndi.nombre_snap) AS nombre_snap,
      SUM(ndi.cantidad)::NUMERIC(10,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
    ORDER BY ndi.producto_id
  LOOP
    SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
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

    IF v_egreso THEN
      v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) - v_item.cantidad;

      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id,
        tipo,
        motivo,
        motivo_tipo,
        producto_id,
        producto_nombre,
        cantidad,
        stock_anterior,
        stock_nuevo,
        usuario_id,
        usuario_nombre,
        usuario_color,
        cuenta_id
      ) VALUES (
        v_lote_id,
        'egreso',
        CASE
          WHEN v_nuevo_stock < 0 THEN 'Despacho #' || v_despacho.numero || ' entregado directo [STOCK NEGATIVO]'
          ELSE 'Despacho #' || v_despacho.numero || ' entregado directo'
        END,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        p_usuario_id,
        trim(p_usuario_nombre),
        p_usuario_color,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;

      v_nivel := CASE
        WHEN v_nuevo_stock < 0 THEN 'NEGATIVO'
        WHEN v_nuevo_stock < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
        ELSE NULL
      END;
      IF v_nivel IS NOT NULL THEN
        v_con_alertas := TRUE;
        v_alertas := v_alertas || jsonb_build_object(
          'producto_id',   v_producto.id,
          'nombre',        v_producto.nombre,
          'cantidad',      v_item.cantidad,
          'stock_antes',   COALESCE(v_producto.stock_actual, 0),
          'stock_despues', v_nuevo_stock,
          'nivel',         v_nivel
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.notas_despacho
  SET estado = 'entregada',
      despachada_en = COALESCE(despachada_en, now()),
      entregada_en = now(),
      tasa_snapshot = COALESCE(p_tasa_snapshot, tasa_snapshot),
      egreso_lote_id = CASE WHEN v_egreso THEN v_lote_id ELSE egreso_lote_id END,
      alerta_stock = CASE WHEN v_egreso THEN v_con_alertas ELSE alerta_stock END,
      alerta_stock_items = CASE
        WHEN v_egreso THEN (CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END)
        ELSE alerta_stock_items
      END
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'inventario', CASE WHEN v_egreso THEN 'egreso_directo' ELSE 'sin_movimiento' END,
    'stock_descontado_al_aprobar', NOT v_egreso,
    'alertas_stock', v_alertas,
    'alerta_stock', v_con_alertas
  );
END;
$function$;

COMMENT ON FUNCTION public.confirmar_entrega_inventario_atomica(uuid, uuid, text, text, numeric, boolean) IS
  'Main egreso-inventario release 17: la entrega ya no descuenta inventario (egreso al aprobar); solo valida y fija estado entregada. Excepcion: la entrega directa desde pendiente egresa aqui.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. revertir_entrega_inventario_atomica v2 (T2+T4)
--    entregada→despachada : SIN reingreso (el egreso ocurrió al aprobar).
--    entregada→pendiente / entregada→anulada : +cantidad (reingreso neto de
--    devoluciones, misma matemática que hoy) + kardex 'ingreso'.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revertir_entrega_inventario_atomica(
  p_despacho_id uuid,
  p_nuevo_estado text,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_movimientos INTEGER := 0;
  v_nuevo_stock NUMERIC(10,2);
  v_reingreso   BOOLEAN := p_nuevo_estado IN ('pendiente', 'anulada');
BEGIN
  IF p_despacho_id IS NULL OR p_nuevo_estado NOT IN ('pendiente', 'despachada', 'anulada') THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_INVALIDOS';
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
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede revertir un despacho entregado';
  END IF;

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  -- Release 17: revertir la entrega a 'despachada' NO reingresa — el egreso
  -- ocurrió al aprobar y la mercancía sigue fuera. El reingreso solo aplica
  -- cuando el despacho vuelve a 'pendiente' o se anula.
  IF v_reingreso THEN
    -- Originales: cantidad entregada menos devoluciones parciales asociadas a
    -- la línea original. Intercambios: cantidad entregada menos devoluciones
    -- parciales registradas sin despacho_item_id.
    FOR v_item IN
      SELECT producto_id, MAX(nombre_snap) AS nombre_snap, SUM(cantidad)::NUMERIC(10,2) AS cantidad
      FROM (
        SELECT
          ndi.producto_id,
          ndi.nombre_snap,
          ndi.cantidad - COALESCE(dev.cantidad_devuelta, 0) AS cantidad
        FROM public.notas_despacho_items ndi
        LEFT JOIN (
          SELECT despacho_item_id, SUM(cantidad_devuelta) AS cantidad_devuelta
          FROM public.despacho_devoluciones
          WHERE despacho_id = p_despacho_id
            AND despacho_item_id IS NOT NULL
          GROUP BY despacho_item_id
        ) dev ON dev.despacho_item_id = ndi.id
        WHERE ndi.despacho_id = p_despacho_id
          AND ndi.producto_id IS NOT NULL
          AND COALESCE(ndi.origen, 'inventario') = 'inventario'
          AND COALESCE(ndi.es_prestamo, FALSE) = FALSE

        UNION ALL

        SELECT
          intercambio.producto_id,
          intercambio.nombre_snap,
          intercambio.cantidad - COALESCE(dev.cantidad_devuelta, 0) AS cantidad
        FROM public.despacho_devolucion_intercambios intercambio
        LEFT JOIN (
          SELECT producto_id, SUM(cantidad_devuelta) AS cantidad_devuelta
          FROM public.despacho_devoluciones
          WHERE despacho_id = p_despacho_id
            AND despacho_item_id IS NULL
            AND producto_id IS NOT NULL
          GROUP BY producto_id
        ) dev ON dev.producto_id = intercambio.producto_id
        WHERE intercambio.despacho_id = p_despacho_id
          AND intercambio.producto_id IS NOT NULL
      ) neto
      WHERE cantidad > 0
      GROUP BY producto_id
      ORDER BY producto_id
    LOOP
      SELECT id, nombre, stock_actual, activo, cuenta_id
      INTO v_producto
      FROM public.productos
      WHERE id = v_item.producto_id
        AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
      FOR UPDATE;

      IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
      END IF;

      v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) + v_item.cantidad;

      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id,
        tipo,
        motivo,
        motivo_tipo,
        producto_id,
        producto_nombre,
        cantidad,
        stock_anterior,
        stock_nuevo,
        usuario_id,
        usuario_nombre,
        usuario_color,
        cuenta_id
      ) VALUES (
        v_lote_id,
        'ingreso',
        CASE
          WHEN p_nuevo_estado = 'anulada' THEN 'Anulación de despacho #' || v_despacho.numero
          ELSE 'Devolución a pendiente #' || v_despacho.numero
        END,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        p_usuario_id,
        trim(p_usuario_nombre),
        p_usuario_color,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;
    END LOOP;
  END IF;

  UPDATE public.notas_despacho
  SET estado = p_nuevo_estado,
      entregada_en = NULL,
      alerta_stock = CASE WHEN v_reingreso THEN FALSE ELSE alerta_stock END,
      alerta_stock_items = CASE WHEN v_reingreso THEN NULL ELSE alerta_stock_items END,
      -- Invariante release 17: egreso_lote_id NOT NULL <=> el despacho tiene un
      -- egreso vigente. Al reingresar se limpia para que el rollback pueda
      -- espejar exactamente los egresos aún activos.
      egreso_lote_id = CASE WHEN v_reingreso THEN NULL ELSE egreso_lote_id END
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'nuevo_estado', p_nuevo_estado,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'reingreso_aplicado', v_reingreso
  );
END;
$function$;

COMMENT ON FUNCTION public.revertir_entrega_inventario_atomica(uuid, text, uuid, text, text) IS
  'Main egreso-inventario release 17: revertir entrega a despachada no reingresa (egreso al aprobar); a pendiente/anulada reingresa neto de devoluciones.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. revertir_despacho_inventario_atomica (T4, NUEVA)
--    despachada→pendiente / despachada→anulada : +cantidad + kardex 'ingreso'
--    en la MISMA transacción del cambio de estado (locks FOR UPDATE).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.revertir_despacho_inventario_atomica(
  p_despacho_id uuid,
  p_nuevo_estado text,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_movimientos INTEGER := 0;
  v_nuevo_stock NUMERIC(10,2);
BEGIN
  IF p_despacho_id IS NULL OR p_nuevo_estado NOT IN ('pendiente', 'anulada') THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_DESPACHO_INVALIDOS';
  END IF;
  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'despachada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede revertir un despacho aprobado (estado actual: %)', v_despacho.estado;
  END IF;

  -- Sin devoluciones previas (solo ocurren post-entrega): reingreso íntegro.
  FOR v_item IN
    SELECT
      ndi.producto_id,
      MAX(ndi.nombre_snap) AS nombre_snap,
      SUM(ndi.cantidad)::NUMERIC(10,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
    ORDER BY ndi.producto_id
  LOOP
    SELECT id, nombre, stock_actual, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
    END IF;

    v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) + v_item.cantidad;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos (
      lote_id,
      tipo,
      motivo,
      motivo_tipo,
      producto_id,
      producto_nombre,
      cantidad,
      stock_anterior,
      stock_nuevo,
      usuario_id,
      usuario_nombre,
      usuario_color,
      cuenta_id
    ) VALUES (
      v_lote_id,
      'ingreso',
      CASE
        WHEN p_nuevo_estado = 'anulada' THEN 'Anulación de despacho #' || v_despacho.numero
        ELSE 'Despacho #' || v_despacho.numero || ' devuelto a pendiente'
      END,
      'venta',
      v_producto.id,
      COALESCE(v_item.nombre_snap, v_producto.nombre),
      v_item.cantidad,
      COALESCE(v_producto.stock_actual, 0),
      v_nuevo_stock,
      p_usuario_id,
      trim(p_usuario_nombre),
      p_usuario_color,
      v_producto.cuenta_id
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  UPDATE public.notas_despacho
  SET estado = p_nuevo_estado,
      entregada_en = NULL,
      alerta_stock = FALSE,
      alerta_stock_items = NULL,
      egreso_lote_id = NULL
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'nuevo_estado', p_nuevo_estado,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'reingreso_aplicado', TRUE
  );
END;
$function$;

COMMENT ON FUNCTION public.revertir_despacho_inventario_atomica(uuid, text, uuid, text, text) IS
  'Main egreso-inventario release 17: devolver a pendiente o anular desde despachada reingresa stock + kardex ingreso en la misma transacción.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. editar_despacho_profundidad — unificación de overloads (T3)
--    Cuerpo canónico (6 args): permite 'pendiente' y 'despachada'.
--      pendiente  → reemplaza ítems SIN tocar stock.
--      despachada → ± delta de stock + kardex de ajuste (ya egresado al aprobar).
--    Los overloads 2-arg (auth.uid()) y 5-arg delegan al canónico.
--    Nunca bloquea por stock (decisión de producto 2026-10-19).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id uuid,
  p_nuevos_items jsonb,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT 'Sistema'::text,
  p_usuario_rol text DEFAULT 'sistema'::text,
  p_forma_pago text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho     record;
  v_operador     record;
  v_item_json    record;
  v_producto     record;
  v_delta        record;
  v_origen       text;
  v_total_items  numeric(12,4) := 0;
  v_total_nuevo  numeric(12,4);
  v_estado       text;
  v_lote_id      uuid;
  v_nuevo_stock  numeric(12,2);
  v_mapa_viejo   jsonb := '{}'::jsonb;
  v_mapa_nuevo   jsonb := '{}'::jsonb;
  v_nivel        text;
  v_alertas      jsonb := '[]'::jsonb;
  v_con_alertas  boolean := false;
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  IF p_nuevos_items IS NULL
     OR jsonb_typeof(p_nuevos_items) <> 'array'
     OR jsonb_array_length(p_nuevos_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_INVALIDOS: Debe proporcionar al menos un item';
  END IF;

  SELECT id, cuenta_id, rol, activo, nombre
    INTO v_operador
  FROM public.usuarios
  WHERE id = p_usuario_id;

  IF NOT FOUND OR COALESCE(v_operador.activo, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Operador invalido o inactivo';
  END IF;

  IF v_operador.rol NOT IN (
    'administracion',
    'jefe',
    'desarrollador'
  ) THEN
    RAISE EXCEPTION
      'ACCESO_DENEGADO: Rol no autorizado para editar despachos a profundidad';
  END IF;

  IF p_usuario_rol IS DISTINCT FROM v_operador.rol THEN
    RAISE EXCEPTION
      'ACCESO_DENEGADO: El rol informado no coincide con el operador';
  END IF;

  SELECT *
    INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
    AND cuenta_id = v_operador.cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  v_estado := v_despacho.estado;
  IF v_estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION
      'ESTADO_INVALIDO: Solo se puede editar un despacho pendiente o aprobado';
  END IF;

  -- Toda validacion ocurre antes del DELETE. Un payload invalido conserva
  -- intacto el snapshot actual.
  PERFORM public.validar_items_despacho_sin_duplicados(p_nuevos_items);

  FOR v_item_json IN
    SELECT *
    FROM jsonb_to_recordset(p_nuevos_items) AS x(
      producto_id uuid,
      codigo_snap text,
      nombre_snap text,
      unidad_snap text,
      cantidad numeric,
      precio_unit_usd numeric,
      descuento_pct numeric,
      orden integer,
      origen text,
      es_prestamo boolean
    )
  LOOP
    IF v_item_json.nombre_snap IS NULL
       OR trim(v_item_json.nombre_snap) = '' THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: El nombre del producto es obligatorio';
    END IF;

    IF v_item_json.cantidad IS NULL
       OR v_item_json.cantidad <= 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: La cantidad debe ser mayor que cero';
    END IF;

    IF v_item_json.precio_unit_usd IS NULL
       OR v_item_json.precio_unit_usd < 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: El precio no puede ser negativo';
    END IF;

    IF COALESCE(v_item_json.descuento_pct, 0) < 0
       OR COALESCE(v_item_json.descuento_pct, 0) > 100 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Descuento fuera de rango';
    END IF;

    v_origen := COALESCE(
      NULLIF(trim(v_item_json.origen), ''),
      CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END
    );

    IF v_origen NOT IN ('inventario', 'externo') THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Origen no permitido';
    END IF;

    IF v_item_json.producto_id IS NULL
       AND v_origen <> 'externo' THEN
      RAISE EXCEPTION
        'ITEM_INVALIDO: Una linea sin producto_id debe ser externa';
    END IF;

    IF v_item_json.producto_id IS NOT NULL THEN
      SELECT id, cuenta_id, activo
        INTO v_producto
      FROM public.productos
      WHERE id = v_item_json.producto_id;

      IF NOT FOUND
         OR v_producto.cuenta_id IS DISTINCT FROM v_despacho.cuenta_id
         OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION
          'PRODUCTO_INVALIDO: Producto no disponible en la cuenta del despacho';
      END IF;
    END IF;
  END LOOP;

  -- Los despachos pendientes aun no han egresado stock: el reemplazo de líneas
  -- no toca inventario. En 'despachada' el egreso ya ocurrió al aprobar y el
  -- reemplazo aplica el delta (nuevo − viejo) por producto.
  -- Se captura el mapa viejo ANTES del DELETE para poder comparar después.
  SELECT COALESCE(jsonb_object_agg(t.producto_id, t.cantidad), '{}'::jsonb)
    INTO v_mapa_viejo
  FROM (
    SELECT ndi.producto_id::text AS producto_id,
           SUM(ndi.cantidad)::NUMERIC(12,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
  ) t;

  DELETE FROM public.notas_despacho_items
  WHERE despacho_id = p_despacho_id;

  FOR v_item_json IN
    SELECT *
    FROM jsonb_to_recordset(p_nuevos_items) AS x(
      producto_id uuid,
      codigo_snap text,
      nombre_snap text,
      unidad_snap text,
      cantidad numeric,
      precio_unit_usd numeric,
      descuento_pct numeric,
      orden integer,
      origen text,
      es_prestamo boolean
    )
  LOOP
    v_origen := COALESCE(
      NULLIF(trim(v_item_json.origen), ''),
      CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END
    );

    INSERT INTO public.notas_despacho_items (
      despacho_id,
      producto_id,
      codigo_snap,
      nombre_snap,
      unidad_snap,
      cantidad_original,
      precio_original,
      cantidad,
      precio_unit_usd,
      descuento_pct,
      total_linea_usd,
      orden,
      origen,
      es_prestamo,
      cuenta_id,
      editado_en,
      editado_por
    ) VALUES (
      p_despacho_id,
      v_item_json.producto_id,
      v_item_json.codigo_snap,
      v_item_json.nombre_snap,
      COALESCE(v_item_json.unidad_snap, 'und'),
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      COALESCE(v_item_json.descuento_pct, 0),
      CASE
        WHEN COALESCE(v_item_json.es_prestamo, false) THEN 0.0000
        ELSE v_item_json.cantidad * v_item_json.precio_unit_usd
          * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100)
      END,
      COALESCE(v_item_json.orden, 0),
      v_origen,
      COALESCE(v_item_json.es_prestamo, false),
      v_despacho.cuenta_id,
      now(),
      p_usuario_id
    );

    IF NOT COALESCE(v_item_json.es_prestamo, false) THEN
      v_total_items := v_total_items
        + v_item_json.cantidad * v_item_json.precio_unit_usd
        * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100);
    END IF;
  END LOOP;

  -- Mapa nuevo (tras el reemplazo de líneas) para el delta de inventario.
  SELECT COALESCE(jsonb_object_agg(t.producto_id, t.cantidad), '{}'::jsonb)
    INTO v_mapa_nuevo
  FROM (
    SELECT ndi.producto_id::text AS producto_id,
           SUM(ndi.cantidad)::NUMERIC(12,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
  ) t;

  -- ── Delta de inventario (solo estado 'despachada': ya egresado) ──────────
  -- delta > 0 → sale más mercancía (egreso); delta < 0 → regresa (ingreso).
  -- Nunca se bloquea por stock (decisión de producto 2026-10-19).
  IF v_estado = 'despachada' THEN
    v_lote_id := gen_random_uuid();

    FOR v_delta IN
      SELECT
        clave AS producto_id,
        COALESCE((v_mapa_nuevo ->> clave)::NUMERIC, 0)
          - COALESCE((v_mapa_viejo ->> clave)::NUMERIC, 0) AS delta
      FROM jsonb_object_keys(v_mapa_viejo || v_mapa_nuevo) AS clave
    LOOP
      IF COALESCE(v_delta.delta, 0) = 0 THEN
        CONTINUE;
      END IF;

      SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
        INTO v_producto
      FROM public.productos
      WHERE id = v_delta.producto_id::uuid
        AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
      FOR UPDATE;

      IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_delta.producto_id;
      END IF;

      v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) - v_delta.delta;

      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id,
        tipo,
        motivo,
        motivo_tipo,
        producto_id,
        producto_nombre,
        cantidad,
        stock_anterior,
        stock_nuevo,
        usuario_id,
        usuario_nombre,
        usuario_color,
        cuenta_id
      ) VALUES (
        v_lote_id,
        (CASE WHEN v_delta.delta > 0 THEN 'egreso' ELSE 'ingreso' END)::tipo_movimiento,
        'Edición de ítems Despacho #' || v_despacho.numero || ' (ajuste)',
        'venta',
        v_producto.id,
        v_producto.nombre,
        ABS(v_delta.delta),
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        p_usuario_id,
        COALESCE(trim(p_usuario_nombre), v_operador.nombre),
        NULL,
        v_producto.cuenta_id
      );
    END LOOP;

    -- Alerta de stock post-edición sobre los ítems nuevos del despacho.
    FOR v_delta IN
      SELECT clave AS producto_id, (v_mapa_nuevo ->> clave)::NUMERIC AS cantidad
      FROM jsonb_object_keys(v_mapa_nuevo) AS clave
    LOOP
      SELECT id, nombre, stock_actual, stock_minimo
        INTO v_producto
      FROM public.productos
      WHERE id = v_delta.producto_id::uuid;

      IF FOUND THEN
        v_nivel := CASE
          WHEN COALESCE(v_producto.stock_actual, 0) < 0 THEN 'NEGATIVO'
          WHEN COALESCE(v_producto.stock_actual, 0) < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
          ELSE NULL
        END;
        IF v_nivel IS NOT NULL THEN
          v_con_alertas := TRUE;
          v_alertas := v_alertas || jsonb_build_object(
            'producto_id',   v_producto.id,
            'nombre',        v_producto.nombre,
            'cantidad',      v_delta.cantidad,
            'stock_despues', COALESCE(v_producto.stock_actual, 0),
            'nivel',         v_nivel
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_total_nuevo := round(
    v_total_items
      + COALESCE(v_despacho.flete_usd, 0)
      + COALESCE(v_despacho.corte_usd, 0)
      - COALESCE(v_despacho.descuento_total_usd, 0),
    4
  );

  UPDATE public.notas_despacho
  SET total_usd = v_total_nuevo,
      forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
      forma_pago = COALESCE(p_forma_pago, forma_pago),
      items_editado_en = now(),
      items_editado_por = COALESCE(p_usuario_nombre, v_operador.nombre),
      alerta_stock = CASE WHEN v_estado = 'despachada' THEN v_con_alertas ELSE alerta_stock END,
      alerta_stock_items = CASE
        WHEN v_estado = 'despachada' THEN (CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END)
        ELSE alerta_stock_items
      END,
      actualizado_en = now()
  WHERE id = p_despacho_id
    AND cuenta_id = v_despacho.cuenta_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := COALESCE(p_usuario_nombre, v_operador.nombre),
    p_usuario_rol    := p_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'total_anterior', v_despacho.total_usd,
      'total_nuevo',    v_total_nuevo,
      'estado',         v_estado
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) IS
  'Main egreso-inventario release 17: edicion profunda unificada; en pendiente no toca stock, en despachada aplica delta + kardex de ajuste.';

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id uuid,
  p_nuevos_items jsonb,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT 'Sistema'::text,
  p_usuario_rol text DEFAULT 'sistema'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Overload unificado (release 17): delega al cuerpo canónico.
  PERFORM public.editar_despacho_profundidad(
    p_despacho_id, p_nuevos_items, p_usuario_id, p_usuario_nombre, p_usuario_rol, NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id uuid,
  p_nuevos_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
BEGIN
  -- Overload legacy unificado (release 17): resuelve el operador por auth.uid()
  -- y delega al cuerpo canónico.
  PERFORM public.editar_despacho_profundidad(
    p_despacho_id,
    p_nuevos_items,
    v_usuario_id,
    COALESCE((SELECT nombre FROM public.usuarios WHERE id = v_usuario_id), 'Sistema'),
    COALESCE((SELECT rol FROM public.usuarios WHERE id = v_usuario_id), 'sistema'),
    NULL
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Grants (T5): mínimos para las funciones vivas; retiro total para las
--    obsoletas del modelo antiguo (DROP coordinado posterior, plan §4.3).
-- ═══════════════════════════════════════════════════════════════════════════

-- Vivas: solo service_role (el Worker).
REVOKE ALL ON FUNCTION public.aprobar_despacho_inventario_atomico(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_despacho_inventario_atomico(uuid, uuid, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.confirmar_entrega_inventario_atomica(uuid, uuid, text, text, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_inventario_atomica(uuid, uuid, text, text, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.revertir_entrega_inventario_atomica(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_inventario_atomica(uuid, text, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.revertir_despacho_inventario_atomica(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_despacho_inventario_atomica(uuid, text, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) TO service_role;

-- Obsoletas del modelo antiguo: sin ejecución para nadie (cuerpos conservados
-- como evidencia; DROP en limpieza posterior coordinada).
REVOKE ALL ON FUNCTION public.obtener_stock_comprometido() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.obtener_stock_comprometido_detalle(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crear_nota_despacho(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anular_despacho_atomico(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.obtener_stock_comprometido() IS
  'OBSOLETA release 17: el stock comprometido fue eliminado (egreso al aprobar). DROP en limpieza coordinada.';
COMMENT ON FUNCTION public.obtener_stock_comprometido_detalle(uuid) IS
  'OBSOLETA release 17: el stock comprometido fue eliminado (egreso al aprobar). DROP en limpieza coordinada.';
COMMENT ON FUNCTION public.crear_nota_despacho(uuid, text) IS
  'OBSOLETA release 17: heredada del modelo "descuento al crear"; sin llamadores. DROP en limpieza coordinada.';
COMMENT ON FUNCTION public.anular_despacho_atomico(uuid, uuid, text, text) IS
  'OBSOLETA release 17: heredada del modelo "descuento al crear"; sin llamadores. DROP en limpieza coordinada.';

NOTIFY pgrst, 'reload schema';
COMMIT;
