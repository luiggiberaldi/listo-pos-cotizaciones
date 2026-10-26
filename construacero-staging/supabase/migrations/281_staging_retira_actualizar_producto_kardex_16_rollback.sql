-- 281_staging_retira_actualizar_producto_kardex_16_rollback.sql
--
-- ROLLBACK de 281_staging_retira_actualizar_producto_kardex_16.sql.
-- Restaura la pre-imagen EXACTA (byte a byte) de:
--   * la variante de 16 parámetros de actualizar_producto_con_kardex, y
--   * el envoltorio actualizar_producto_con_kardex_staging (volvía a delegar),
-- capturadas de la base viva de STAGING con pg_get_functiondef el
-- 2026-10-26 (copias en supabase/backup_pre_281_staging/).
-- Los permisos se restauran explícitamente (la re-creación parte de ACL por
-- defecto). El pase autorizado de la guarda de precios va por consistencia: el
-- cuerpo de la variante sí lleva el marcador «contrato de precios».
-- ⚠️ Solo reversión. Re-aplicar el retiro después:
-- 281_staging_retira_actualizar_producto_kardex_16.sql.

BEGIN;

SET LOCAL app.precios_rollback_autorizado = 'REVERTIR_PRECIOS';

-- 1) Variante de 16 parámetros (pre-imagen exacta).
CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex(p_id uuid, p_codigo text DEFAULT NULL::text, p_nombre text DEFAULT ''::text, p_descripcion text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_unidad text DEFAULT 'und'::text, p_precio_usd numeric DEFAULT 0, p_costo_usd numeric DEFAULT NULL::numeric, p_stock_actual numeric DEFAULT 0, p_stock_minimo numeric DEFAULT 0, p_imagen_url text DEFAULT NULL::text, p_precio_2 numeric DEFAULT NULL::numeric, p_precio_3 numeric DEFAULT NULL::numeric, p_precio1_porcentaje numeric DEFAULT NULL::numeric, p_precio2_porcentaje numeric DEFAULT NULL::numeric, p_precio3_porcentaje numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_old_stock      NUMERIC(10,2);
  v_new_stock      NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'Solo supervisores, jefes, administración o desarrolladores pueden editar productos';
  END IF;

  SELECT stock_actual INTO v_old_stock
  FROM public.productos
  WHERE id = p_id AND activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  v_new_stock := COALESCE(p_stock_actual, 0);
  v_diff := v_new_stock - v_old_stock;

  -- 279: contrato de precios (vacío = NULL, precio 0 = válido)
  UPDATE public.productos SET
    codigo       = NULLIF(trim(p_codigo), ''),
    nombre       = trim(p_nombre),
    descripcion  = NULLIF(trim(p_descripcion), ''),
    categoria    = NULLIF(trim(p_categoria), ''),
    unidad       = COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
    precio_usd   = COALESCE(p_precio_usd, 0),
    precio_2     = p_precio_2,
    precio_3     = p_precio_3,
    precio1_porcentaje = p_precio1_porcentaje,
    precio2_porcentaje = p_precio2_porcentaje,
    precio3_porcentaje = p_precio3_porcentaje,
    costo_usd    = p_costo_usd,
    stock_actual = v_new_stock,
    stock_minimo = COALESCE(p_stock_minimo, 0),
    imagen_url   = COALESCE(NULLIF(trim(p_imagen_url), ''), imagen_url),
    actualizado_en = now()
  WHERE id = p_id
  RETURNING * INTO v_producto;

  IF v_diff != 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id,
       CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
       'Ajuste de stock al editar producto',
       'ajuste_inventario',
       v_producto.id, v_producto.nombre,
       abs(v_diff), v_old_stock, v_new_stock,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'precio_2', v_producto.precio_2,
    'precio_3', v_producto.precio_3,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en,
    'precio1_porcentaje', v_producto.precio1_porcentaje,
    'precio2_porcentaje', v_producto.precio2_porcentaje,
    'precio3_porcentaje', v_producto.precio3_porcentaje
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_producto_con_kardex(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric) TO PUBLIC, postgres, service_role;

-- 2) Envoltorio delegador (pre-imagen exacta).
CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex_staging(p_id uuid, p_codigo text DEFAULT NULL::text, p_nombre text DEFAULT ''::text, p_descripcion text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_unidad text DEFAULT 'und'::text, p_precio_usd numeric DEFAULT 0, p_costo_usd numeric DEFAULT NULL::numeric, p_stock_actual numeric DEFAULT 0, p_stock_minimo numeric DEFAULT 0, p_imagen_url text DEFAULT NULL::text, p_precio_2 numeric DEFAULT NULL::numeric, p_precio_3 numeric DEFAULT NULL::numeric, p_precio1_porcentaje numeric DEFAULT NULL::numeric, p_precio2_porcentaje numeric DEFAULT NULL::numeric, p_precio3_porcentaje numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_id UUID := auth.uid();
BEGIN
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_STAGING_NO_ENCONTRADA';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.productos
    WHERE id = p_id
      AND cuenta_id = v_cuenta_id
      AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'PRODUCTO_STAGING_NO_DISPONIBLE';
  END IF;

  RETURN public.actualizar_producto_con_kardex(
    p_id, p_codigo, p_nombre, p_descripcion, p_categoria, p_unidad,
    p_precio_usd, p_costo_usd, p_stock_actual, p_stock_minimo,
    p_imagen_url, p_precio_2, p_precio_3,
    p_precio1_porcentaje, p_precio2_porcentaje, p_precio3_porcentaje
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_producto_con_kardex_staging(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex_staging(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric) TO authenticated, postgres;

NOTIFY pgrst, 'reload schema';
COMMIT;
