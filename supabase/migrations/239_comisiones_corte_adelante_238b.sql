-- 239: corte hacia adelante de comisiones con politica 238b
--
-- Las filas existentes no se migran ni se recalculan. Desde esta migracion:
--   * toda comision nueva usa calculo_version = '238b';
--   * CxC nunca entra en totalcomision;
--   * un pago mixto sin montos explicitos se bloquea para revision manual;
--   * recalculos solo pueden borrar/recrear una fila que ya sea 238b;
--   * la firma legacy queda como wrapper compatible para triggers antiguos.

BEGIN;

-- 239 depende de que el contrato de cálculo 238b ya esté instalado. La
-- migración no crea una versión incompleta ni reemplaza silenciosamente el
-- cálculo si faltan sus columnas de evidencia.
DO $$
BEGIN
  IF to_regclass('public.comisiones') IS NULL
     OR to_regclass('public.notas_despacho') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas base de comisiones ausentes';
  END IF;
  IF to_regprocedure('public.calcularcomisiondespacho_238b(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: instalar primero el contrato calcularcomisiondespacho_238b(uuid)';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comisiones'
      AND column_name = ANY (ARRAY[
        'detalle_extras', 'comision_liberada', 'comision_retenida',
        'comision_cxc_excluida', 'comision_pago_excluida',
        'comision_otras_exclusiones', 'fraccion_no_cxc', 'calculo_version',
        'politica_comision', 'fuente_calculo', 'calculo_evidencia'
      ])
  ) <> 11 THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: columnas de evidencia 238b incompletas';
  END IF;
END
$$;

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

    SELECT count(*) FILTER (WHERE method.is_cxc),
           count(*) FILTER (WHERE NOT method.is_cxc)
    INTO v_cxc_methods, v_non_cxc_methods
    FROM jsonb_array_elements(v_methods) AS elem
    CROSS JOIN LATERAL (
      SELECT lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) AS name,
      (
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
      ) AS is_cxc
    ) AS method;

    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor', '')
           ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor')::numeric
      ELSE 0
    END), 0)
    INTO v_cxc_explicit
    FROM jsonb_array_elements(v_methods) AS elem
    CROSS JOIN LATERAL (
      SELECT lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) AS name
    ) AS method
    WHERE method.name = 'cxc'
       OR method.name LIKE '%cta por cobrar%'
       OR method.name LIKE '%cuenta por cobrar%'
       OR method.name LIKE '%credito%'
       OR method.name LIKE '%credit%';

    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor', '')
           ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor')::numeric
      ELSE 0
    END), 0)
    INTO v_non_cxc_explicit
    FROM jsonb_array_elements(v_methods) AS elem
    CROSS JOIN LATERAL (
      SELECT lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) AS name
    ) AS method
    WHERE NOT (
      method.name = 'cxc'
      OR method.name LIKE '%cta por cobrar%'
      OR method.name LIKE '%cuenta por cobrar%'
      OR method.name LIKE '%credito%'
      OR method.name LIKE '%credit%'
    );

    SELECT COALESCE(bool_or(method.name LIKE 'donac%' OR method.name LIKE 'prestam%'), FALSE)
    INTO v_excluded
    FROM jsonb_array_elements(v_methods) AS elem
    CROSS JOIN LATERAL (
      SELECT lower(translate(trim(COALESCE(
        elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', ''
      )), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) AS name
    ) AS method;

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
  IF v_excluded OR v_requires_manual_review THEN
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

CREATE OR REPLACE FUNCTION public.enforce_comision_238b_payment_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho RECORD;
  v_payment JSONB;
BEGIN
  -- Ninguna inserción nueva puede volver a la forma legacy. Las filas
  -- históricas se conservan, pero no se recrean con la política antigua.
  IF TG_OP = 'INSERT' AND NEW.calculo_version IS DISTINCT FROM '238b' THEN
    RAISE EXCEPTION 'COMISION_NUEVA_DEBE_USAR_238B';
  END IF;

  IF NEW.calculo_version IS DISTINCT FROM '238b' THEN
    RETURN NEW;
  END IF;

  SELECT nd.total_usd, nd.forma_pago_cliente, nd.forma_pago
  INTO v_despacho
  FROM public.notas_despacho nd
  WHERE nd.id = NEW.despachoid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_COMISION_NO_ENCONTRADO';
  END IF;

  v_payment := public.comision_238b_pago_split(
    v_despacho.total_usd, v_despacho.forma_pago_cliente, v_despacho.forma_pago
  );
  IF COALESCE((v_payment->>'requires_manual_review')::boolean, FALSE) THEN
    RAISE EXCEPTION 'PAGO_MIXTO_SIN_MONTOS_REQUIERE_REVISION';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_comision_238b_payment_guard ON public.comisiones;
CREATE TRIGGER trg_comision_238b_payment_guard
  BEFORE INSERT OR UPDATE OF calculo_version, despachoid ON public.comisiones
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_comision_238b_payment_guard();

CREATE OR REPLACE FUNCTION public.recalcularcomisiondespacho_238b(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing RECORD;
  v_result UUID;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  SELECT c.id, c.calculo_version
  INTO v_existing
  FROM public.comisiones c
  WHERE c.despachoid = p_despachoid
  FOR UPDATE;

  IF FOUND AND v_existing.calculo_version IS DISTINCT FROM '238b' THEN
    RETURN v_existing.id;
  END IF;

  IF FOUND THEN
    DELETE FROM public.comisiones WHERE id = v_existing.id;
  END IF;

  v_result := public.calcularcomisiondespacho_238b(p_despachoid);
  RETURN v_result;
END
$$;

-- Compatibilidad para los wrappers de entrega que todavía invocan la firma
-- histórica: una comisión existente se devuelve sin tocarla y una comisión
-- nueva delega en 238b.
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN public.calcularcomisiondespacho_238b(p_despachoid);
END
$$;

REVOKE ALL ON FUNCTION public.recalcularcomisiondespacho_238b(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_comision_238b_payment_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comision_238b_pago_split(NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalcularcomisiondespacho_238b(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.comision_238b_pago_split(NUMERIC, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.calcularcomisiondespacho(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
