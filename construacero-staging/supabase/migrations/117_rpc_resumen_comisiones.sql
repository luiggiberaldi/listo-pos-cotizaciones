-- 117_rpc_resumen_comisiones.sql

CREATE OR REPLACE FUNCTION public.obtener_resumen_comisiones(
  p_cuenta_id UUID,
  p_vendedor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  pendiente NUMERIC,
  retenida NUMERIC,
  pagado NUMERIC,
  total NUMERIC,
  count_pendiente BIGINT,
  count_pagado BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE 
      WHEN estado IN ('retenida', 'pago_parcial', 'liberada') 
      THEN GREATEST(0, comision_liberada - COALESCE(comision_pagada_monto, 0)) 
      ELSE 0 
    END), 0)::NUMERIC AS pendiente,
    
    COALESCE(SUM(CASE 
      WHEN estado IN ('retenida', 'pago_parcial', 'liberada') 
      THEN comision_retenida 
      ELSE 0 
    END), 0)::NUMERIC AS retenida,
    
    COALESCE(SUM(COALESCE(comision_pagada_monto, 0)), 0)::NUMERIC AS pagado,
    
    COALESCE(SUM(total_comision), 0)::NUMERIC AS total,
    
    COUNT(*) FILTER (WHERE estado IN ('retenida', 'pago_parcial', 'liberada')) AS count_pendiente,
    
    COUNT(*) FILTER (WHERE estado = 'pagada') AS count_pagado
  FROM public.comisiones
  WHERE cuenta_id = p_cuenta_id
    AND (
      p_vendedor_id IS NULL 
      OR (p_vendedor_id = v_uuid_nulo AND vendedor_id IS NULL)
      OR (vendedor_id = p_vendedor_id)
    )
    AND (
      p_estado IS NULL 
      OR (p_estado = 'pendiente' AND estado IN ('retenida', 'pago_parcial', 'liberada'))
      OR (estado = p_estado)
    )
    AND (p_fecha_inicio IS NULL OR creado_en >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR creado_en <= p_fecha_fin);
END;
$$;
