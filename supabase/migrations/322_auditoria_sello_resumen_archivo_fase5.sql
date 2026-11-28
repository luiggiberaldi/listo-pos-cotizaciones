-- ============================================================================
-- 322_auditoria_sello_resumen_archivo_fase5.sql
-- OP-2026-110 (Auditoría 2.0 — Fase 5 + cierre RLS supervisor de Fase 4)
--
-- Incluye:
--   1. Sello encadenado SHA-256 (hash_anterior, hash_actual) en auditoria_cambios
--      + función verificar_cadena_auditoria(p_limite).
--   2. Función rápida obtener_resumen_auditoria() (1 consulta en vez de 5).
--   3. Tabla auditoria_archivo + función archivar_auditoria_antigua(p_dias DEFAULT 730).
--   4. Cierre de lectura directa sin filtro para supervisor en public.auditoria
--      (la pantalla ahora lee 100 % a través de /api/admin/audit filtrado por rol).
-- ============================================================================

BEGIN;

-- 1. Sello encadenado SHA-256 en auditoria_cambios
ALTER TABLE public.auditoria_cambios
  ADD COLUMN IF NOT EXISTS hash_anterior TEXT,
  ADD COLUMN IF NOT EXISTS hash_actual   TEXT;

CREATE OR REPLACE FUNCTION public.calcular_sello_auditoria_cambios()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_prev TEXT;
  v_payload TEXT;
BEGIN
  -- Bloqueo ligero por transacción para encadenar en orden estricto
  PERFORM pg_advisory_xact_lock(742026110);

  SELECT hash_actual INTO v_prev
  FROM public.auditoria_cambios
  ORDER BY id DESC
  LIMIT 1;

  v_prev := COALESCE(v_prev, 'GENESIS');
  v_payload := v_prev || '|' || NEW.tabla || '|' || COALESCE(NEW.registro_id, '') || '|' || NEW.tipo || '|' || COALESCE(NEW.cambios::text, '{}') || '|' || COALESCE(NEW.operador_id::text, '') || '|' || COALESCE(NEW.operacion_id, '');

  NEW.hash_anterior := v_prev;
  NEW.hash_actual := encode(extensions.digest(v_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_sello_auditoria_cambios() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auditoria_cambios_sello ON public.auditoria_cambios;
CREATE TRIGGER trg_auditoria_cambios_sello
  BEFORE INSERT ON public.auditoria_cambios
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_sello_auditoria_cambios();

CREATE OR REPLACE FUNCTION public.verificar_cadena_auditoria(p_limite INTEGER DEFAULT 1000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row        RECORD;
  v_esperado   TEXT;
  v_prev_hash  TEXT := NULL;
  v_revisadas  INTEGER := 0;
  v_payload    TEXT;
BEGIN
  FOR v_row IN
    SELECT * FROM (
      SELECT id, tabla, registro_id, tipo, cambios, operador_id, operacion_id, hash_anterior, hash_actual
      FROM public.auditoria_cambios
      WHERE hash_actual IS NOT NULL
      ORDER BY id DESC
      LIMIT GREATEST(1, COALESCE(p_limite, 1000))
    ) sub
    ORDER BY id ASC
  LOOP
    v_revisadas := v_revisadas + 1;
    IF v_prev_hash IS NOT NULL AND v_row.hash_anterior IS DISTINCT FROM v_prev_hash THEN
      RETURN jsonb_build_object('ok', false, 'revisadas', v_revisadas, 'primer_id_roto', v_row.id, 'motivo', 'ENLACE_ROTO');
    END IF;
    v_payload := COALESCE(v_row.hash_anterior, 'GENESIS') || '|' || v_row.tabla || '|' || COALESCE(v_row.registro_id, '') || '|' || v_row.tipo || '|' || COALESCE(v_row.cambios::text, '{}') || '|' || COALESCE(v_row.operador_id::text, '') || '|' || COALESCE(v_row.operacion_id, '');
    v_esperado := encode(extensions.digest(v_payload, 'sha256'), 'hex');
    IF v_row.hash_actual IS DISTINCT FROM v_esperado THEN
      RETURN jsonb_build_object('ok', false, 'revisadas', v_revisadas, 'primer_id_roto', v_row.id, 'motivo', 'HASH_ALTERADO');
    END IF;
    v_prev_hash := v_row.hash_actual;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'revisadas', v_revisadas, 'primer_id_roto', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.verificar_cadena_auditoria(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_cadena_auditoria(INTEGER) TO service_role;

-- 2. Función rápida de resumen (1 sola consulta en vez de 5)
CREATE OR REPLACE FUNCTION public.obtener_resumen_auditoria(
  p_cuenta_id      UUID DEFAULT NULL,
  p_ocultar_dinero BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total           BIGINT := 0;
  v_hoy             BIGINT := 0;
  v_semana          BIGINT := 0;
  v_logins_fallidos BIGINT := 0;
  v_cambios_manual  BIGINT := 0;
  v_denegados_7d    BIGINT := 0;
  v_top_cat         JSONB := '[]'::jsonb;
  v_top_usr         JSONB := '[]'::jsonb;
  v_top_acc         JSONB := '[]'::jsonb;
  v_alertas         JSONB := '[]'::jsonb;
  v_cats_ocultas    CONSTANT TEXT[] := ARRAY['FINANZAS', 'COMISIONES', 'PROVEEDOR', 'CONFIG'];
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE a.ts >= date_trunc('day', now() AT TIME ZONE 'America/Caracas') AT TIME ZONE 'America/Caracas'),
    COUNT(*) FILTER (WHERE a.ts >= now() - interval '7 days'),
    COUNT(*) FILTER (WHERE a.accion = 'LOGIN_FALLIDO' AND a.ts >= now() - interval '7 days')
  INTO v_total, v_hoy, v_semana, v_logins_fallidos
  FROM public.auditoria a
  LEFT JOIN public.auditoria_catalogo c ON c.accion = a.accion
  WHERE (p_cuenta_id IS NULL OR a.cuenta_id = p_cuenta_id)
    AND (NOT p_ocultar_dinero OR (
      COALESCE(c.oculta_supervisor, false) = false
      AND NOT (UPPER(COALESCE(a.categoria::text, '')) = ANY(v_cats_ocultas))
    ));

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_cat FROM (
    SELECT UPPER(COALESCE(a.categoria::text, 'OTRO')) AS categoria, COUNT(*)::int AS count
    FROM public.auditoria a
    LEFT JOIN public.auditoria_catalogo c ON c.accion = a.accion
    WHERE a.ts >= now() - interval '30 days'
      AND (p_cuenta_id IS NULL OR a.cuenta_id = p_cuenta_id)
      AND (NOT p_ocultar_dinero OR (COALESCE(c.oculta_supervisor, false) = false AND NOT (UPPER(COALESCE(a.categoria::text, '')) = ANY(v_cats_ocultas))))
    GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_usr FROM (
    SELECT COALESCE(a.usuario_nombre, 'Desconocido') AS nombre, MAX(a.usuario_rol) AS rol, COUNT(*)::int AS count
    FROM public.auditoria a
    LEFT JOIN public.auditoria_catalogo c ON c.accion = a.accion
    WHERE a.ts >= now() - interval '30 days'
      AND (p_cuenta_id IS NULL OR a.cuenta_id = p_cuenta_id)
      AND (NOT p_ocultar_dinero OR (COALESCE(c.oculta_supervisor, false) = false AND NOT (UPPER(COALESCE(a.categoria::text, '')) = ANY(v_cats_ocultas))))
    GROUP BY 1 ORDER BY 3 DESC LIMIT 8
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_acc FROM (
    SELECT COALESCE(a.accion, 'OTRO') AS accion, COUNT(*)::int AS count
    FROM public.auditoria a
    LEFT JOIN public.auditoria_catalogo c ON c.accion = a.accion
    WHERE a.ts >= now() - interval '30 days'
      AND (p_cuenta_id IS NULL OR a.cuenta_id = p_cuenta_id)
      AND (NOT p_ocultar_dinero OR (COALESCE(c.oculta_supervisor, false) = false AND NOT (UPPER(COALESCE(a.categoria::text, '')) = ANY(v_cats_ocultas))))
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_alertas FROM (
    SELECT a.id, a.ts, a.accion, a.descripcion, a.usuario_nombre, a.usuario_rol,
           COALESCE(c.importancia, 'critica') AS importancia, COALESCE(c.titulo_es, a.accion) AS titulo_es
    FROM public.auditoria a
    LEFT JOIN public.auditoria_catalogo c ON c.accion = a.accion
    WHERE a.ts >= now() - interval '7 days'
      AND (p_cuenta_id IS NULL OR a.cuenta_id = p_cuenta_id)
      AND (c.importancia = 'critica' OR a.accion IN ('LOGIN_FALLIDO', 'ANULAR_DESPACHO', 'BATCH_PRICE_UPDATE', 'LIMPIAR_INVENTARIO'))
      AND (NOT p_ocultar_dinero OR (COALESCE(c.oculta_supervisor, false) = false AND NOT (UPPER(COALESCE(a.categoria::text, '')) = ANY(v_cats_ocultas))))
    ORDER BY a.ts DESC
    LIMIT 10
  ) t;

  SELECT COUNT(*) INTO v_cambios_manual
  FROM public.auditoria_cambios
  WHERE ts >= now() - interval '7 days'
    AND origen = 'manual'
    AND (p_cuenta_id IS NULL OR cuenta_id = p_cuenta_id)
    AND (NOT p_ocultar_dinero OR es_sensible_dinero = false);

  IF NOT p_ocultar_dinero THEN
    SELECT COUNT(*) INTO v_denegados_7d
    FROM public.auditoria_peticiones
    WHERE ts >= now() - interval '7 days'
      AND resultado IN ('denegado', 'error')
      AND (p_cuenta_id IS NULL OR cuenta_id = p_cuenta_id);
  END IF;

  RETURN jsonb_build_object(
    'total', v_total,
    'accionesHoy', v_hoy,
    'accionesSemana', v_semana,
    'loginsFallidos', v_logins_fallidos,
    'cambiosFueraApp7d', v_cambios_manual,
    'peticionesAlerta7d', v_denegados_7d,
    'topCategorias', v_top_cat,
    'topUsuarios', v_top_usr,
    'topAcciones', v_top_acc,
    'alertasRecientes', v_alertas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_resumen_auditoria(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_resumen_auditoria(UUID, BOOLEAN) TO service_role;

-- 3. Archivo de registros antiguos (>2 años, nunca borra sin copiar)
CREATE TABLE IF NOT EXISTS public.auditoria_archivo (
  LIKE public.auditoria INCLUDING DEFAULTS
);
ALTER TABLE public.auditoria_archivo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_archivo FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.archivar_auditoria_antigua(p_dias INTEGER DEFAULT 730)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movidas INTEGER := 0;
BEGIN
  IF p_dias < 365 THEN
    RAISE EXCEPTION 'RETENCION_MINIMA: no se permite archivar registros con menos de 365 dias';
  END IF;

  PERFORM set_config('app.permitir_limpieza_auditoria', '1', true);

  WITH mov AS (
    DELETE FROM public.auditoria
    WHERE ts < now() - make_interval(days => p_dias)
    RETURNING *
  )
  INSERT INTO public.auditoria_archivo
  SELECT * FROM mov;

  GET DIAGNOSTICS v_movidas = ROW_COUNT;
  RETURN v_movidas;
END;
$$;

REVOKE ALL ON FUNCTION public.archivar_auditoria_antigua(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archivar_auditoria_antigua(INTEGER) TO service_role;

-- 4. Cierre de lectura directa sin filtro para supervisor (la pantalla lee por /api/admin/audit)
DROP POLICY IF EXISTS auditoria_supervisor_select ON public.auditoria;

COMMIT;
