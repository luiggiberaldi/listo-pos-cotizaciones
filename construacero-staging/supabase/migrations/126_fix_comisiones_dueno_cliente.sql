-- 126_fix_comisiones_dueno_cliente.sql
-- Las comisiones deben asignarse al dueno del cliente, no al usuario que creo
-- la cotizacion, el despacho o la venta rapida.

CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_comisionid UUID;
  v_despacho RECORD;
  v_cat_cabilla TEXT;
  v_pct_cabilla NUMERIC(5,2) := 0;
  v_pct_otros NUMERIC(5,2) := 0;
  v_monto_cabilla NUMERIC(12,4) := 0;
  v_monto_otros NUMERIC(12,4) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT := 'pendiente';
  v_tiene_items_despacho BOOLEAN := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
  ) THEN
    RETURN NULL;
  END IF;

  SELECT
    nd.id,
    nd.cotizacion_id,
    nd.cuenta_id,
    nd.estado,
    nd.cliente_id,
    cl.vendedor_id AS vendedor_dueno_cliente_id
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RETURN NULL;
  END IF;

  IF v_despacho.cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_ID_REQUERIDO';
  END IF;

  IF v_despacho.vendedor_dueno_cliente_id IS NULL THEN
    RAISE EXCEPTION 'CLIENTE_SIN_VENDEDOR';
  END IF;

  SELECT
    COALESCE(cn.comision_pct_cabilla, 0) AS comision_pct_cabilla,
    COALESCE(cn.comision_pct_otros, 0) AS comision_pct_otros,
    COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla') AS comision_categoria_cabilla
  INTO v_pct_cabilla, v_pct_otros, v_cat_cabilla
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
     OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_cat_cabilla := 'Cabilla';
  END IF;

  v_cat_cabilla := lower(trim(v_cat_cabilla));

  SELECT EXISTS (
    SELECT 1
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    SELECT
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN ndi.total_linea_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN 0 ELSE ndi.total_linea_usd END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN ci.total_linea_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN 0 ELSE ci.total_linea_usd END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id;
  END IF;

  v_comision_cabilla := ROUND((v_monto_cabilla * v_pct_cabilla / 100)::numeric, 2);
  v_comision_otros := ROUND((v_monto_otros * v_pct_otros / 100)::numeric, 2);
  v_total_comision := v_comision_cabilla + v_comision_otros;

  IF EXISTS (
    SELECT 1
    FROM public.cuentas_por_cobrar cxc
    WHERE cxc.despacho_id = p_despachoid
      AND cxc.tipo = 'cargo'
      AND COALESCE(cxc.saldo_usd, 0) > 0
  ) THEN
    v_estado := 'cta_cobrar';
  ELSE
    v_estado := 'pendiente';
  END IF;

  INSERT INTO public.comisiones (
    despachoid,
    vendedorid,
    cotizacionid,
    cuentaid,
    totalcomision,
    comisioncabilla,
    comisionotros,
    pctcabilla,
    pctotros,
    estado
  ) VALUES (
    p_despachoid,
    v_despacho.vendedor_dueno_cliente_id,
    v_despacho.cotizacion_id,
    v_despacho.cuenta_id,
    v_total_comision,
    v_comision_cabilla,
    v_comision_otros,
    v_pct_cabilla,
    v_pct_otros,
    v_estado
  )
  RETURNING id INTO v_comisionid;

  RETURN v_comisionid;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(p_despacho_id UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT public.calcularcomisiondespacho(p_despacho_id);
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calcular_comision_despacho(UUID) TO authenticated, service_role;

UPDATE public.comisiones com
SET vendedorid = cl.vendedor_id,
    actualizadoen = now()
FROM public.notas_despacho nd
JOIN public.clientes cl ON cl.id = nd.cliente_id
WHERE com.despachoid = nd.id
  AND cl.vendedor_id IS NOT NULL
  AND com.vendedorid IS DISTINCT FROM cl.vendedor_id;
