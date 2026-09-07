-- 269: RPC de aprobación suavizada ("advertir, no bloquear")
--
-- Cambios sobre 268 (regla aprobada 2026-09-06: NADA bloquea aprobaciones):
--   * La validación de stock disponible ya NO rechaza: el faltante se devuelve
--     en la respuesta como `faltantes` y la aprobación sigue su curso.
--   * Nuevo modo p_solo_validar (solo lectura): devuelve el análisis sin tocar
--     nada — lo usará el modal de confirmación de la UI.
--   * Se conservan los rechazos NO relacionados con stock (estado inválido,
--     producto inactivo) porque son errores reales, no advertencias.

CREATE OR REPLACE FUNCTION public.aprobar_despacho_inventario_atomico(
  p_despacho_id     UUID,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_usuario_color   TEXT DEFAULT NULL,
  p_solo_validar    BOOLEAN DEFAULT FALSE
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
  v_faltantes     JSONB := '[]'::JSONB;
  v_bloquear      BOOLEAN := FALSE;
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

  SELECT COALESCE(cn.bloqueo_stock_aprobacion, FALSE) AS bloquear,
         COALESCE(cn.permitir_stock_negativo, FALSE) AS permitir_negativo
  INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  v_bloquear := COALESCE(v_cfg.bloquear, FALSE);
  IF NOT v_bloquear THEN
    RETURN jsonb_build_object('ok', TRUE, 'bloqueo_aplicado', FALSE, 'despacho_id', p_despacho_id);
  END IF;

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
    IF v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_INVALIDA: %', v_item.nombre_snap;
    END IF;

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

    v_productos := v_productos || jsonb_build_object(
      'producto_id',   v_producto.id,
      'nombre',        v_producto.nombre,
      'fisico',        v_producto.stock_actual,
      'comprometido',  COALESCE(v_comprometido, 0),
      'disponible',    v_disponible,
      'requerido',     v_item.cantidad
    );

    -- ⚠️ CAMBIO v2 (269): el faltante NO rechaza — se informa.
    IF v_disponible < v_item.cantidad THEN
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto_id',   v_producto.id,
        'nombre',        v_producto.nombre,
        'disponible',    v_disponible,
        'comprometido',  COALESCE(v_comprometido, 0),
        'requerido',     v_item.cantidad,
        'deficit',       v_item.cantidad - v_disponible
      );
    END IF;
  END LOOP;

  -- Modo solo-lectura: devuelve el análisis sin cambiar nada.
  IF COALESCE(p_solo_validar, FALSE) THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'solo_validar', TRUE,
      'bloqueo_aplicado', FALSE,
      'despacho_id', p_despacho_id,
      'venta_anticipada', COALESCE(v_cfg.permitir_negativo, FALSE),
      'productos', v_productos,
      'faltantes', v_faltantes
    );
  END IF;

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
    'productos', v_productos,
    'faltantes', v_faltantes,
    'con_faltantes', (v_faltantes <> '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aprobar_despacho_inventario_atomico(UUID, UUID, TEXT, TEXT, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_despacho_inventario_atomico(UUID, UUID, TEXT, TEXT, BOOLEAN)
  TO authenticated;
