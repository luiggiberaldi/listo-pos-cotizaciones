-- 281_staging_retira_actualizar_producto_kardex_16.sql
--
-- RETIRO de la variante de 16 parámetros de `actualizar_producto_con_kardex`
-- (STAGING). En producción ya no se usa nadie (verificación 2026-10-25); en
-- staging SÍ la usa la pantalla de Editar producto vía el envoltorio
-- `actualizar_producto_con_kardex_staging`, que hasta hoy le delega.
--
-- Por eso el retiro se hace en dos pasos dentro de la MISMA transacción:
--   1) el envoltorio ABSORBE la implementación (cuerpo idéntico al que delegaba:
--      el de la migración 279_staging, con el contrato de precios «vaciar limpia,
--      precio 0 = válido»), conservando su control de cuenta, su control de rol
--      y sus permisos;
--   2) se elimina la variante de 16 parámetros. La guarda de precios
--      (280_staging_guarda_precios_ddl) rechaza el borrado de funciones
--      protegidas, así que el DROP lleva el pase autorizado: el retiro es una
--      decisión de este release, no una pérdida del arreglo de precios.
--
-- Verificación: construacero-staging/scripts/apply-281-retiro-16-staging.mjs
-- (preflight → apply → postflight + prueba de comportamiento revertida vía el
-- envoltorio, el camino real de la pantalla).
-- Rollback: 281_staging_retira_actualizar_producto_kardex_16_rollback.sql
-- (restaura el envoltorio delegador y la variante de 16 args byte a byte desde
-- supabase/backup_pre_281_staging/).
-- Nota: la guarda sigue protegiendo el nombre retirado: si alguien lo recrea,
-- exigirá el marcador «contrato de precios» (o el pase autorizado).
--
-- Permisos: no cambian. El envoltorio conserva sus grants (CREATE OR REPLACE
-- no toca la ACL) y la variante eliminada se lleva los suyos.

BEGIN;

-- 1) El envoltorio de staging absorbe la implementación (mismo comportamiento).
CREATE OR REPLACE FUNCTION public.actualizar_producto_con_kardex_staging(
  p_id UUID,
  p_codigo TEXT DEFAULT NULL,
  p_nombre TEXT DEFAULT '',
  p_descripcion TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL,
  p_unidad TEXT DEFAULT 'und',
  p_precio_usd NUMERIC DEFAULT 0,
  p_costo_usd NUMERIC DEFAULT NULL,
  p_stock_actual NUMERIC DEFAULT 0,
  p_stock_minimo NUMERIC DEFAULT 0,
  p_imagen_url TEXT DEFAULT NULL,
  p_precio_2 NUMERIC DEFAULT NULL,
  p_precio_3 NUMERIC DEFAULT NULL,
  p_precio1_porcentaje NUMERIC DEFAULT NULL,
  p_precio2_porcentaje NUMERIC DEFAULT NULL,
  p_precio3_porcentaje NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id      UUID := auth.uid();
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
  -- Control de cuenta del envoltorio (igual que antes del retiro).
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

  -- 281: implementación propia (antes se delegaba en la variante de 16
  -- argumentos, retirada por esta migración).
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
$$;

-- 2) Retiro de la variante de 16 parámetros (pase autorizado de la guarda de
-- precios 280_staging: el DROP de una función protegida se rechaza sin él).
SET LOCAL app.precios_rollback_autorizado = 'REVERTIR_PRECIOS';
DROP FUNCTION IF EXISTS public.actualizar_producto_con_kardex(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric);

NOTIFY pgrst, 'reload schema';
COMMIT;
