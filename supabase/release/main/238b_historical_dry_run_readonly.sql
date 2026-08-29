-- 238b_historical_dry_run_readonly.sql
-- READ ONLY - proyecto principal.
--
-- Este archivo solo propone cambios. No crea batches, no actualiza comisiones y
-- no cambia estados. Debe ejecutarse despues de validar los guardrails 238b.
-- Parametros requeridos:
--   SET app.comision_238b_cuenta_id = '<CUENTA_ID>';
--   SET app.comision_238b_batch_key = '<BATCH_KEY>';

BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

DO $$
BEGIN
  IF current_setting('app.comision_238b_cuenta_id', TRUE) IS NULL
     OR current_setting('app.comision_238b_batch_key', TRUE) IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_REQUERIDOS: app.comision_238b_cuenta_id y app.comision_238b_batch_key';
  END IF;
  IF to_regprocedure('public.comision_238b_pago_split(numeric,text,text)') IS NULL
     OR to_regprocedure('public.comision_238b_item_breakdown(numeric,text,text,text,boolean,boolean,text,numeric,numeric,numeric,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: instalar/revisar guardrails 238b';
  END IF;
END
$$;

WITH parametros AS (
  SELECT
    current_setting('app.comision_238b_cuenta_id')::UUID AS cuenta_id,
    current_setting('app.comision_238b_batch_key')::UUID AS batch_key
),
objetivo AS (
  SELECT
    c.id AS comision_id,
    c.despachoid AS despacho_id,
    c.vendedorid,
    c.estado AS estado_anterior,
    c.totalcomision AS total_anterior,
    c.comisioncabilla AS cabilla_anterior,
    c.comisionotros AS otros_anterior,
    c.comision_liberada AS liberada_anterior,
    c.comision_retenida AS retenida_anterior,
    c.montopagado AS montopagado_anterior,
    c.comision_cxc_excluida AS cxc_excluida_anterior,
    c.comision_pago_excluida AS pago_excluida_anterior,
    c.comision_otras_exclusiones AS otras_exclusiones_anterior,
    c.fraccion_no_cxc AS fraccion_anterior,
    c.pagadaen AS pagadaen_anterior,
    c.pagadapor AS pagadapor_anterior,
    c.detalle_extras AS detalle_extras_anterior,
    c.calculo_version AS calculo_version_anterior,
    c.politica_comision AS politica_anterior,
    c.fuente_calculo AS fuente_anterior,
    c.calculo_evidencia AS evidencia_anterior,
    nd.numero AS despacho_numero,
    nd.cotizacion_id,
    nd.estado AS despacho_estado,
    nd.total_usd,
    nd.forma_pago,
    nd.forma_pago_cliente,
    COALESCE(cl.vendedor_id, nd.vendedor_id) AS vendedor_comision_id,
    u.nombre AS vendedor_nombre,
    u.rol AS vendedor_rol,
    COALESCE(u.es_externo, FALSE) AS vendedor_es_externo,
    u.comision_pct AS vendedor_comision_pct,
    u.comision_pct_cabilla AS vendedor_comision_pct_cabilla,
    COALESCE(cfg.comision_categoria_cabilla, 'Cabilla') AS categoria_cabilla,
    COALESCE(cfg.comision_pct_cabilla, 2) AS cfg_pct_cabilla,
    COALESCE(cfg.comision_pct_otros, 3) AS cfg_pct_otros,
    COALESCE(cfg.comision_pct_externos, 3) AS cfg_pct_externos,
    COALESCE(cfg._comision_extras, '[]'::jsonb) AS cfg_extras,
    COALESCE(cfg.comision_ext_pct_cabilla, 2) AS cfg_ext_pct_cabilla,
    COALESCE(cfg.comision_ext_pct_otros, 3) AS cfg_ext_pct_otros,
    COALESCE(cfg.comision_ext_pct_externos, 3) AS cfg_ext_pct_externos,
    COALESCE(cfg._comision_ext_extras, '[]'::jsonb) AS cfg_ext_extras,
    p.batch_key
  FROM parametros p
  JOIN public.comisiones c ON c.cuentaid = p.cuenta_id
  JOIN public.notas_despacho nd ON nd.id = c.despachoid
  LEFT JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  LEFT JOIN LATERAL (
    SELECT cn.*
    FROM public.configuracion_negocio cn
    WHERE cn.cuenta_id = p.cuenta_id OR cn.id = 1
    ORDER BY CASE WHEN cn.cuenta_id = p.cuenta_id THEN 0 ELSE 1 END
    LIMIT 1
  ) cfg ON TRUE
  WHERE c.estado <> 'generada'
),
configuracion AS (
  SELECT
    o.*,
    lower(trim(o.categoria_cabilla)) AS categoria_cabilla_normalizada,
    CASE WHEN o.vendedor_es_externo THEN o.cfg_ext_pct_cabilla
      ELSE COALESCE(o.vendedor_comision_pct_cabilla, o.cfg_pct_cabilla) END AS pct_cabilla,
    CASE WHEN o.vendedor_es_externo THEN o.cfg_ext_pct_otros
      ELSE COALESCE(o.vendedor_comision_pct, o.cfg_pct_otros) END AS pct_otros,
    CASE WHEN o.vendedor_es_externo THEN o.cfg_ext_pct_externos
      ELSE o.cfg_pct_externos END AS pct_externos,
    CASE WHEN o.vendedor_es_externo THEN o.cfg_ext_extras ELSE o.cfg_extras END AS extras,
    public.comision_238b_pago_split(
      o.total_usd, o.forma_pago_cliente, o.forma_pago
    ) AS payment_split
  FROM objetivo o
),
items AS (
  SELECT
    o.comision_id,
    'despacho_snapshot'::TEXT AS item_source,
    ndi.total_linea_usd AS value_usd,
    COALESCE(prod.categoria, '') AS categoria,
    ndi.nombre_snap AS nombre,
    ndi.origen,
    COALESCE(ndi.es_prestamo, FALSE) AS es_prestamo
  FROM configuracion o
  JOIN public.notas_despacho_items ndi ON ndi.despacho_id = o.despacho_id
  LEFT JOIN public.productos prod ON prod.id = ndi.producto_id

  UNION ALL

  SELECT
    o.comision_id,
    'cotizacion_fallback'::TEXT AS item_source,
    GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS value_usd,
    COALESCE(prod.categoria, '') AS categoria,
    ci.nombre_snap AS nombre,
    ci.origen,
    FALSE AS es_prestamo
  FROM configuracion o
  JOIN public.cotizacion_items ci ON ci.cotizacion_id = o.cotizacion_id
  LEFT JOIN public.productos prod ON prod.id = ci.producto_id
  LEFT JOIN public.despacho_descuentos dd
    ON dd.despacho_id = o.despacho_id
   AND dd.cotizacion_item_id = ci.id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = o.despacho_id
  )
),
clasificados AS (
  SELECT
    i.comision_id,
    i.item_source,
    public.comision_238b_item_breakdown(
      i.value_usd,
      i.categoria,
      i.nombre,
      i.origen,
      i.es_prestamo,
      o.vendedor_es_externo,
      o.categoria_cabilla_normalizada,
      o.pct_cabilla,
      o.pct_otros,
      o.pct_externos,
      o.extras
    ) AS breakdown
  FROM items i
  JOIN configuracion o ON o.comision_id = i.comision_id
),
base AS (
  SELECT
    o.comision_id,
    o.batch_key,
    o.despacho_id,
    o.despacho_numero,
    o.vendedorid,
    o.vendedor_comision_id,
    o.vendedor_nombre,
    o.estado_anterior,
    o.total_anterior,
    o.cabilla_anterior,
    o.otros_anterior,
    o.liberada_anterior,
    o.retenida_anterior,
    o.montopagado_anterior,
    o.cxc_excluida_anterior,
    o.pago_excluida_anterior,
    o.otras_exclusiones_anterior,
    o.fraccion_anterior,
    o.pagadaen_anterior,
    o.pagadapor_anterior,
    o.detalle_extras_anterior,
    o.calculo_version_anterior,
    o.politica_anterior,
    o.fuente_anterior,
    o.evidencia_anterior,
    o.payment_split,
    o.vendedor_rol,
    o.vendedor_es_externo,
    o.despacho_estado,
    o.total_usd,
    o.pct_cabilla,
    o.pct_otros,
    o.pct_externos,
    COALESCE(SUM(CASE WHEN c.breakdown->>'bucket' = 'cabilla'
      THEN (c.breakdown->>'value_usd')::numeric ELSE 0 END), 0) AS base_cabilla,
    COALESCE(SUM(CASE WHEN c.breakdown->>'bucket' = 'otros'
      THEN (c.breakdown->>'value_usd')::numeric ELSE 0 END), 0) AS base_otros,
    COALESCE(SUM(CASE WHEN c.breakdown->>'bucket' = 'externo'
      THEN (c.breakdown->>'value_usd')::numeric ELSE 0 END), 0) AS base_externos,
    COALESCE(SUM(CASE WHEN COALESCE((c.breakdown->>'excluded')::boolean, FALSE)
      THEN COALESCE((c.breakdown->>'commission_excluded')::numeric, 0) ELSE 0 END), 0)
      AS excluded_products_commission,
    COALESCE(bool_or(c.item_source = 'cotizacion_fallback'), FALSE) AS used_cotizacion_fallback,
    COALESCE(jsonb_agg(
      c.breakdown || jsonb_build_object('item_source', c.item_source)
      ORDER BY c.comision_id
    ) FILTER (WHERE c.breakdown IS NOT NULL), '[]'::jsonb) AS item_evidence
  FROM configuracion o
  LEFT JOIN clasificados c ON c.comision_id = o.comision_id
  GROUP BY
    o.comision_id, o.batch_key, o.despacho_id, o.despacho_numero,
    o.vendedorid, o.vendedor_comision_id, o.vendedor_nombre,
    o.estado_anterior, o.total_anterior, o.cabilla_anterior,
    o.otros_anterior, o.liberada_anterior, o.retenida_anterior,
    o.montopagado_anterior, o.cxc_excluida_anterior,
    o.pago_excluida_anterior, o.otras_exclusiones_anterior,
    o.fraccion_anterior, o.pagadaen_anterior, o.pagadapor_anterior,
    o.detalle_extras_anterior, o.calculo_version_anterior,
    o.politica_anterior, o.fuente_anterior, o.evidencia_anterior,
    o.payment_split, o.vendedor_rol, o.vendedor_es_externo,
    o.despacho_estado, o.total_usd, o.pct_cabilla, o.pct_otros,
    o.pct_externos
),
extra_rows AS (
  SELECT
    c.comision_id,
    c.breakdown->>'category' AS category,
    MAX((c.breakdown->>'pct')::numeric) AS pct,
    SUM((c.breakdown->>'value_usd')::numeric) AS amount_usd,
    SUM((c.breakdown->>'commission')::numeric) AS raw_commission
  FROM clasificados c
  WHERE c.breakdown->>'bucket' = 'extra'
  GROUP BY c.comision_id, c.breakdown->>'category'
),
extra_totals AS (
  SELECT
    b.comision_id,
    COALESCE(SUM(e.raw_commission), 0) AS extra_raw_commission,
    COALESCE(SUM(round(e.raw_commission * COALESCE((b.payment_split->>'fraction')::numeric, 1), 2)), 0) AS extra_commission,
    COALESCE(jsonb_agg(jsonb_build_object(
      'cat', e.category,
      'pct', e.pct,
      'monto', round(e.amount_usd, 4),
      'comision', round(e.raw_commission * COALESCE((b.payment_split->>'fraction')::numeric, 1), 2)
    ) ORDER BY e.category) FILTER (WHERE e.category IS NOT NULL), '[]'::jsonb) AS detalle_extras_propuesto
  FROM base b
  LEFT JOIN extra_rows e ON e.comision_id = b.comision_id
  GROUP BY b.comision_id, b.payment_split
),
propuesta AS (
  SELECT
    b.*,
    COALESCE(e.extra_raw_commission, 0) AS extra_raw_commission,
    COALESCE(e.extra_commission, 0) AS extra_commission,
    COALESCE(e.detalle_extras_propuesto, '[]'::jsonb) AS detalle_extras_propuesto,
    round(
      b.base_cabilla * b.pct_cabilla / 100
      + b.base_otros * b.pct_otros / 100
      + b.base_externos * b.pct_externos / 100
      + COALESCE(e.extra_raw_commission, 0), 2
    ) AS raw_commission_before_payment,
    COALESCE((b.payment_split->>'fraction')::numeric, 1) AS fraction,
    round(b.base_cabilla * b.pct_cabilla / 100
      * COALESCE((b.payment_split->>'fraction')::numeric, 1), 2) AS proposed_cabilla,
    round((b.base_otros * b.pct_otros / 100
      + b.base_externos * b.pct_externos / 100)
      * COALESCE((b.payment_split->>'fraction')::numeric, 1), 2) AS proposed_otros
  FROM base b
  LEFT JOIN extra_totals e ON e.comision_id = b.comision_id
)
SELECT
  p.batch_key,
  p.comision_id,
  p.despacho_id,
  p.despacho_numero,
  p.vendedorid,
  p.vendedor_comision_id,
  p.vendedor_nombre,
  p.estado_anterior,
  p.total_anterior,
  p.cabilla_anterior,
  p.otros_anterior,
  p.liberada_anterior,
  p.retenida_anterior,
  p.montopagado_anterior,
  p.cxc_excluida_anterior,
  p.pago_excluida_anterior,
  p.otras_exclusiones_anterior,
  p.fraccion_anterior,
  p.pagadaen_anterior,
  p.pagadapor_anterior,
  p.detalle_extras_anterior,
  p.calculo_version_anterior,
  p.politica_anterior,
  p.fuente_anterior,
  p.evidencia_anterior,
  'generada'::TEXT AS estado_propuesto,
  p.proposed_cabilla,
  p.proposed_otros,
  round(p.proposed_cabilla + p.proposed_otros + p.extra_commission, 2) AS total_propuesto,
  CASE WHEN COALESCE((p.payment_split->>'excluded_by_payment')::boolean, FALSE)
    THEN 0
    ELSE round(p.raw_commission_before_payment
      - round(p.proposed_cabilla + p.proposed_otros + p.extra_commission, 2), 2)
  END AS comision_cxc_excluida_propuesta,
  CASE WHEN COALESCE((p.payment_split->>'excluded_by_payment')::boolean, FALSE)
    THEN p.raw_commission_before_payment ELSE 0 END AS comision_pago_excluida_propuesta,
  p.excluded_products_commission AS comision_otras_exclusiones_propuesta,
  round(p.fraction, 8) AS fraccion_no_cxc_propuesta,
  p.detalle_extras_propuesto,
  CASE
    WHEN p.montopagado_anterior IS DISTINCT FROM 0 THEN 'manual_review'
    WHEN p.pagadaen_anterior IS NOT NULL OR p.pagadapor_anterior IS NOT NULL THEN 'manual_review'
    WHEN p.vendedorid IS NULL THEN 'manual_review'
    WHEN p.vendedorid IS DISTINCT FROM p.vendedor_comision_id THEN 'manual_review'
    WHEN p.used_cotizacion_fallback THEN 'manual_review'
    WHEN p.total_usd IS NULL OR p.total_usd <= 0 THEN 'manual_review'
    WHEN p.payment_split->>'methods' = '[]' AND p.total_usd > 0 THEN 'manual_review'
    WHEN p.vendedor_rol IN ('admin', 'jefe', 'logistica', 'administracion', 'desarrollador') THEN 'manual_review'
    WHEN p.vendedor_rol = 'vendedor_sin_comision' AND NOT p.vendedor_es_externo THEN 'manual_review'
    WHEN COALESCE((p.payment_split->>'excluded_by_payment')::boolean, FALSE) THEN 'high_confidence_excluded_payment'
    ELSE 'high_confidence'
  END AS confidence,
  jsonb_build_object(
    'batch_key', p.batch_key,
    'policy', 'fecha_despacho_no_cxc',
    'calculation_version', '238b',
    'payment_split', p.payment_split,
    'previous', jsonb_build_object(
      'state', p.estado_anterior,
      'total', p.total_anterior,
      'detail_extras', p.detalle_extras_anterior,
      'calculation_version', p.calculo_version_anterior,
      'policy', p.politica_anterior,
      'source', p.fuente_anterior,
      'evidence', p.evidencia_anterior
    ),
    'bases', jsonb_build_object(
      'cabilla_usd', round(p.base_cabilla, 4),
      'otros_usd', round(p.base_otros, 4),
      'externos_usd', round(p.base_externos, 4),
      'excluded_products_commission', round(p.excluded_products_commission, 4),
      'used_cotizacion_fallback', p.used_cotizacion_fallback,
      'seller_mismatch', p.vendedorid IS DISTINCT FROM p.vendedor_comision_id
    ),
    'items', p.item_evidence
  ) AS evidence
FROM propuesta p
ORDER BY p.despacho_numero NULLS LAST, p.comision_id;

ROLLBACK;
