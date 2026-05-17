-- 130_comisiones_v2_fixes.sql
-- FASE 2: Correcciones prioritarias al módulo de comisiones
-- FASE 2.1: Endurecimiento de cálculos y soporte para vendedor nulo

-- 1. Permitir vendedorid NULL en comisiones para no bloquear entregas
ALTER TABLE public.comisiones ALTER COLUMN vendedorid DROP NOT NULL;

-- 2. Actualizar calcularcomisiondespacho para no fallar si falta vendedor
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho RECORD;
  v_tiene_items_despacho BOOLEAN;
  v_pct_cabilla NUMERIC;
  v_pct_otros NUMERIC;
  v_cat_cabilla TEXT;
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT;
  v_comisionid UUID;
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despachoid = p_despachoid) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho + vendedor del cliente (dueño)
  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
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

  -- REGLA FASE 2: No bloquear si el cliente no tiene vendedor.
  -- Se insertará con vendedorid = NULL para auditoría.

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
    v_despacho.vendedor_dueno_cliente_id, -- Puede ser NULL
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

-- 3. Nueva RPC para resumen compatible con v2 (Ajustada en Fase 2.1)
CREATE OR REPLACE FUNCTION public.obtener_resumen_comisiones_v2(
  p_cuenta_id UUID,
  p_vendedor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  totalAcumulado NUMERIC,
  pendientePago NUMERIC,
  yaPagado NUMERIC,
  numPendientes BIGINT,
  numPagadas BIGINT,
  total BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(totalcomision), 0)::NUMERIC AS totalAcumulado,
    
    COALESCE(SUM(CASE 
      WHEN estado IN ('pendiente', 'cta_cobrar') 
      THEN GREATEST(totalcomision - COALESCE(montopagado, 0), 0)
      ELSE 0 
    END), 0)::NUMERIC AS pendientePago,
    
    COALESCE(SUM(COALESCE(montopagado, 0)), 0)::NUMERIC AS yaPagado,
    
    COUNT(*) FILTER (WHERE estado IN ('pendiente', 'cta_cobrar')) AS numPendientes,
    
    COUNT(*) FILTER (WHERE estado = 'pagada') AS numPagadas,
    
    COUNT(*) AS total
  FROM public.comisiones
  WHERE cuentaid = p_cuenta_id
    AND (
      p_vendedor_id IS NULL 
      OR (p_vendedor_id = v_uuid_nulo AND vendedorid IS NULL)
      OR (vendedorid = p_vendedor_id)
    )
    AND (
      p_estado IS NULL 
      OR (p_estado = 'pendiente' AND estado IN ('pendiente', 'cta_cobrar'))
      OR (estado = p_estado)
    )
    AND (p_fecha_inicio IS NULL OR creadoen >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR creadoen <= p_fecha_fin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
