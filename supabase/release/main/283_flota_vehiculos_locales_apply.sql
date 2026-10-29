-- 283_flota_vehiculos_locales_apply.sql — APLICACIÓN del plan de flota (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/283_flota_vehiculos_locales.sql
-- precedida de una compuerta REVIEW_ONLY (ver README de este directorio).
--
-- Antes de ejecutar (raíl R3):
--   1. Migración probada en staging (apply + rollback + re-apply) y registrada en docs/operaciones/.
--   2. Respaldo verificable de producción.
--   3. 283_flota_preflight_readonly.sql ejecutado y guardado.
--   4. Quitar EXPLÍCITAMENTE el bloque REVIEW_ONLY de abajo, en la ventana autorizada.
-- Después: 283_flota_postflight_readonly.sql. Reversa: 283_flota_vehiculos_locales_rollback_review.sql.
-- Prohibido: supabase db push / db reset / migration repair.

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: 283 flota requiere ventana autorizada y respaldo verificable'; END $$;

-- 283_flota_vehiculos_locales.sql
-- Control de flota propia (vehículos) y productividad de choferes locales.
-- Plan: docs/plans/2026-10-26-plan-flota-vehiculos-choferes.md (raíles R1-R13)
--
-- Nota de nombres: este sistema usa creado_en / actualizado_en (no created_at),
-- las placas viven en placa_chuto / placa_batea y la capacidad actual es texto.

BEGIN;

-- ============================================================================
-- 1. CATÁLOGO DE VEHÍCULOS DE LA EMPRESA (FLOTA PROPIA)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vehiculos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id      UUID NOT NULL,
  codigo         TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  placa          TEXT NOT NULL,
  capacidad_kg   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (capacidad_kg >= 0),
  color_batea    TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculos_cuenta_placa
  ON public.vehiculos(cuenta_id, placa);
CREATE INDEX IF NOT EXISTS idx_vehiculos_cuenta_activo
  ON public.vehiculos(cuenta_id, activo);

CREATE TRIGGER trg_vehiculos_updated
  BEFORE UPDATE ON public.vehiculos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Permisos de la casa: aislamiento estricto por cuenta + lectura autenticada.
-- Sin INSERT/UPDATE/DELETE directos: solo el Worker (service_role) escribe.
ALTER TABLE public.vehiculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isolation_vehiculos ON public.vehiculos;
CREATE POLICY isolation_vehiculos ON public.vehiculos
  AS RESTRICTIVE FOR ALL
  USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS vehiculos_lectura ON public.vehiculos;
CREATE POLICY vehiculos_lectura ON public.vehiculos
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

-- ============================================================================
-- 2. VINCULACIONES (columnas nuevas, sin tocar datos existentes)
-- ============================================================================
ALTER TABLE public.transportistas
  ADD COLUMN IF NOT EXISTS vehiculo_habitual_id UUID
    REFERENCES public.vehiculos(id) ON DELETE SET NULL;

ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS vehiculo_id UUID
    REFERENCES public.vehiculos(id) ON DELETE SET NULL;

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS vehiculo_id UUID
    REFERENCES public.vehiculos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vehiculo_origen TEXT
    CHECK (vehiculo_origen IN ('manual', 'auto_habitual', 'backfill'));

COMMENT ON COLUMN public.notas_despacho.vehiculo_origen IS
  'Cómo se asignó el vehículo: manual (operador), auto_habitual (trigger) o backfill (estimado histórico, se muestra con ≈).';

CREATE INDEX IF NOT EXISTS idx_despachos_vehiculo_fecha
  ON public.notas_despacho(cuenta_id, vehiculo_id, creado_en)
  WHERE vehiculo_id IS NOT NULL;

-- ============================================================================
-- 3. BACKFILL CONSERVADOR (marcado como ESTIMADO, nunca como dato real)
--    - Solo choferes locales con cuenta asignada.
--    - Solo si tienen una placa confiable (chuto o batea); si no, se omite y se avisa.
--    - Los viajes históricos quedan con vehiculo_origen = 'backfill' (se muestra con ≈).
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  v_vehiculo_id UUID;
  v_placa TEXT;
  v_despachos_marcados INT := 0;
  v_filas INT;
  v_sin_placa INT := 0;
  v_sin_cuenta INT := 0;
BEGIN
  SELECT COUNT(*) INTO v_sin_cuenta
  FROM public.transportistas
  WHERE es_local = true AND cuenta_id IS NULL;

  FOR r IN
    SELECT id, cuenta_id, nombre,
           COALESCE(NULLIF(btrim(COALESCE(placa_chuto, '')), ''),
                    NULLIF(btrim(COALESCE(placa_batea, '')), '')) AS placa_limpia,
           color_batea,
           vehiculo
    FROM public.transportistas
    WHERE es_local = true
      AND cuenta_id IS NOT NULL
      AND vehiculo_habitual_id IS NULL
  LOOP
    v_placa := upper(r.placa_limpia);
    IF v_placa IS NULL THEN
      v_sin_placa := v_sin_placa + 1;
      CONTINUE;  -- sin placa confiable no se inventa vehículo: revisión manual
    END IF;

    INSERT INTO public.vehiculos (cuenta_id, codigo, nombre, placa, color_batea)
    VALUES (
      r.cuenta_id,
      'VEH-' || substr(replace(v_placa, '-', ''), 1, 6),
      COALESCE(NULLIF(btrim(COALESCE(r.vehiculo, '')), ''), 'Vehículo ' || v_placa),
      v_placa,
      r.color_batea
    )
    ON CONFLICT (cuenta_id, placa) DO UPDATE SET actualizado_en = now()
    RETURNING id INTO v_vehiculo_id;

    UPDATE public.transportistas
    SET vehiculo_habitual_id = v_vehiculo_id
    WHERE id = r.id AND cuenta_id = r.cuenta_id;

    UPDATE public.notas_despacho
    SET vehiculo_id = v_vehiculo_id,
        vehiculo_origen = 'backfill'
    WHERE transportista_id = r.id
      AND cuenta_id = r.cuenta_id
      AND vehiculo_id IS NULL;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    v_despachos_marcados := v_despachos_marcados + v_filas;
  END LOOP;

  RAISE NOTICE 'Backfill flota: % despachos marcados como estimados; % choferes sin placa (revisar a mano); % choferes sin cuenta (omitidos)',
    v_despachos_marcados, v_sin_placa, v_sin_cuenta;
END $$;

-- ============================================================================
-- 4. TRIGGER: AUTOCOMPLETAR VEHÍCULO EN DESPACHOS LOCALES
--    - Externos: nunca llevan vehículo propio.
--    - Local sin vehículo explícito: hereda su vehículo habitual.
--    - Vehículo explícito de otra cuenta: rechaza el guardado.
--    - El origen solo se rellena si venía vacío (respeta el backfill).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_autocompletar_vehiculo_despacho()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_es_local BOOLEAN;
  v_habitual_id UUID;
  v_cuenta_vehiculo UUID;
BEGIN
  IF NEW.transportista_id IS NULL THEN
    NEW.vehiculo_id := NULL;
    NEW.vehiculo_origen := NULL;
    RETURN NEW;
  END IF;

  SELECT es_local, vehiculo_habitual_id
  INTO v_es_local, v_habitual_id
  FROM public.transportistas
  WHERE id = NEW.transportista_id AND cuenta_id = NEW.cuenta_id;

  IF COALESCE(v_es_local, false) = false THEN
    NEW.vehiculo_id := NULL;
    NEW.vehiculo_origen := NULL;
    RETURN NEW;
  END IF;

  IF NEW.vehiculo_id IS NOT NULL THEN
    SELECT cuenta_id INTO v_cuenta_vehiculo
    FROM public.vehiculos WHERE id = NEW.vehiculo_id;

    IF v_cuenta_vehiculo IS NULL OR v_cuenta_vehiculo <> NEW.cuenta_id THEN
      RAISE EXCEPTION 'VEHICULO_NO_PERTENECE_A_LA_CUENTA';
    END IF;

    IF NEW.vehiculo_origen IS NULL THEN
      NEW.vehiculo_origen := 'manual';
    END IF;
  ELSIF v_habitual_id IS NOT NULL THEN
    NEW.vehiculo_id := v_habitual_id;
    IF NEW.vehiculo_origen IS NULL THEN
      NEW.vehiculo_origen := 'auto_habitual';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autocompletar_vehiculo_despacho ON public.notas_despacho;
CREATE TRIGGER trg_autocompletar_vehiculo_despacho
  BEFORE INSERT OR UPDATE OF transportista_id, vehiculo_id
  ON public.notas_despacho
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_autocompletar_vehiculo_despacho();

-- ============================================================================
-- 5. RPC: ELIMINAR O DESACTIVAR VEHÍCULO (protección de historial)
--    REGLA (raíl R1): NUNCA se borran cotizaciones ni notas. Si hay viajes,
--    solo se desactiva; si no hay viajes, se desenlazan las cotizaciones.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.eliminar_o_desactivar_vehiculo_atomico(
  p_cuenta_id UUID,
  p_vehiculo_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viajes_count BIGINT;
  v_choferes_desvinculados INT;
  v_cotizaciones_desvinculadas INT;
BEGIN
  PERFORM 1 FROM public.vehiculos
  WHERE id = p_vehiculo_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VEHICULO_NO_ENCONTRADO';
  END IF;

  SELECT COUNT(*) INTO v_viajes_count
  FROM public.notas_despacho
  WHERE cuenta_id = p_cuenta_id AND vehiculo_id = p_vehiculo_id;

  UPDATE public.transportistas
  SET vehiculo_habitual_id = NULL
  WHERE cuenta_id = p_cuenta_id AND vehiculo_habitual_id = p_vehiculo_id;
  GET DIAGNOSTICS v_choferes_desvinculados = ROW_COUNT;

  IF v_viajes_count = 0 THEN
    -- Solo desenlazar: las cotizaciones son documentos de venta y NO se borran.
    UPDATE public.cotizaciones
    SET vehiculo_id = NULL
    WHERE cuenta_id = p_cuenta_id AND vehiculo_id = p_vehiculo_id;
    GET DIAGNOSTICS v_cotizaciones_desvinculadas = ROW_COUNT;

    DELETE FROM public.vehiculos
    WHERE id = p_vehiculo_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true,
      'accion', 'eliminado_fisico',
      'viajes_historicos', 0,
      'choferes_desvinculados', v_choferes_desvinculados,
      'cotizaciones_desvinculadas', v_cotizaciones_desvinculadas
    );
  ELSE
    UPDATE public.vehiculos
    SET activo = false, actualizado_en = now()
    WHERE id = p_vehiculo_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true,
      'accion', 'desactivado_logico',
      'viajes_historicos', v_viajes_count,
      'choferes_desvinculados', v_choferes_desvinculados
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_o_desactivar_vehiculo_atomico(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_o_desactivar_vehiculo_atomico(UUID, UUID) TO service_role;

-- ============================================================================
-- 6. RPC: ELIMINAR O DESACTIVAR CHOFER/TRANSPORTISTA
--    - Fletes pendientes de liquidar → BLOQUEA la baja (Caso 3).
--    - Historial (viajes, cotizaciones o pagos) → solo desactiva.
--    - Sin historial → borrado definitivo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.eliminar_o_desactivar_transportista_atomico(
  p_cuenta_id UUID,
  p_transportista_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viajes BIGINT;
  v_cotizaciones BIGINT;
  v_pagos BIGINT;
  v_pendientes BIGINT;
BEGIN
  PERFORM 1 FROM public.transportistas
  WHERE id = p_transportista_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSPORTISTA_NO_ENCONTRADO';
  END IF;

  SELECT COUNT(*) INTO v_pendientes
  FROM public.notas_despacho
  WHERE cuenta_id = p_cuenta_id
    AND transportista_id = p_transportista_id
    AND estado IN ('despachada', 'entregada')
    AND flete_pagado = false
    AND COALESCE(flete_neto_transportista_usd, 0) > 0;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'TIENE_FLETES_PENDIENTES: % viaje(s) sin liquidar al chofer', v_pendientes;
  END IF;

  SELECT COUNT(*) INTO v_viajes
  FROM public.notas_despacho
  WHERE cuenta_id = p_cuenta_id AND transportista_id = p_transportista_id;

  SELECT COUNT(*) INTO v_cotizaciones
  FROM public.cotizaciones
  WHERE cuenta_id = p_cuenta_id AND transportista_id = p_transportista_id;

  SELECT COUNT(*) INTO v_pagos
  FROM public.pagos_transportistas
  WHERE cuenta_id = p_cuenta_id
    AND transportista_id = p_transportista_id
    AND revertido = false;

  IF v_viajes = 0 AND v_cotizaciones = 0 AND v_pagos = 0 THEN
    DELETE FROM public.transportistas
    WHERE id = p_transportista_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true, 'accion', 'eliminado_fisico',
      'viajes_historicos', 0
    );
  ELSE
    UPDATE public.transportistas
    SET activo = false, vehiculo_habitual_id = NULL, actualizado_en = now()
    WHERE id = p_transportista_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true, 'accion', 'desactivado_logico',
      'viajes_historicos', v_viajes,
      'cotizaciones_historicas', v_cotizaciones,
      'pagos_historicos', v_pagos
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_o_desactivar_transportista_atomico(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_o_desactivar_transportista_atomico(UUID, UUID) TO service_role;

-- ============================================================================
-- 7. RPC DE REPORTE GERENCIAL (fechas en creado_en, métricas corregidas)
--    Definiciones congeladas (raíl R7):
--      Viajes     = notas en estado despachada/entregada (no anuladas ni pendientes)
--      Fletes     = suma de flete_usd
--      Mercancía  = total_usd − flete_usd − corte_usd  (la mercancía que viajó)
--      Comisión   = suma del neto GUARDADO en cada viaje (nunca recalculado)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.obtener_reporte_flota_y_choferes(
  p_cuenta_id UUID,
  p_fecha_inicio TIMESTAMPTZ,
  p_fecha_fin TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_por_vehiculo JSONB;
  v_por_chofer JSONB;
BEGIN
  -- 1. Productividad por vehículo propio
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_por_vehiculo
  FROM (
    SELECT
      v.id AS vehiculo_id,
      v.codigo,
      v.nombre,
      v.placa,
      v.capacidad_kg,
      v.color_batea,
      v.activo,
      COUNT(nd.id)::INT AS total_viajes,
      ROUND(COALESCE(SUM(nd.flete_usd), 0), 2) AS total_flete_usd,
      ROUND(COALESCE(SUM(nd.total_usd - nd.flete_usd - nd.corte_usd), 0), 2) AS total_mercancia_usd,
      ROUND(
        CASE WHEN COUNT(nd.id) > 0
             THEN COALESCE(SUM(nd.flete_usd), 0) / COUNT(nd.id)
             ELSE 0
        END, 2
      ) AS promedio_flete_viaje_usd,
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'transportista_id', sub.transportista_id,
          'chofer_nombre', sub.chofer_nombre,
          'viajes', sub.viajes,
          'flete_usd', sub.flete_usd
        ))
        FROM (
          SELECT
            nd2.transportista_id,
            COALESCE(tr.nombre, 'Sin chofer') AS chofer_nombre,
            COUNT(nd2.id)::INT AS viajes,
            ROUND(COALESCE(SUM(nd2.flete_usd), 0), 2) AS flete_usd
          FROM public.notas_despacho nd2
          LEFT JOIN public.transportistas tr ON tr.id = nd2.transportista_id
          WHERE nd2.cuenta_id = p_cuenta_id
            AND nd2.vehiculo_id = v.id
            AND nd2.estado IN ('despachada', 'entregada')
            AND nd2.creado_en >= p_fecha_inicio
            AND nd2.creado_en <= p_fecha_fin
          GROUP BY nd2.transportista_id, tr.nombre
          ORDER BY viajes DESC
        ) sub
      ), '[]'::jsonb) AS desglose_choferes
    FROM public.vehiculos v
    LEFT JOIN public.notas_despacho nd
      ON nd.vehiculo_id = v.id
     AND nd.cuenta_id = v.cuenta_id
     AND nd.estado IN ('despachada', 'entregada')
     AND nd.creado_en >= p_fecha_inicio
     AND nd.creado_en <= p_fecha_fin
    WHERE v.cuenta_id = p_cuenta_id
    GROUP BY v.id
    ORDER BY total_flete_usd DESC, v.codigo ASC
  ) t;

  -- 2. Productividad y liquidación por chofer local
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  INTO v_por_chofer
  FROM (
    SELECT
      tr.id AS transportista_id,
      tr.nombre AS chofer_nombre,
      tr.telefono,
      tr.activo,
      vh.nombre AS vehiculo_habitual_nombre,
      vh.placa AS vehiculo_habitual_placa,
      COUNT(nd.id)::INT AS total_viajes,
      COUNT(nd.id) FILTER (
        WHERE lower(COALESCE(nd.flete_estado_destino_snapshot, '')) = 'carabobo'
      )::INT AS viajes_en_carabobo,
      COUNT(nd.id) FILTER (
        WHERE nd.flete_estado_destino_snapshot IS NOT NULL
          AND lower(nd.flete_estado_destino_snapshot) <> 'carabobo'
      )::INT AS viajes_fuera_carabobo,
      ROUND(COALESCE(SUM(nd.flete_usd), 0), 2) AS total_flete_usd,
      ROUND(COALESCE(SUM(nd.total_usd - nd.flete_usd - nd.corte_usd), 0), 2) AS total_mercancia_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd), 0), 2) AS comision_generada_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd) FILTER (WHERE nd.flete_pagado), 0), 2) AS comision_pagada_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd) FILTER (WHERE NOT nd.flete_pagado), 0), 2) AS comision_pendiente_usd,
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'vehiculo_id', sub2.vehiculo_id,
          'vehiculo_nombre', sub2.vehiculo_nombre,
          'placa', sub2.placa,
          'viajes', sub2.viajes,
          'flete_usd', sub2.flete_usd,
          'comision_usd', sub2.comision_usd
        ))
        FROM (
          SELECT
            nd3.vehiculo_id,
            COALESCE(v2.nombre, 'Vehículo no especificado') AS vehiculo_nombre,
            COALESCE(v2.placa, 'S/P') AS placa,
            COUNT(nd3.id)::INT AS viajes,
            ROUND(COALESCE(SUM(nd3.flete_usd), 0), 2) AS flete_usd,
            ROUND(COALESCE(SUM(nd3.flete_neto_transportista_usd), 0), 2) AS comision_usd
          FROM public.notas_despacho nd3
          LEFT JOIN public.vehiculos v2 ON v2.id = nd3.vehiculo_id
          WHERE nd3.cuenta_id = p_cuenta_id
            AND nd3.transportista_id = tr.id
            AND nd3.estado IN ('despachada', 'entregada')
            AND nd3.creado_en >= p_fecha_inicio
            AND nd3.creado_en <= p_fecha_fin
          GROUP BY nd3.vehiculo_id, v2.nombre, v2.placa
          ORDER BY viajes DESC
        ) sub2
      ), '[]'::jsonb) AS desglose_vehiculos
    FROM public.transportistas tr
    LEFT JOIN public.vehiculos vh ON vh.id = tr.vehiculo_habitual_id
    LEFT JOIN public.notas_despacho nd
      ON nd.transportista_id = tr.id
     AND nd.cuenta_id = tr.cuenta_id
     AND nd.estado IN ('despachada', 'entregada')
     AND nd.creado_en >= p_fecha_inicio
     AND nd.creado_en <= p_fecha_fin
    WHERE tr.cuenta_id = p_cuenta_id
      AND tr.es_local = true
    GROUP BY tr.id, vh.nombre, vh.placa
    ORDER BY total_flete_usd DESC, tr.nombre ASC
  ) c;

  RETURN jsonb_build_object(
    'ok', true,
    'por_vehiculo', v_por_vehiculo,
    'por_chofer_local', v_por_chofer
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
