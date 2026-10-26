-- Pre-imagen viva del envoltorio (STAGING spupqgkdsgohxxfoxydl) — capturada 2026-10-26T01:47:07.633Z

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
$function$

