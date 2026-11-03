-- 297_peso_viajes_flota_apply.sql — peso por viaje para el reporte de flota (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/297_staging_peso_viajes_flota.sql
-- Solo agrega una función de lectura. Reversa: 297_peso_viajes_flota_rollback_review.sql

-- 297_staging_peso_viajes_flota.sql  (reporte de flota con peso)
-- Una fila por viaje (despacho despachada/entregada del período, misma regla que el reporte de flota: fecha = creado_en)
-- con su peso total, cuántas líneas no tienen peso y la capacidad del camión. El reporte suma y compara en pantalla.
-- Peso por línea = copia guardada al crear la línea; en viajes aún "despachada" (no entregados) sin copia se usa el peso actual del producto.
-- Solo lectura. SECURITY DEFINER y ejecución reservada a service_role (como las demás funciones del reporte de flota).
-- Rollback: 297_staging_peso_viajes_flota_rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.obtener_peso_viajes_flota(
  p_cuenta_id UUID,
  p_fecha_inicio TIMESTAMPTZ,
  p_fecha_fin TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viajes JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.fecha DESC), '[]'::jsonb)
  INTO v_viajes
  FROM (
    SELECT
      nd.id AS despacho_id,
      nd.numero,
      nd.creado_en AS fecha,
      nd.vehiculo_id,
      nd.transportista_id,
      ROUND(COALESCE(nd.flete_usd, 0), 2) AS flete_usd,
      v.capacidad_kg,
      ROUND(COALESCE(SUM(i.cantidad * w.peso), 0), 3) AS peso_total_kg,
      (COUNT(i.id) FILTER (WHERE w.peso IS NULL))::INT AS items_sin_peso,
      COUNT(i.id)::INT AS items_total
    FROM public.notas_despacho nd
    LEFT JOIN public.vehiculos v ON v.id = nd.vehiculo_id
    LEFT JOIN public.notas_despacho_items i ON i.despacho_id = nd.id
    LEFT JOIN public.productos p ON p.id = i.producto_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(i.peso_unit_kg_snap, CASE WHEN nd.estado = 'despachada' THEN p.peso_kg END) AS peso
    ) w ON TRUE
    WHERE nd.cuenta_id = p_cuenta_id
      AND nd.estado IN ('despachada', 'entregada')
      AND nd.creado_en >= p_fecha_inicio
      AND nd.creado_en <= p_fecha_fin
      AND (nd.vehiculo_id IS NOT NULL OR nd.transportista_id IS NOT NULL)
    GROUP BY nd.id, v.capacidad_kg
    ORDER BY nd.creado_en DESC
    LIMIT 5000
  ) t;

  RETURN jsonb_build_object('ok', true, 'viajes', v_viajes);
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_peso_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_peso_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
