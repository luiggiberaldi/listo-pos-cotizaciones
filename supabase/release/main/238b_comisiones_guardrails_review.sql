-- 238b_comisiones_guardrails_review.sql
-- REVIEW ONLY - proyecto principal.
--
-- Objetivo:
--   1. Aplicar la politica futura: totalcomision solo por la porcion no-CxC.
--   2. Mantener las exclusiones existentes: donacion, prestamo, Corte y
--      productos excluidos; soportar pagos mixtos, extras y tasas individuales.
--   3. Persistir evidencia suficiente para explicar cada monto nuevo.
--   4. Preparar snapshot, propuestas y rollback de historicos sin tocarlos.
--
-- Estado observado en principal al 2026-08-23:
--   - 725 comisiones legacy.
--   - 696 estado pendiente.
--   - 29 estado cta_cobrar.
--   - 0 estado generada.
--
-- ESTE ARCHIVO NO DEBE EJECUTARSE DIRECTAMENTE.
-- El gate se elimina solo despues de backup fresco, baseline, smoke del Worker,
-- pruebas mutables aisladas y aprobacion explicita del cutover.
-- La transicion de historicos se ejecuta en otro batch, nunca en este tramo.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 238b_comisiones_guardrails_review.sql no debe ejecutarse todavia';
END
$$;

-- ---------------------------------------------------------------------------
-- 0. Precondiciones del contrato principal
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.comisiones') IS NULL
     OR to_regclass('public.notas_despacho') IS NULL
     OR to_regclass('public.clientes') IS NULL
     OR to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.configuracion_negocio') IS NULL
     OR to_regclass('public.cotizacion_items') IS NULL
     OR to_regclass('public.notas_despacho_items') IS NULL
     OR to_regclass('public.despacho_descuentos') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas de comisiones incompletas';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'comisiones'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%despachoid%'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: comisiones.despachoid debe ser unico';
  END IF;

  IF EXISTS (
    SELECT despachoid
    FROM public.comisiones
    GROUP BY despachoid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: existen comisiones duplicadas por despacho';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Evidencia de calculo para registros futuros
-- ---------------------------------------------------------------------------
ALTER TABLE public.comisiones
  ADD COLUMN IF NOT EXISTS detalle_extras JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comision_liberada NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_retenida NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_cxc_excluida NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_pago_excluida NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_otras_exclusiones NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fraccion_no_cxc NUMERIC(12,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS calculo_version TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS politica_comision TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS fuente_calculo TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS calculo_evidencia JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.comisiones.calculo_evidencia IS
  'Snapshot de split de pago, exclusiones, tasas y categorias usado para totalcomision.';
COMMENT ON COLUMN public.comisiones.comision_cxc_excluida IS
  'Comision que no se genero por la porcion CxC; CxC manual no entra en totalcomision.';
COMMENT ON COLUMN public.comisiones.fraccion_no_cxc IS
  'Porcion del total del despacho pagada por metodos distintos de CxC.';
COMMENT ON COLUMN public.comisiones.comision_pago_excluida IS
  'Comision excluida por donacion/prestamo como metodo de pago; no es CxC manual.';

-- Se conserva compatibilidad para las 725 filas existentes. Las nuevas filas de
-- la funcion 238b siempre escriben generada; el constraint unico se podra
-- reducir a generada cuando el batch historico quede conciliado.
ALTER TABLE public.comisiones DROP CONSTRAINT IF EXISTS comisiones_estado_check;
ALTER TABLE public.comisiones ADD CONSTRAINT comisiones_estado_check
  CHECK (estado IN ('pendiente', 'cta_cobrar', 'pagada', 'generada'));

-- ---------------------------------------------------------------------------
-- 2. Normalizacion de metodos de pago y politica no-CxC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comision_238b_pago_split(
  p_total_usd NUMERIC,
  p_forma_pago_cliente TEXT DEFAULT NULL,
  p_forma_pago TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC(12,4) := GREATEST(COALESCE(p_total_usd, 0), 0);
  v_source TEXT;
  v_json JSONB := '[]'::jsonb;
  v_methods JSONB := '[]'::jsonb;
  v_cxc_methods INTEGER := 0;
  v_non_cxc_methods INTEGER := 0;
  v_cxc_explicit NUMERIC(12,4) := 0;
  v_non_cxc_explicit NUMERIC(12,4) := 0;
  v_cxc NUMERIC(12,4) := 0;
  v_non_cxc NUMERIC(12,4) := 0;
  v_fraction NUMERIC(12,8) := 1;
  v_excluded BOOLEAN := FALSE;
  v_requires_manual_review BOOLEAN := FALSE;
  v_method TEXT;
BEGIN
  v_source := COALESCE(NULLIF(btrim(p_forma_pago_cliente), ''), NULLIF(btrim(p_forma_pago), ''));

  IF v_source IS NOT NULL AND pg_input_is_valid(v_source, 'jsonb') THEN
    v_json := v_source::jsonb;

    IF jsonb_typeof(v_json) = 'object' THEN
      IF v_json ? 'metodos_pagados' THEN
        v_json := v_json->'metodos_pagados';
      ELSE
        v_json := jsonb_build_array(v_json);
      END IF;
    END IF;

    IF jsonb_typeof(v_json) <> 'array' THEN
      v_json := '[]'::jsonb;
    END IF;

    -- Aplana contenedores legacy sin sumar el contenedor y sus hijos dos veces.
    SELECT COALESCE(jsonb_agg(flattened.value), '[]'::jsonb)
    INTO v_methods
    FROM (
      SELECT source.elem AS value
      FROM jsonb_array_elements(v_json) AS source(elem)
      WHERE NOT (
        jsonb_typeof(source.elem) = 'object'
        AND source.elem ?| ARRAY[
          'metodos_pagados', 'metodo_propuesto', 'formas_pago',
          'pagos', 'payments'
        ]::TEXT[]
      )
      UNION ALL
      SELECT nested.value
      FROM jsonb_array_elements(v_json) AS source(elem)
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(source.elem) = 'object'
             THEN source.elem ELSE '{}'::jsonb END
      ) AS wrapper(key, value)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(wrapper.value) = 'array'
             THEN wrapper.value ELSE '[]'::jsonb END
      ) AS nested(value)
      WHERE wrapper.key = ANY (ARRAY[
        'metodos_pagados', 'metodo_propuesto', 'formas_pago',
        'pagos', 'payments'
      ]::TEXT[])
    ) AS flattened;

    SELECT count(*) INTO v_cxc_methods
    FROM jsonb_array_elements(v_methods) AS elem
    WHERE lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%';

    v_non_cxc_methods := jsonb_array_length(v_methods) - v_cxc_methods;

    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor', '')
           ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor')::numeric
      ELSE 0
    END), 0)
    INTO v_cxc_explicit
    FROM jsonb_array_elements(v_methods) AS elem
    WHERE lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
       OR lower(translate(trim(COALESCE(
      elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
    )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%';

    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor', '')
           ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor')::numeric
      ELSE 0
    END), 0)
    INTO v_non_cxc_explicit
    FROM jsonb_array_elements(v_methods) AS elem
    WHERE NOT (
      lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
      OR lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
      OR lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
      OR lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
      OR lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%'
    );

    SELECT bool_or(
      lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE 'donac%'
      OR lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE 'prestam%'
    )
    INTO v_excluded
    FROM jsonb_array_elements(v_methods) AS elem;

    v_requires_manual_review := v_cxc_methods > 0
      AND v_non_cxc_methods > 0
      AND v_cxc_explicit <= 0
      AND v_non_cxc_explicit <= 0;

    IF v_cxc_methods > 0 THEN
      v_cxc := CASE
        WHEN v_cxc_explicit > 0 THEN LEAST(v_total, v_cxc_explicit)
        WHEN v_non_cxc_methods = 0 THEN v_total
        ELSE GREATEST(0, v_total - v_non_cxc_explicit)
      END;
    END IF;
  ELSE
    v_methods := CASE WHEN v_source IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object('metodo', v_source, 'monto', NULL)) END;
    v_method := lower(translate(trim(COALESCE(v_source, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU'));
    v_cxc := CASE WHEN v_method = 'cxc'
       OR v_method LIKE '%cta por cobrar%'
       OR v_method LIKE '%cuenta por cobrar%'
       OR v_method LIKE '%credito%'
       OR v_method LIKE '%credit%'
      THEN v_total ELSE 0 END;
    v_excluded := v_method LIKE 'donac%' OR v_method LIKE 'prestam%';
  END IF;

  v_cxc := LEAST(v_total, GREATEST(v_cxc, 0));
  v_non_cxc := GREATEST(v_total - v_cxc, 0);
  IF v_excluded THEN
    v_fraction := 0;
  ELSIF v_total > 0 THEN
    v_fraction := LEAST(1, GREATEST(0, v_non_cxc / v_total));
  END IF;

  RETURN jsonb_build_object(
    'total_usd', round(v_total, 4),
    'cxc_amount', round(v_cxc, 4),
    'non_cxc_amount', round(v_non_cxc, 4),
    'fraction', round(v_fraction, 8),
    'excluded_by_payment', COALESCE(v_excluded, FALSE),
    'requires_manual_review', COALESCE(v_requires_manual_review, FALSE),
    'manual_review_reason', CASE WHEN COALESCE(v_requires_manual_review, FALSE)
      THEN 'mixed_payment_without_explicit_amounts' ELSE NULL END,
    'methods', v_methods
  );
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Clasificacion de cada item con las exclusiones existentes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comision_238b_assert_operator(
  p_cuenta_id UUID,
  p_usuario_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cuenta_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'OPERADOR_COMISIONES_INVALIDO';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = p_usuario_id
      AND u.cuenta_id = p_cuenta_id
      AND u.activo = TRUE
      AND u.rol IN ('supervisor', 'admin', 'administracion', 'desarrollador', 'jefe')
  ) THEN
    RAISE EXCEPTION 'OPERADOR_COMISIONES_NO_AUTORIZADO';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.comision_238b_item_breakdown(
  p_value_usd NUMERIC,
  p_categoria TEXT,
  p_nombre TEXT,
  p_origen TEXT,
  p_es_prestamo BOOLEAN,
  p_vendedor_externo BOOLEAN,
  p_cat_cabilla TEXT,
  p_pct_cabilla NUMERIC,
  p_pct_otros NUMERIC,
  p_pct_externos NUMERIC,
  p_extras JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value NUMERIC(12,4) := GREATEST(COALESCE(p_value_usd, 0), 0);
  v_cat TEXT := lower(trim(COALESCE(p_categoria, '')));
  v_name TEXT := lower(trim(COALESCE(p_nombre, '')));
  v_extra_cat TEXT;
  v_extra_pct NUMERIC;
  v_excluded_pct NUMERIC := 0;
  v_extras JSONB := COALESCE(p_extras, '[]'::jsonb);
BEGIN
  IF jsonb_typeof(v_extras) = 'string'
     AND pg_input_is_valid(v_extras #>> '{}', 'jsonb') THEN
    v_extras := (v_extras #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_extras) <> 'array' THEN
    v_extras := '[]'::jsonb;
  END IF;

  IF p_es_prestamo OR v_name LIKE 'corte%' THEN
    IF v_name LIKE 'corte%' THEN
      v_excluded_pct := 0;
    ELSIF lower(trim(COALESCE(p_origen, ''))) = 'externo' THEN
      v_excluded_pct := COALESCE(p_pct_externos, 0);
    ELSIF p_vendedor_externo AND (v_cat = 'cemento' OR v_name LIKE '%cemento%') THEN
      v_excluded_pct := COALESCE(p_pct_cabilla, 0);
    ELSIF v_cat = lower(trim(COALESCE(p_cat_cabilla, '')))
       OR v_name LIKE '%' || lower(trim(COALESCE(p_cat_cabilla, ''))) || '%' THEN
      v_excluded_pct := COALESCE(p_pct_cabilla, 0);
    ELSE
      SELECT CASE WHEN COALESCE(elem->>'pct', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN (elem->>'pct')::numeric ELSE p_pct_otros END
      INTO v_excluded_pct
      FROM jsonb_array_elements(
        v_extras
      ) AS elem
      WHERE lower(trim(COALESCE(elem->>'cat', ''))) = v_cat
      LIMIT 1;
      v_excluded_pct := COALESCE(v_excluded_pct, p_pct_otros, 0);
    END IF;

    RETURN jsonb_build_object(
      'excluded', TRUE,
      'reason', CASE WHEN p_es_prestamo THEN 'prestamo' ELSE 'corte' END,
      'value_usd', v_value,
      'pct', v_excluded_pct,
      'commission_excluded', round(v_value * v_excluded_pct / 100, 4)
    );
  END IF;

  IF lower(trim(COALESCE(p_origen, ''))) = 'externo' THEN
    RETURN jsonb_build_object('excluded', FALSE, 'bucket', 'externo',
      'category', 'externo', 'value_usd', v_value,
      'pct', COALESCE(p_pct_externos, 0),
      'commission', round(v_value * COALESCE(p_pct_externos, 0) / 100, 4));
  END IF;

  IF p_vendedor_externo AND (v_cat = 'cemento' OR v_name LIKE '%cemento%') THEN
    RETURN jsonb_build_object('excluded', FALSE, 'bucket', 'cabilla',
      'category', 'cemento', 'value_usd', v_value,
      'pct', COALESCE(p_pct_cabilla, 0),
      'commission', round(v_value * COALESCE(p_pct_cabilla, 0) / 100, 4));
  END IF;

  IF v_cat = lower(trim(COALESCE(p_cat_cabilla, 'cabilla')))
     OR v_name LIKE '%' || lower(trim(COALESCE(p_cat_cabilla, 'cabilla'))) || '%' THEN
    RETURN jsonb_build_object('excluded', FALSE, 'bucket', 'cabilla',
      'category', COALESCE(NULLIF(v_cat, ''), 'cabilla'), 'value_usd', v_value,
      'pct', COALESCE(p_pct_cabilla, 0),
      'commission', round(v_value * COALESCE(p_pct_cabilla, 0) / 100, 4));
  END IF;

  SELECT elem->>'cat',
    CASE WHEN COALESCE(elem->>'pct', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN (elem->>'pct')::numeric ELSE p_pct_otros END
  INTO v_extra_cat, v_extra_pct
  FROM jsonb_array_elements(        v_extras
  ) AS elem
  WHERE lower(trim(COALESCE(elem->>'cat', ''))) = v_cat
  LIMIT 1;

  IF v_extra_cat IS NOT NULL THEN
    RETURN jsonb_build_object('excluded', FALSE, 'bucket', 'extra',
      'category', v_extra_cat, 'value_usd', v_value,
      'pct', COALESCE(v_extra_pct, p_pct_otros),
      'commission', round(v_value * COALESCE(v_extra_pct, p_pct_otros, 0) / 100, 4));
  END IF;

  RETURN jsonb_build_object('excluded', FALSE, 'bucket', 'otros',
    'category', COALESCE(NULLIF(v_cat, ''), 'otros'), 'value_usd', v_value,
    'pct', COALESCE(p_pct_otros, 0),
    'commission', round(v_value * COALESCE(p_pct_otros, 0) / 100, 4));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Funcion futura: una comision por despacho, neta de CxC y auditable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho_238b(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho RECORD;
  v_cfg RECORD;
  v_item RECORD;
  v_breakdown JSONB;
  v_payment JSONB;
  v_extra_details JSONB := '[]'::jsonb;
  v_existing UUID;
  v_comision_id UUID;
  v_has_dispatch_items BOOLEAN;
  v_pct_cabilla NUMERIC := 0;
  v_pct_otros NUMERIC := 0;
  v_pct_externos NUMERIC := 0;
  v_cat_cabilla TEXT := 'cabilla';
  v_extras JSONB := '[]'::jsonb;
  v_base_cabilla NUMERIC := 0;
  v_base_otros NUMERIC := 0;
  v_base_externos NUMERIC := 0;
  v_raw_extras NUMERIC := 0;
  v_excluded_commission NUMERIC := 0;
  v_comision_cabilla NUMERIC := 0;
  v_comision_otros NUMERIC := 0;
  v_comision_extras NUMERIC := 0;
  v_raw_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_fraction NUMERIC := 1;
  v_cxc_excluded NUMERIC := 0;
  v_payment_excluded_commission NUMERIC := 0;
  v_extra_commission NUMERIC;
  v_idx INTEGER;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         nd.vendedor_id, nd.total_usd, nd.forma_pago, nd.forma_pago_cliente,
         COALESCE(cl.vendedor_id, nd.vendedor_id) AS vendedor_comision_id,
         u.rol AS vendedor_rol, u.es_externo AS vendedor_es_externo,
         u.markup_pct AS vendedor_markup_pct,
         u.comision_pct AS vendedor_comision_pct,
         u.comision_pct_cabilla AS vendedor_comision_pct_cabilla
  INTO v_despacho
  FROM public.notas_despacho nd
  LEFT JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;
  IF v_despacho.cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;
  IF v_despacho.vendedor_comision_id IS NULL THEN RETURN NULL; END IF;
  IF v_despacho.estado NOT IN ('despachada', 'entregada') THEN RETURN NULL; END IF;

  SELECT c.id INTO v_existing
  FROM public.comisiones c
  WHERE c.despachoid = p_despachoid
    AND c.cuentaid = v_despacho.cuenta_id
  FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_despacho.vendedor_rol IN ('admin', 'jefe', 'logistica', 'administracion', 'desarrollador')
     OR (v_despacho.vendedor_rol = 'vendedor_sin_comision'
         AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE)
         AND COALESCE(v_despacho.vendedor_markup_pct, 0) <= 0) THEN
    RETURN NULL;
  END IF;

  SELECT cn.* INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF FOUND THEN
    v_cat_cabilla := lower(trim(COALESCE(v_cfg.comision_categoria_cabilla, 'cabilla')));
    IF COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
      v_pct_cabilla := COALESCE(v_cfg.comision_ext_pct_cabilla, 2);
      v_pct_otros := COALESCE(v_cfg.comision_ext_pct_otros, 3);
      v_pct_externos := COALESCE(v_cfg.comision_ext_pct_externos, 3);
      v_extras := COALESCE(v_cfg._comision_ext_extras, '[]'::jsonb);
    ELSE
      v_pct_cabilla := COALESCE(v_despacho.vendedor_comision_pct_cabilla,
        v_cfg.comision_pct_cabilla, 2);
      v_pct_otros := COALESCE(v_despacho.vendedor_comision_pct,
        v_cfg.comision_pct_otros, 3);
      v_pct_externos := COALESCE(v_cfg.comision_pct_externos, v_pct_otros, 3);
      v_extras := COALESCE(v_cfg._comision_extras, '[]'::jsonb);
    END IF;
  END IF;

  IF v_despacho.vendedor_rol = 'vendedor_sin_comision'
     AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_pct_externos := 0;
  END IF;

  IF jsonb_typeof(v_extras) = 'string'
     AND pg_input_is_valid(v_extras #>> '{}', 'jsonb') THEN
    v_extras := (v_extras #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_extras) <> 'array' THEN v_extras := '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cat', elem->>'cat',
    'pct', CASE WHEN COALESCE(elem->>'pct', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN (elem->>'pct')::numeric ELSE v_pct_otros END,
    'monto', 0, 'comision', 0
  )), '[]'::jsonb)
  INTO v_extra_details
  FROM jsonb_array_elements(v_extras) AS elem;

  v_payment := public.comision_238b_pago_split(
    v_despacho.total_usd, v_despacho.forma_pago_cliente, v_despacho.forma_pago
  );
  IF COALESCE((v_payment->>'requires_manual_review')::boolean, FALSE) THEN
    RAISE EXCEPTION 'PAGO_MIXTO_SIN_MONTOS_REQUIERE_REVISION';
  END IF;
  v_fraction := COALESCE((v_payment->>'fraction')::numeric, 1);

  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despachoid
  ) INTO v_has_dispatch_items;

  IF v_has_dispatch_items THEN
    FOR v_item IN
      SELECT ndi.total_linea_usd AS value_usd,
             COALESCE(p.categoria, '') AS categoria,
             ndi.nombre_snap AS nombre,
             ndi.origen,
             COALESCE(ndi.es_prestamo, FALSE) AS es_prestamo
      FROM public.notas_despacho_items ndi
      LEFT JOIN public.productos p ON p.id = ndi.producto_id
      WHERE ndi.despacho_id = p_despachoid
    LOOP
      v_breakdown := public.comision_238b_item_breakdown(
        v_item.value_usd, v_item.categoria, v_item.nombre, v_item.origen,
        v_item.es_prestamo, COALESCE(v_despacho.vendedor_es_externo, FALSE),
        v_cat_cabilla, v_pct_cabilla, v_pct_otros, v_pct_externos, v_extras
      );
      IF COALESCE((v_breakdown->>'excluded')::boolean, FALSE) THEN
        v_excluded_commission := v_excluded_commission
          + COALESCE((v_breakdown->>'commission_excluded')::numeric, 0);
        CONTINUE;
      END IF;
      IF v_breakdown->>'bucket' = 'cabilla' THEN
        v_base_cabilla := v_base_cabilla + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'externo' THEN
        v_base_externos := v_base_externos + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'extra' THEN
        v_raw_extras := v_raw_extras + (v_breakdown->>'commission')::numeric;
        SELECT COALESCE(jsonb_agg(CASE
          WHEN lower(trim(COALESCE(elem->>'cat', ''))) = lower(trim(v_breakdown->>'category'))
          THEN elem || jsonb_build_object(
            'monto', COALESCE((elem->>'monto')::numeric, 0) + (v_breakdown->>'value_usd')::numeric,
            'comision', COALESCE((elem->>'comision')::numeric, 0) + (v_breakdown->>'commission')::numeric
          ) ELSE elem END), '[]'::jsonb)
        INTO v_extra_details FROM jsonb_array_elements(v_extra_details) AS elem;
      ELSE
        v_base_otros := v_base_otros + (v_breakdown->>'value_usd')::numeric;
      END IF;
    END LOOP;
  ELSE
    FOR v_item IN
      SELECT GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS value_usd,
             COALESCE(p.categoria, '') AS categoria,
             ci.nombre_snap AS nombre,
             ci.origen,
             FALSE AS es_prestamo
      FROM public.cotizacion_items ci
      LEFT JOIN public.productos p ON p.id = ci.producto_id
      LEFT JOIN public.despacho_descuentos dd
        ON dd.despacho_id = p_despachoid AND dd.cotizacion_item_id = ci.id
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
    LOOP
      v_breakdown := public.comision_238b_item_breakdown(
        v_item.value_usd, v_item.categoria, v_item.nombre, v_item.origen,
        v_item.es_prestamo, COALESCE(v_despacho.vendedor_es_externo, FALSE),
        v_cat_cabilla, v_pct_cabilla, v_pct_otros, v_pct_externos, v_extras
      );
      IF COALESCE((v_breakdown->>'excluded')::boolean, FALSE) THEN
        v_excluded_commission := v_excluded_commission
          + COALESCE((v_breakdown->>'commission_excluded')::numeric, 0);
        CONTINUE;
      END IF;
      IF v_breakdown->>'bucket' = 'cabilla' THEN
        v_base_cabilla := v_base_cabilla + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'externo' THEN
        v_base_externos := v_base_externos + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'extra' THEN
        v_raw_extras := v_raw_extras + (v_breakdown->>'commission')::numeric;
        SELECT COALESCE(jsonb_agg(CASE
          WHEN lower(trim(COALESCE(elem->>'cat', ''))) = lower(trim(v_breakdown->>'category'))
          THEN elem || jsonb_build_object(
            'monto', COALESCE((elem->>'monto')::numeric, 0) + (v_breakdown->>'value_usd')::numeric,
            'comision', COALESCE((elem->>'comision')::numeric, 0) + (v_breakdown->>'commission')::numeric
          ) ELSE elem END), '[]'::jsonb)
        INTO v_extra_details FROM jsonb_array_elements(v_extra_details) AS elem;
      ELSE
        v_base_otros := v_base_otros + (v_breakdown->>'value_usd')::numeric;
      END IF;
    END LOOP;
  END IF;

  v_comision_cabilla := round(v_base_cabilla * v_pct_cabilla / 100 * v_fraction, 2);
  v_comision_otros := round((v_base_otros * v_pct_otros / 100
    + v_base_externos * v_pct_externos / 100) * v_fraction, 2);
  v_raw_total := round(v_base_cabilla * v_pct_cabilla / 100
    + v_base_otros * v_pct_otros / 100
    + v_base_externos * v_pct_externos / 100 + v_raw_extras, 2);

  IF jsonb_array_length(v_extra_details) > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(v_extra_details) - 1 LOOP
    v_extra_commission := round(
      COALESCE((v_extra_details->v_idx->>'comision')::numeric, 0) * v_fraction, 2
    );
    v_extra_details := jsonb_set(
      v_extra_details, ARRAY[v_idx::text, 'comision'], to_jsonb(v_extra_commission)
    );
    v_comision_extras := v_comision_extras + v_extra_commission;
    END LOOP;
  END IF;

  v_total := round(v_comision_cabilla + v_comision_otros + v_comision_extras, 2);
  v_payment_excluded_commission := CASE
    WHEN COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE)
      THEN round(v_raw_total, 2)
    ELSE 0
  END;
  v_cxc_excluded := CASE
    WHEN v_payment_excluded_commission > 0 THEN 0
    ELSE round(v_raw_total * (1 - v_fraction), 2)
  END;

  INSERT INTO public.comisiones (
    despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros,
    estado, comision_liberada, comision_retenida,
    detalle_extras, comision_cxc_excluida, comision_pago_excluida,
    comision_otras_exclusiones, fraccion_no_cxc, calculo_version,
    politica_comision, fuente_calculo,
    calculo_evidencia, creadoen, actualizadoen
  ) VALUES (
    p_despachoid, v_despacho.vendedor_comision_id, v_despacho.cotizacion_id,
    v_despacho.cuenta_id, v_total, v_comision_cabilla, v_comision_otros,
    v_pct_cabilla, v_pct_otros, 'generada', v_total, 0,
    v_extra_details, v_cxc_excluded, v_payment_excluded_commission,
    round(v_excluded_commission, 2), v_fraction, '238b',
    'fecha_despacho_no_cxc', 'stored_net_238b',
    jsonb_build_object(
      'payment_split', v_payment,
      'base_cabilla_usd', round(v_base_cabilla, 4),
      'base_otros_usd', round(v_base_otros, 4),
      'base_externos_usd', round(v_base_externos, 4),
      'commission_before_payment', v_raw_total,
      'commission_after_payment', v_total,
      'cxc_excluded_commission', v_cxc_excluded,
      'payment_excluded_commission', v_payment_excluded_commission,
      'excluded_products_commission', round(v_excluded_commission, 2),
      'excluded_by_payment', COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE),
      'excluded_products_policy', jsonb_build_array('prestamo', 'corte')
    ), now(), now()
  )
  ON CONFLICT (despachoid) DO NOTHING
  RETURNING id INTO v_comision_id;

  IF v_comision_id IS NULL THEN
    SELECT id INTO v_comision_id FROM public.comisiones WHERE despachoid = p_despachoid;
  END IF;
  RETURN v_comision_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Resumen futuro: solo generada, sin estados de pago
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

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
BEGIN
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid() AND u.cuenta_id = p_cuenta_id AND u.activo = TRUE
  ) THEN
    RAISE EXCEPTION 'CUENTA_FUERA_DE_TENANT';
  END IF;

  RETURN QUERY
  SELECT COALESCE(SUM(c.totalcomision), 0)::NUMERIC,
         0::NUMERIC, 0::NUMERIC, 0::BIGINT, 0::BIGINT,
         count(*)::BIGINT
  FROM public.comisiones c
  JOIN public.notas_despacho nd ON nd.id = c.despachoid
  WHERE c.cuentaid = p_cuenta_id
    AND c.estado = 'generada'
    AND (p_estado IS NULL OR p_estado = 'generada')
    AND (p_vendedor_id IS NULL OR c.vendedorid = p_vendedor_id
      OR (p_vendedor_id = '00000000-0000-0000-0000-000000000000'::uuid
          AND c.vendedorid IS NULL))
    AND (p_fecha_inicio IS NULL OR nd.creado_en >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR nd.creado_en <= p_fecha_fin);
END
$$;

-- ---------------------------------------------------------------------------
-- 6. El cutover legacy queda fuera de este contrato revisable.
-- ---------------------------------------------------------------------------
-- No se revocan RPC ni permisos aquí. La revocación requiere smoke autenticado
-- y se ejecutará únicamente mediante 238b_cutover_legacy_rpc_review.sql.
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Batch y snapshot de historicos (sin conversion automatica)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comision_238b_batches (
  batch_key UUID PRIMARY KEY,
  cuenta_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo = 'historical_commission_reconciliation'),
  estado TEXT NOT NULL DEFAULT 'dry_run'
    CHECK (estado IN ('dry_run', 'approved', 'applying', 'applied', 'blocked', 'rolled_back')),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  created_by_name TEXT,
  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal_count INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  rollback_key UUID,
  rollback_at TIMESTAMPTZ,
  rollback_by UUID,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS public.comision_238b_batch_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key UUID NOT NULL REFERENCES public.comision_238b_batches(batch_key),
  comision_id UUID NOT NULL REFERENCES public.comisiones(id),
  despacho_id UUID NOT NULL,
  estado TEXT NOT NULL DEFAULT 'proposed'
    CHECK (estado IN ('proposed', 'manual_review', 'approved', 'applied', 'blocked', 'rolled_back')),
  old_state TEXT,
  old_totalcomision NUMERIC(12,2),
  old_comisioncabilla NUMERIC(12,2),
  old_comisionotros NUMERIC(12,2),
  old_comision_liberada NUMERIC(12,2),
  old_comision_retenida NUMERIC(12,2),
  old_montopagado NUMERIC(12,2),
  old_pagadaen TIMESTAMPTZ,
  old_pagadapor UUID,
  old_comision_cxc_excluida NUMERIC(12,2),
  old_comision_pago_excluida NUMERIC(12,2),
  old_comision_otras_exclusiones NUMERIC(12,2),
  old_fraccion_no_cxc NUMERIC(12,8),
  old_detalle_extras JSONB,
  old_calculo_version TEXT,
  old_politica_comision TEXT,
  old_fuente_calculo TEXT,
  old_calculo_evidencia JSONB,
  proposed_evidencia JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_state TEXT,
  proposed_totalcomision NUMERIC(12,2),
  proposed_comisioncabilla NUMERIC(12,2),
  proposed_comisionotros NUMERIC(12,2),
  proposed_comision_liberada NUMERIC(12,2),
  proposed_comision_retenida NUMERIC(12,2),
  proposed_montopagado NUMERIC(12,2) NOT NULL DEFAULT 0,
  proposed_pagadaen TIMESTAMPTZ,
  proposed_pagadapor UUID,
  proposed_comision_cxc_excluida NUMERIC(12,2) NOT NULL DEFAULT 0,
  proposed_comision_pago_excluida NUMERIC(12,2) NOT NULL DEFAULT 0,
  proposed_comision_otras_exclusiones NUMERIC(12,2) NOT NULL DEFAULT 0,
  proposed_fraccion_no_cxc NUMERIC(12,8),
  proposed_detalle_extras JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_calculo_version TEXT NOT NULL DEFAULT '238b',
  proposed_politica_comision TEXT NOT NULL DEFAULT 'fecha_despacho_no_cxc',
  proposed_fuente_calculo TEXT NOT NULL DEFAULT 'historical_reconciliation_238b',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ,
  applied_by UUID,
  UNIQUE (batch_key, comision_id)
);

ALTER TABLE public.comision_238b_batch_rows
  ADD COLUMN IF NOT EXISTS old_pagadaen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS old_pagadapor UUID,
  ADD COLUMN IF NOT EXISTS old_comision_pago_excluida NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS proposed_montopagado NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proposed_pagadaen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_pagadapor UUID,
  ADD COLUMN IF NOT EXISTS proposed_comision_pago_excluida NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_comision_238b_batch_rows_batch
  ON public.comision_238b_batch_rows(batch_key, estado);

-- Rollback historico: restaura exactamente el snapshot solo si nadie modifico
-- la fila despues del apply. No elimina evidencia ni movimientos de auditoria.
CREATE OR REPLACE FUNCTION public.revertir_reconciliacion_comisiones_238b(
  p_batch_key UUID,
  p_rollback_key UUID,
  p_usuario_id UUID,
  p_usuario_nombre TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_row RECORD;
  v_current RECORD;
  v_count INTEGER := 0;
BEGIN
  IF p_batch_key IS NULL OR p_rollback_key IS NULL OR p_usuario_id IS NULL
     OR NULLIF(btrim(p_usuario_nombre), '') IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_ROLLBACK_COMISIONES_INVALIDOS';
  END IF;

  SELECT * INTO v_batch
  FROM public.comision_238b_batches
  WHERE batch_key = p_batch_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_COMISIONES_NO_ENCONTRADO'; END IF;
  PERFORM public.comision_238b_assert_operator(v_batch.cuenta_id, p_usuario_id);
  IF v_batch.estado = 'rolled_back' THEN
    IF v_batch.rollback_key IS DISTINCT FROM p_rollback_key THEN
      RAISE EXCEPTION 'ROLLBACK_KEY_REUTILIZADA';
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE,
      'batch_key', p_batch_key, 'rollback_key', v_batch.rollback_key);
  END IF;
  IF v_batch.estado <> 'applied' THEN
    RAISE EXCEPTION 'BATCH_COMISIONES_NO_APLICADO';
  END IF;
  IF v_batch.rollback_key IS NOT NULL AND v_batch.rollback_key <> p_rollback_key THEN
    RAISE EXCEPTION 'ROLLBACK_KEY_REUTILIZADA';
  END IF;

  FOR v_row IN
    SELECT * FROM public.comision_238b_batch_rows
    WHERE batch_key = p_batch_key AND estado = 'applied'
    ORDER BY id
    FOR UPDATE
  LOOP
    SELECT * INTO v_current FROM public.comisiones
    WHERE id = v_row.comision_id
      AND despachoid = v_row.despacho_id
      AND cuentaid = v_batch.cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'COMISION_SNAPSHOT_NO_ENCONTRADA'; END IF;

    IF v_current.estado IS DISTINCT FROM v_row.proposed_state
       OR v_current.totalcomision IS DISTINCT FROM v_row.proposed_totalcomision
       OR v_current.comisioncabilla IS DISTINCT FROM v_row.proposed_comisioncabilla
       OR v_current.comisionotros IS DISTINCT FROM v_row.proposed_comisionotros
       OR v_current.comision_liberada IS DISTINCT FROM v_row.proposed_comision_liberada
       OR v_current.comision_retenida IS DISTINCT FROM v_row.proposed_comision_retenida
       OR v_current.montopagado IS DISTINCT FROM v_row.proposed_montopagado
       OR v_current.pagadaen IS DISTINCT FROM v_row.proposed_pagadaen
       OR v_current.pagadapor IS DISTINCT FROM v_row.proposed_pagadapor
       OR v_current.comision_cxc_excluida IS DISTINCT FROM v_row.proposed_comision_cxc_excluida
       OR v_current.comision_pago_excluida IS DISTINCT FROM v_row.proposed_comision_pago_excluida
       OR v_current.comision_otras_exclusiones IS DISTINCT FROM v_row.proposed_comision_otras_exclusiones
       OR v_current.fraccion_no_cxc IS DISTINCT FROM v_row.proposed_fraccion_no_cxc
       OR v_current.detalle_extras IS DISTINCT FROM v_row.proposed_detalle_extras
       OR v_current.calculo_version IS DISTINCT FROM v_row.proposed_calculo_version
       OR v_current.politica_comision IS DISTINCT FROM v_row.proposed_politica_comision
       OR v_current.fuente_calculo IS DISTINCT FROM v_row.proposed_fuente_calculo
       OR v_current.calculo_evidencia IS DISTINCT FROM v_row.proposed_evidencia THEN
      RAISE EXCEPTION 'ROLLBACK_COMISION_BLOQUEADO_POR_CAMBIO_POSTERIOR: %', v_row.comision_id;
    END IF;

    UPDATE public.comisiones
    SET estado = v_row.old_state,
        totalcomision = v_row.old_totalcomision,
        comisioncabilla = v_row.old_comisioncabilla,
        comisionotros = v_row.old_comisionotros,
        comision_liberada = v_row.old_comision_liberada,
        comision_retenida = v_row.old_comision_retenida,
        montopagado = v_row.old_montopagado,
        pagadaen = v_row.old_pagadaen,
        pagadapor = v_row.old_pagadapor,
        comision_cxc_excluida = v_row.old_comision_cxc_excluida,
        comision_pago_excluida = v_row.old_comision_pago_excluida,
        comision_otras_exclusiones = v_row.old_comision_otras_exclusiones,
        fraccion_no_cxc = v_row.old_fraccion_no_cxc,
        detalle_extras = v_row.old_detalle_extras,
        calculo_version = v_row.old_calculo_version,
        politica_comision = v_row.old_politica_comision,
        fuente_calculo = v_row.old_fuente_calculo,
        calculo_evidencia = v_row.old_calculo_evidencia,
        actualizadoen = now()
    WHERE id = v_row.comision_id;

    UPDATE public.comision_238b_batch_rows
    SET estado = 'rolled_back'
    WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.comision_238b_batches
  SET estado = 'rolled_back', rollback_key = p_rollback_key,
      rollback_at = now(), rollback_by = p_usuario_id
  WHERE batch_key = p_batch_key;

  RETURN jsonb_build_object('ok', TRUE, 'batch_key', p_batch_key,
    'rollback_key', p_rollback_key, 'restored', v_count,
    'evidence_preserved', TRUE);
END
$$;

ALTER TABLE public.comision_238b_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comision_238b_batch_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.comision_238b_batches, public.comision_238b_batch_rows
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.comision_238b_batches, public.comision_238b_batch_rows
  TO service_role;

REVOKE ALL ON FUNCTION public.comision_238b_assert_operator(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comision_238b_pago_split(NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comision_238b_item_breakdown(NUMERIC, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calcularcomisiondespacho_238b(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revertir_reconciliacion_comisiones_238b(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.comision_238b_assert_operator(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.comision_238b_pago_split(NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.comision_238b_item_breakdown(NUMERIC, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_reconciliacion_comisiones_238b(UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
