-- 242_alinear_reportes_fecha_entrega_efectiva.sql
-- STAGING ONLY durante esta fase.
-- Los timestamps de liberación y pago permanecen inmutables.

BEGIN;

-- Las funciones existentes conservan su contrato y solo cambian la expresión
-- de fecha del despacho. La sustitución se hace sobre la definición instalada
-- para no perder las correcciones acumuladas de las migraciones anteriores.
DO $$
DECLARE
  v_oid OID;
  v_sql TEXT;
BEGIN
  SELECT p.oid
    INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'obtener_reporte_ventas_operaciones'
     AND p.proargtypes = ARRAY['date'::regtype, 'date'::regtype, 'uuid'::regtype]::oidvector;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'REPORTE_OPERACIONES_FUNCION_AUSENTE';
  END IF;

  v_sql := pg_get_functiondef(v_oid);
  IF position('entregada_en_ajustada' in v_sql) = 0 THEN
    v_sql := replace(
      v_sql,
      'nd.creado_en',
      'COALESCE(nd.entregada_en_ajustada, nd.entregada_en, nd.creado_en)'
    );
  END IF;
  EXECUTE v_sql;

  SELECT p.oid
    INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'obtener_reporte_ventas_comisiones'
     AND p.proargtypes = ARRAY['timestamptz'::regtype, 'timestamptz'::regtype, 'uuid'::regtype]::oidvector;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'REPORTE_COMISIONES_FUNCION_AUSENTE';
  END IF;

  v_sql := pg_get_functiondef(v_oid);
  IF position('entregada_en_ajustada' in v_sql) = 0 THEN
    v_sql := replace(
      v_sql,
      'nd.creado_en',
      'COALESCE(nd.entregada_en_ajustada, nd.entregada_en, nd.creado_en)'
    );
  END IF;
  EXECUTE v_sql;
END;
$$;

-- El resumen conserva la fecha de liberación para la trazabilidad financiera,
-- pero clasifica el despacho en el período usando la fecha efectiva de entrega.
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
SET search_path = public
AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  WITH period_liberations AS (
    SELECT
      cl.comision_id,
      SUM(cl.monto) AS monto_liberado_periodo
    FROM public.comision_liberaciones cl
    JOIN public.comisiones c0 ON c0.id = cl.comision_id
    JOIN public.notas_despacho nd ON nd.id = c0.despachoid
    WHERE c0.cuentaid = p_cuenta_id
      AND (
        p_fecha_inicio IS NULL
        OR COALESCE(nd.entregada_en_ajustada, nd.entregada_en, nd.despachada_en, nd.creado_en) >= p_fecha_inicio
      )
      AND (
        p_fecha_fin IS NULL
        OR COALESCE(nd.entregada_en_ajustada, nd.entregada_en, nd.despachada_en, nd.creado_en) <= p_fecha_fin
      )
    GROUP BY cl.comision_id
  ),
  period_comisiones AS (
    SELECT
      c.id,
      c.totalcomision,
      c.comision_liberada,
      c.comision_retenida,
      c.montopagado,
      c.estado,
      pl.monto_liberado_periodo
    FROM public.comisiones c
    INNER JOIN period_liberations pl ON pl.comision_id = c.id
    WHERE c.cuentaid = p_cuenta_id
      AND (
        p_vendedor_id IS NULL
        OR (p_vendedor_id = v_uuid_nulo AND c.vendedorid IS NULL)
        OR c.vendedorid = p_vendedor_id
      )
      AND (
        p_estado IS NULL
        OR (p_estado = 'pendiente' AND c.estado IN ('pendiente', 'cta_cobrar'))
        OR c.estado = p_estado
      )
  )
  SELECT
    COALESCE(SUM(pc.monto_liberado_periodo), 0)::NUMERIC AS totalAcumulado,
    COALESCE(SUM(
      GREATEST(
        pc.monto_liberado_periodo
          - GREATEST(COALESCE(pc.montopagado, 0) - (pc.comision_liberada - pc.monto_liberado_periodo), 0),
        0
      )
    ), 0)::NUMERIC AS pendientePago,
    COALESCE(SUM(
      GREATEST(COALESCE(pc.montopagado, 0) - (pc.comision_liberada - pc.monto_liberado_periodo), 0)
    ), 0)::NUMERIC AS yaPagado,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado IN ('pendiente', 'cta_cobrar')) AS numPendientes,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado = 'pagada') AS numPagadas,
    COUNT(DISTINCT pc.id) AS total
  FROM period_comisiones pc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
