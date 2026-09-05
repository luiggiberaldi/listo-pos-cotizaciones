-- ═════════════════════════════════════════════════════════════════════════════
-- 07_comision_split_designado_v3_review.sql
-- Puerto del split de comisiones de sábados (modelo v3 "designado del día")
-- desde staging (257/260/263) al PRINCIPAL. Plan:
--   docs/plans/2026-09-04-plan-comision-split-designado-sabados-v3.md
--
-- Contenido:
--   1) Columnas de configuración split (toggle FORZADO OFF)
--   2) Unicidad multi-fila: ux_comisiones_despacho_vendedor (despachoid, vendedorid)
--   3) Tabla comision_designacion_diaria + trigger validador (excluye es_externo)
--   4) calcularcomisiondespacho_238b v4 (designado del día)
--   5) recalcularcomisiondespacho_238b multi-fila (función ausente en el principal:
--      los recalcos del Worker fallan en silencio hoy)
--   6) ajustar_finanzas_devolucion_atomica multi-fila (263)
--   7) Grants + NOTIFY
--
-- REGLAS DE SEGURIDAD:
--   · El toggle nace OFF: cero cambio de comportamiento hasta el piloto.
--   · Los pagos mixtos conservan el comportamiento vivo del principal
--     (sin requires_manual_review; la decisión de política 239 no se porta aquí).
--   · Idempotente: IF NOT EXISTS / OR REPLACE en todos los objetos.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Configuración split (defaults staging 257, PERO toggle OFF)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS comision_split_activo      boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comision_split_pct_vendedor numeric(5,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS comision_split_pct_dueno    numeric(5,2) NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS comision_split_dias         text         NOT NULL DEFAULT '6';

-- Cinturón y tirantes: aunque la columna exista de antes, el paquete garantiza OFF.
UPDATE public.configuracion_negocio SET comision_split_activo = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Unicidad: 1 fila por (despacho, beneficiario). El índice viejo
--    ux_comisiones_despachoid_238a garantiza 0 multi-filas previas (verificado).
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.ux_comisiones_despachoid_238a;
CREATE UNIQUE INDEX IF NOT EXISTS ux_comisiones_despacho_vendedor
  ON public.comisiones (despachoid, vendedorid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Designación diaria del "vendedor del día" (solo jefe vía Worker)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comision_designacion_diaria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cuenta_id = cuenta de negocio (auth account). FK a configuracion_negocio
  -- como en la 195: usuarios(id) NUNCA contiene el id de cuenta.
  cuenta_id     UUID NOT NULL REFERENCES public.configuracion_negocio(cuenta_id) ON DELETE CASCADE,
  fecha         DATE NOT NULL,
  designado_id  UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  creado_por    UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, fecha)
);

-- El designado solo puede ser vendedor o supervisor (jefe de ventas) activos.
-- (PostgreSQL no permite subqueries en CHECK → trigger BEFORE.)
CREATE OR REPLACE FUNCTION public.validar_designacion_diaria()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
  v_activo BOOLEAN;
  v_externo BOOLEAN;
BEGIN
  SELECT rol, activo, es_externo INTO v_rol, v_activo, v_externo
  FROM public.usuarios WHERE id = NEW.designado_id;
  IF NOT FOUND OR v_activo IS NOT TRUE
     OR v_externo IS TRUE
     OR v_rol NOT IN ('vendedor', 'supervisor') THEN
    RAISE EXCEPTION 'DESIGNADO_INVALIDO: solo vendedor o supervisor activos (no externos) pueden ser designados';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_designacion_diaria ON public.comision_designacion_diaria;
CREATE TRIGGER trg_validar_designacion_diaria
  BEFORE INSERT OR UPDATE OF designado_id ON public.comision_designacion_diaria
  FOR EACH ROW EXECUTE FUNCTION public.validar_designacion_diaria();

CREATE INDEX IF NOT EXISTS idx_designacion_diaria_fecha
  ON public.comision_designacion_diaria (fecha);

-- RLS: lectura para usuarios autenticados de la misma cuenta; escritura
-- únicamente vía service_role (el Worker valida el rol jefe).
ALTER TABLE public.comision_designacion_diaria ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY designacion_select ON public.comision_designacion_diaria
    FOR SELECT USING (cuenta_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) calcularcomisiondespacho_238b — v4 con designado del día
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho_238b(p_despachoid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_extras_monto NUMERIC := 0;
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
  -- Split designado (v3)
  v_split_aplica BOOLEAN := FALSE;
  v_split_pct_d NUMERIC := 1.5;      -- % del dueño del cliente
  v_split_pct_desig NUMERIC := 0.5;  -- % del designado del día
  v_dow INTEGER;
  v_designado_id UUID;               -- designado del día (si hay y es válido)
  v_seller_rol TEXT;
  v_seller_ext BOOLEAN;
  v_seller_markup NUMERIC;
  v_seller_id UUID;                  -- vendedor que vendió
  v_dueno_id UUID;                   -- dueño del cliente (vendedor_comision_id)
  v_pct_general_cab NUMERIC;         -- % general vigente (para guard ≤)
  v_pct_general_otro NUMERIC;
  v_d_total NUMERIC := 0;
  v_d_raw NUMERIC := 0;
  v_d_pago_excl NUMERIC := 0;
  v_d_cxc NUMERIC := 0;
  v_d_extras_json JSONB := '[]'::jsonb;
  v_desig_com_cab NUMERIC := 0;
  v_desig_com_otros NUMERIC := 0;
  v_desig_extras NUMERIC := 0;
  v_desig_total NUMERIC := 0;
  v_desig_raw NUMERIC := 0;
  v_desig_pago_excl NUMERIC := 0;
  v_desig_cxc NUMERIC := 0;
  v_desig_extras_json JSONB := '[]'::jsonb;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         nd.vendedor_id, nd.total_usd, nd.forma_pago, nd.forma_pago_cliente,
         nd.creado_en,
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

  -- Dueño del cliente no comisionable (jefe/admin/logística/etc.) → sin comisión
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

  -- ── Decisión de split (v3: designado del día) ─────────────────────────────
  -- Requisitos (regla v3.1 del jefe, 2026-09-05): config activa ∧ día configurado
  --             ∧ HAY designado válido ese día ∧ vendedor elegible (vendedor/
  --             supervisor no externo) ∧ dueño del cliente no externo.
  -- TODAS las ventas del día splittean, incluidas las de cliente propio del
  -- vendedor (dueño=vetendedor cobra %_dueno en su fila + designado su 0.5%).
  -- Designado = dueño del cliente → solo cobra su % normal (se detecta en el INSERT).
  v_split_aplica := FALSE;
  v_designado_id := NULL;
  IF FOUND AND COALESCE(v_cfg.comision_split_activo, FALSE)
     AND v_despacho.vendedor_id IS NOT NULL
     AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN

    -- El vendedor que vendió debe ser elegible (vendedor/supervisor no externo;
    -- vendedor_sin_comision interno sin markup queda excluido)
    SELECT us.rol, us.es_externo, us.markup_pct
    INTO v_seller_rol, v_seller_ext, v_seller_markup
    FROM public.usuarios us
    WHERE us.id = v_despacho.vendedor_id;

    IF v_seller_rol IN ('vendedor', 'supervisor')
       AND COALESCE(v_seller_ext, FALSE) = FALSE THEN

      v_dow := EXTRACT(dow FROM v_despacho.creado_en AT TIME ZONE 'America/Caracas')::int;  -- 0=domingo … 6=sábado (hora VE)
      IF trim(COALESCE(v_cfg.comision_split_dias, '')) = '' THEN
        v_split_aplica := TRUE;  -- vacío = todos los días
      ELSE
        PERFORM 1
        FROM unnest(string_to_array(trim(v_cfg.comision_split_dias), ',')) AS t(dia)
        WHERE trim(t.dia) ~ '^[0-6]$' AND trim(t.dia)::int = v_dow;
        IF FOUND THEN v_split_aplica := TRUE; END IF;
      END IF;

      -- Designado del día: válido solo si existe, es vendedor/supervisor activo
      IF v_split_aplica THEN
        SELECT d.designado_id INTO v_designado_id
        FROM public.comision_designacion_diaria d
        WHERE d.cuenta_id = v_despacho.cuenta_id
          AND d.fecha = (v_despacho.creado_en AT TIME ZONE 'America/Caracas')::date
          AND EXISTS (
            SELECT 1 FROM public.usuarios ud
            WHERE ud.id = d.designado_id
              AND ud.activo = TRUE
              AND ud.rol IN ('vendedor', 'supervisor')
          )
        LIMIT 1;

        IF v_designado_id IS NULL THEN
          v_split_aplica := FALSE;  -- sin designación válida → todo normal
        ELSE
          v_split_pct_desig := COALESCE(v_cfg.comision_split_pct_vendedor, 0.5);
          v_split_pct_d := COALESCE(v_cfg.comision_split_pct_dueno, 1.5);
          v_seller_id := v_despacho.vendedor_id;
          v_dueno_id := v_despacho.vendedor_comision_id;
          -- Guard: los % del split NUNCA superan el % general vigente
          v_pct_general_cab := COALESCE(v_despacho.vendedor_comision_pct_cabilla,
            v_cfg.comision_pct_cabilla, 2);
          v_pct_general_otro := COALESCE(v_despacho.vendedor_comision_pct,
            v_cfg.comision_pct_otros, 3);
          IF v_split_pct_desig > v_pct_general_cab OR v_split_pct_desig > v_pct_general_otro
             OR v_split_pct_d > v_pct_general_cab OR v_split_pct_d > v_pct_general_otro THEN
            v_split_pct_desig := LEAST(v_split_pct_desig, v_pct_general_cab, v_pct_general_otro);
            v_split_pct_d := LEAST(v_split_pct_d, v_pct_general_cab, v_pct_general_otro);
          END IF;
          -- Si el dueño del cliente ES el designado → solo cobra su % normal
          IF v_designado_id = v_dueno_id THEN
            v_split_aplica := FALSE;
            v_designado_id := NULL;
          END IF;
        END IF;
      END IF;
    END IF;
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
        v_extras_monto := v_extras_monto + (v_breakdown->>'value_usd')::numeric;
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
        v_extras_monto := v_extras_monto + (v_breakdown->>'value_usd')::numeric;
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

  -- ── INSERT fila del dueño del cliente (siempre; % normales o %_dueno si split) ──
  IF v_split_aplica THEN
    v_d_total := round(
      v_base_cabilla * v_split_pct_d / 100 * v_fraction
      + (v_base_otros + v_base_externos) * v_split_pct_d / 100 * v_fraction
      + v_extras_monto * v_split_pct_d / 100 * v_fraction, 2);
    v_d_raw := round(
      (v_base_cabilla + v_base_otros + v_base_externos + v_extras_monto)
      * v_split_pct_d / 100, 2);
    v_d_pago_excl := CASE
      WHEN COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE) THEN v_d_raw
      ELSE 0 END;
    v_d_cxc := CASE WHEN v_d_pago_excl > 0 THEN 0
      ELSE round(v_d_raw * (1 - v_fraction), 2) END;
    SELECT COALESCE(jsonb_agg(elem
      || jsonb_build_object('pct', v_split_pct_d)
      || jsonb_build_object('comision',
           round(COALESCE((elem->>'monto')::numeric, 0) * v_split_pct_d / 100 * v_fraction, 2))
    ), '[]'::jsonb)
    INTO v_d_extras_json FROM jsonb_array_elements(v_extra_details) AS elem;
  END IF;

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
    v_despacho.cuenta_id,
    CASE WHEN v_split_aplica THEN v_d_total ELSE v_total END,
    CASE WHEN v_split_aplica
      THEN round(v_base_cabilla * v_split_pct_d / 100 * v_fraction, 2)
      ELSE v_comision_cabilla END,
    CASE WHEN v_split_aplica
      THEN round((v_base_otros + v_base_externos) * v_split_pct_d / 100 * v_fraction, 2)
      ELSE v_comision_otros END,
    CASE WHEN v_split_aplica THEN v_split_pct_d ELSE v_pct_cabilla END,
    CASE WHEN v_split_aplica THEN v_split_pct_d ELSE v_pct_otros END,
    'generada',
    CASE WHEN v_split_aplica THEN v_d_total ELSE v_total END, 0,
    CASE WHEN v_split_aplica THEN v_d_extras_json ELSE v_extra_details END,
    CASE WHEN v_split_aplica THEN v_d_cxc ELSE v_cxc_excluded END,
    CASE WHEN v_split_aplica THEN v_d_pago_excl ELSE v_payment_excluded_commission END,
    round(v_excluded_commission, 2), v_fraction, '238b',
    'fecha_despacho_no_cxc', 'stored_net_238b',
    jsonb_build_object(
      'payment_split', v_payment,
      'base_cabilla_usd', round(v_base_cabilla, 4),
      'base_otros_usd', round(v_base_otros, 4),
      'base_externos_usd', round(v_base_externos, 4),
      'commission_before_payment', CASE WHEN v_split_aplica THEN v_d_raw ELSE v_raw_total END,
      'commission_after_payment', CASE WHEN v_split_aplica THEN v_d_total ELSE v_total END,
      'cxc_excluded_commission', CASE WHEN v_split_aplica THEN v_d_cxc ELSE v_cxc_excluded END,
      'payment_excluded_commission', CASE WHEN v_split_aplica THEN v_d_pago_excl ELSE v_payment_excluded_commission END,
      'excluded_products_commission', round(v_excluded_commission, 2),
      'excluded_by_payment', COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE),
      'excluded_products_policy', jsonb_build_array('prestamo', 'corte'),
      'split_designado', v_split_aplica,
      'split_cliente_ajeno', v_split_aplica,
      'split_pct_designado', CASE WHEN v_split_aplica THEN v_split_pct_desig END,
      'split_pct_dueno', CASE WHEN v_split_aplica THEN v_split_pct_d END,
      'split_designado_id', CASE WHEN v_split_aplica THEN to_jsonb(v_designado_id) END,
      'split_vendedor_id', CASE WHEN v_split_aplica THEN to_jsonb(v_seller_id) END,
      'split_dow', CASE WHEN v_split_aplica THEN to_jsonb(v_dow) END
    ), now(), now()
  )
  ON CONFLICT (despachoid, vendedorid) DO NOTHING
  RETURNING id INTO v_comision_id;

  IF v_comision_id IS NULL THEN
    SELECT id INTO v_comision_id FROM public.comisiones
    WHERE despachoid = p_despachoid AND vendedorid = v_despacho.vendedor_comision_id;
  END IF;

  -- ── INSERT fila del designado del día (solo split; el vendedor que vendió NO cobra) ──
  IF v_split_aplica AND v_designado_id IS NOT NULL THEN
    v_desig_com_cab := round(v_base_cabilla * v_split_pct_desig / 100 * v_fraction, 2);
    v_desig_com_otros := round((v_base_otros + v_base_externos) * v_split_pct_desig / 100 * v_fraction, 2);
    v_desig_extras := round(v_extras_monto * v_split_pct_desig / 100 * v_fraction, 2);
    v_desig_total := round(v_desig_com_cab + v_desig_com_otros + v_desig_extras, 2);
    v_desig_raw := round(
      (v_base_cabilla + v_base_otros + v_base_externos + v_extras_monto)
      * v_split_pct_desig / 100, 2);
    v_desig_pago_excl := CASE
      WHEN COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE) THEN v_desig_raw
      ELSE 0 END;
    v_desig_cxc := CASE WHEN v_desig_pago_excl > 0 THEN 0
      ELSE round(v_desig_raw * (1 - v_fraction), 2) END;
    SELECT COALESCE(jsonb_agg(elem
      || jsonb_build_object('pct', v_split_pct_desig)
      || jsonb_build_object('comision',
           round(COALESCE((elem->>'monto')::numeric, 0) * v_split_pct_desig / 100 * v_fraction, 2))
    ), '[]'::jsonb)
    INTO v_desig_extras_json FROM jsonb_array_elements(v_extra_details) AS elem;

    INSERT INTO public.comisiones (
      despachoid, vendedorid, cotizacionid, cuentaid,
      totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros,
      estado, comision_liberada, comision_retenida,
      detalle_extras, comision_cxc_excluida, comision_pago_excluida,
      comision_otras_exclusiones, fraccion_no_cxc, calculo_version,
      politica_comision, fuente_calculo,
      calculo_evidencia, creadoen, actualizadoen
    ) VALUES (
      p_despachoid, v_designado_id, v_despacho.cotizacion_id, v_despacho.cuenta_id,
      v_desig_total, v_desig_com_cab, v_desig_com_otros, v_split_pct_desig, v_split_pct_desig,
      'generada', v_desig_total, 0,
      v_desig_extras_json, v_desig_cxc, v_desig_pago_excl,
      round(v_excluded_commission, 2), v_fraction, '238b',
      'fecha_despacho_no_cxc', 'stored_net_238b',
      jsonb_build_object(
        'payment_split', v_payment,
        'base_cabilla_usd', round(v_base_cabilla, 4),
        'base_otros_usd', round(v_base_otros, 4),
        'base_externos_usd', round(v_base_externos, 4),
        'commission_before_payment', v_desig_raw,
        'commission_after_payment', v_desig_total,
        'cxc_excluded_commission', v_desig_cxc,
        'payment_excluded_commission', v_desig_pago_excl,
        'excluded_products_commission', round(v_excluded_commission, 2),
        'excluded_by_payment', COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE),
        'excluded_products_policy', jsonb_build_array('prestamo', 'corte'),
        'split_designado', TRUE,
        'split_cliente_ajeno', TRUE,
        'split_pct_designado', v_split_pct_desig,
        'split_pct_dueno', v_split_pct_d,
        'split_designado_id', to_jsonb(v_designado_id),
        'split_vendedor_id', to_jsonb(v_seller_id),
        'split_dueno_id', to_jsonb(v_dueno_id),
        'split_dow', to_jsonb(v_dow)
      ), now(), now()
    )
    ON CONFLICT (despachoid, vendedorid) DO NOTHING;
  END IF;

  RETURN v_comision_id;
END
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) recalcularcomisiondespacho_238b — multi-fila: legacy intacto, pagadas
--    intocables (G3), delete completo + recreate. (Ausente en el principal.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalcularcomisiondespacho_238b(p_despachoid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing UUID;
  v_result UUID;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  -- Lock de todas las filas del despacho
  PERFORM c.id FROM public.comisiones c
  WHERE c.despachoid = p_despachoid
  FOR UPDATE;

  -- Filas legacy (≠ 238b): se conservan sin tocar
  IF EXISTS (
    SELECT 1 FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
      AND c.calculo_version IS DISTINCT FROM '238b'
  ) THEN
    SELECT c.id INTO v_existing
    FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
    ORDER BY c.creadoen
    LIMIT 1;
    RETURN v_existing;
  END IF;

  -- G3: alguna fila pagada o con pagos parciales → no se recalcula
  IF EXISTS (
    SELECT 1 FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
      AND (c.estado = 'pagada' OR COALESCE(c.montopagado, 0) > 0.01)
  ) THEN
    SELECT c.id INTO v_existing
    FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
    ORDER BY c.creadoen
    LIMIT 1;
    RETURN v_existing;
  END IF;

  DELETE FROM public.comisiones WHERE despachoid = p_despachoid;
  v_result := public.calcularcomisiondespacho_238b(p_despachoid);
  RETURN v_result;
END
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) ajustar_finanzas_devolucion_atomica — escalado multi-fila (lección 262/263)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajustar_finanzas_devolucion_atomica(
  p_despacho_id           UUID,
  p_total_devuelto_usd    NUMERIC,
  p_total_intercambio_usd NUMERIC,
  p_usuario_id            UUID DEFAULT NULL,
  p_usuario_nombre        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho           RECORD;
  v_cliente            RECORD;
  v_usuario_fk         UUID;
  v_comision           RECORD;
  v_total_original     NUMERIC(12,4);
  v_total_nuevo        NUMERIC(12,4);
  v_balance_neto       NUMERIC(12,4);
  v_cxc_despacho       NUMERIC(12,4) := 0;
  v_saldo_pendiente    NUMERIC(12,4) := 0;
  v_saldo_favor        NUMERIC(12,4) := 0;
  v_tiene_cliente      BOOLEAN := FALSE;
  v_abono              NUMERIC(12,4) := 0;
  v_credito            NUMERIC(12,4) := 0;
  v_cargo              NUMERIC(12,4) := 0;
  v_factor             NUMERIC(12,8);
  v_liberada           NUMERIC(12,2);
  v_retenida           NUMERIC(12,2);
  v_comision_nueva     NUMERIC(12,2);
  v_comision_ajustada  BOOLEAN := FALSE;
  v_destino            TEXT := COALESCE(NULLIF(btrim(COALESCE(current_setting('app.devolucion_destino', TRUE), '')), ''), 'saldo_a_favor');
  v_pagos_reembolso    JSONB := NULLIF(current_setting('app.devolucion_reembolso_pagos', TRUE), '')::JSONB;
  v_pago               RECORD;
  v_reembolso_total    NUMERIC(12,4) := 0;
  v_metodos_resumen    TEXT;
  v_refs_resumen       TEXT;
BEGIN
  IF p_despacho_id IS NULL
     OR p_total_devuelto_usd IS NULL
     OR p_total_intercambio_usd IS NULL
     OR p_total_devuelto_usd < 0
     OR p_total_intercambio_usd < 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_FINANZAS_DEVOLUCION_INVALIDOS';
  END IF;

  IF v_destino NOT IN ('saldo_a_favor', 'reembolso') THEN
    RAISE EXCEPTION 'DESTINO_SALDO_INVALIDO';
  END IF;
  IF v_destino = 'reembolso' AND v_pagos_reembolso IS NULL THEN
    RAISE EXCEPTION 'REEMBOLSO_PAGOS_REQUERIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND OR v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'DESPACHO_FINANZAS_NO_DISPONIBLE';
  END IF;

  v_total_nuevo := COALESCE(v_despacho.total_usd, 0);
  v_total_original := ROUND((v_total_nuevo
    + p_total_devuelto_usd
    - p_total_intercambio_usd)::NUMERIC, 4);

  IF v_total_original < 0 OR v_total_nuevo < 0 THEN
    RAISE EXCEPTION 'TOTAL_DEVOLUCION_INVALIDO';
  END IF;

  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;

  IF v_usuario_fk IS NULL THEN
    SELECT u.id
    INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
    ORDER BY u.nombre
    LIMIT 1;
  END IF;

  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_CXC_NO_ENCONTRADO';
  END IF;

  IF COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id) IS NOT NULL THEN
    SELECT *
    INTO v_cliente
    FROM public.clientes
    WHERE id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id)
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLIENTE_CXC_NO_ENCONTRADO';
    END IF;

    v_tiene_cliente := TRUE;
    v_saldo_pendiente := COALESCE(v_cliente.saldo_pendiente, 0);
    v_saldo_favor := COALESCE(v_cliente.saldo_a_favor, 0);

    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);

    IF v_balance_neto > 0 THEN
      v_cargo := v_balance_neto;

      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id,
        p_despacho_id,
        'cargo',
        v_cargo,
        ROUND((v_saldo_pendiente + v_cargo)::NUMERIC, 4),
        'Cargo por diferencia en intercambio — Despacho #' || v_despacho.numero,
        v_usuario_fk,
        v_despacho.cuenta_id
      );
    ELSIF v_balance_neto < 0 THEN
      IF v_destino = 'reembolso' THEN
        -- Reembolso coherente: deuda intacta; todo el balance es crédito que
        -- se consume abajo con devolucion_credito en la misma transacción.
        v_credito := ROUND(abs(v_balance_neto)::NUMERIC, 4);
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
        ) VALUES (
          v_cliente.id,
          p_despacho_id,
          'credito',
          v_credito,
          GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
          'Devolución',
          'Despacho #' || v_despacho.numero,
          'Saldo a favor para reembolso — Despacho #' || v_despacho.numero,
          v_usuario_fk,
          v_despacho.cuenta_id
        );
      ELSE
        -- Histórico: compensa la deuda del despacho; excedente a crédito.
        SELECT COALESCE(SUM(
          CASE
            WHEN c.tipo = 'cargo' THEN c.monto_usd
            WHEN c.tipo = 'abono' THEN -c.monto_usd
            ELSE 0
          END
        ), 0)
        INTO v_cxc_despacho
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id;

        v_cxc_despacho := GREATEST(0, v_cxc_despacho);
        v_abono := ROUND(LEAST(abs(v_balance_neto), v_cxc_despacho)::NUMERIC, 4);

        IF v_abono > 0 THEN
          INSERT INTO public.cuentas_por_cobrar (
            cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
            forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
          ) VALUES (
            v_cliente.id,
            p_despacho_id,
            'abono',
            v_abono,
            GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
            'Devolución',
            'Despacho #' || v_despacho.numero,
            'Abono por devolución/intercambio — Despacho #' || v_despacho.numero,
            v_usuario_fk,
            v_despacho.cuenta_id
          );
        END IF;

        v_credito := ROUND((abs(v_balance_neto) - v_abono)::NUMERIC, 4);
        IF v_credito > 0 THEN
          INSERT INTO public.cuentas_por_cobrar (
            cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
            forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
          ) VALUES (
            v_cliente.id,
            p_despacho_id,
            'credito',
            v_credito,
            GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
            'Devolución',
            'Despacho #' || v_despacho.numero,
            'Saldo a favor por excedente en intercambio — Despacho #' || v_despacho.numero,
            v_usuario_fk,
            v_despacho.cuenta_id
          );
        END IF;
      END IF;
    END IF;
  ELSE
    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);
  END IF;

  -- Escalado MULTI-FILA (restaurado desde 257): con el split de sábados un
  -- despacho puede tener varias filas de comisión (dueño del cliente +
  -- designado del día); todas deben escalar por el mismo factor. La versión
  -- de 262 solo escalaba la primera fila y dejaba la otra sin ajustar.
  IF EXISTS (
    SELECT 1 FROM public.comisiones c
    WHERE c.despachoid = p_despacho_id
      AND (c.estado = 'pagada' OR COALESCE(c.montopagado, 0) > 0.01)
  ) THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta el pago antes de registrar la devolución';
  END IF;

  IF v_total_original > 0 THEN
    v_factor := v_total_nuevo / v_total_original;

    FOR v_comision IN
      SELECT * FROM public.comisiones c
      WHERE c.despachoid = p_despacho_id
      FOR UPDATE
    LOOP
      v_comision_nueva := ROUND((COALESCE(v_comision.totalcomision, 0) * v_factor)::NUMERIC, 2);
      v_liberada := ROUND((COALESCE(v_comision.comision_liberada, v_comision.totalcomision) * v_factor)::NUMERIC, 2);
      v_liberada := LEAST(v_comision_nueva, GREATEST(0, v_liberada));
      v_retenida := ROUND((v_comision_nueva - v_liberada)::NUMERIC, 2);

      UPDATE public.comisiones
      SET totalcomision = v_comision_nueva,
          comisioncabilla = ROUND((COALESCE(comisioncabilla, 0) * v_factor)::NUMERIC, 2),
          comisionotros = ROUND((COALESCE(comisionotros, 0) * v_factor)::NUMERIC, 2),
          comision_liberada = v_liberada,
          comision_retenida = v_retenida,
          estado = CASE WHEN v_retenida > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END,
          actualizadoen = now()
      WHERE id = v_comision.id;
      v_comision_ajustada := TRUE;
    END LOOP;
  END IF;

  -- REEMBOLSO ATÓMICO (idéntico al principal).
  IF v_destino = 'reembolso' AND v_tiene_cliente
     AND v_pagos_reembolso IS NOT NULL AND v_pagos_reembolso <> 'null'::JSONB
     AND jsonb_typeof(v_pagos_reembolso) = 'array'
     AND jsonb_array_length(v_pagos_reembolso) > 0 THEN

    IF jsonb_array_length(v_pagos_reembolso) > 12 THEN
      RAISE EXCEPTION 'REEMBOLSO_DEMASIADOS_PAGOS';
    END IF;

    FOR v_pago IN
      SELECT * FROM jsonb_to_recordset(v_pagos_reembolso) AS x(
        metodo TEXT, monto NUMERIC, referencia TEXT
      )
    LOOP
      IF v_pago.metodo IS NULL OR btrim(v_pago.metodo) = ''
         OR v_pago.metodo NOT IN ('Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT') THEN
        RAISE EXCEPTION 'REEMBOLSO_METODO_INVALIDO';
      END IF;
      IF v_pago.monto IS NULL OR v_pago.monto <= 0 THEN
        RAISE EXCEPTION 'REEMBOLSO_MONTO_INVALIDO';
      END IF;
      IF v_pago.metodo IN ('Transf. / Pago Móvil', 'Zelle', 'USDT')
         AND (v_pago.referencia IS NULL OR btrim(v_pago.referencia) = '') THEN
        RAISE EXCEPTION 'REEMBOLSO_REFERENCIA_OBLIGATORIA';
      END IF;
    END LOOP;

    SELECT COALESCE(SUM(x.monto), 0) INTO v_reembolso_total
    FROM jsonb_to_recordset(v_pagos_reembolso) AS x(monto NUMERIC);
    v_reembolso_total := ROUND(v_reembolso_total::NUMERIC, 4);
    IF v_reembolso_total > abs(v_balance_neto) + 0.01 THEN
      RAISE EXCEPTION 'REEMBOLSO_SUPERA_SALDO_A_FAVOR';
    END IF;

    FOR v_pago IN
      SELECT * FROM jsonb_to_recordset(v_pagos_reembolso) AS x(
        metodo TEXT, monto NUMERIC, referencia TEXT
      )
    LOOP
      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id, p_despacho_id, 'devolucion_credito', ROUND(v_pago.monto::NUMERIC, 4),
        0,
        v_pago.metodo,
        COALESCE(NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''), 'Despacho #' || v_despacho.numero),
        'Reembolso por devolución entregado al cliente — Despacho #' || v_despacho.numero || ' (' || v_pago.metodo || ')',
        v_usuario_fk, v_despacho.cuenta_id
      );
      v_metodos_resumen := concat_ws(' | ', v_metodos_resumen,
        v_pago.metodo || ': $' || to_char(ROUND(v_pago.monto::NUMERIC, 2), 'FM999999990.00'));
      v_refs_resumen := concat_ws(' | ', v_refs_resumen,
        NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''));
    END LOOP;

    UPDATE public.despacho_devoluciones
    SET destino_saldo = 'reembolso',
        reembolso_metodo = COALESCE(NULLIF(v_metodos_resumen, ''), 'Efectivo $'),
        reembolso_referencia = NULLIF(v_refs_resumen, ''),
        reembolso_monto = v_reembolso_total
    WHERE despacho_id = p_despacho_id;
  END IF;

  -- Triggers de CxC mantienen saldos; se recalculan explícitamente igual que 226.
  IF v_tiene_cliente THEN
    SELECT COALESCE(SUM(CASE
      WHEN c.tipo = 'cargo' THEN c.monto_usd
      WHEN c.tipo = 'abono' THEN -c.monto_usd
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN c.tipo = 'credito' THEN c.monto_usd
      WHEN c.tipo = 'abono' AND c.forma_pago_abono = 'Saldo a favor' THEN -c.monto_usd
      WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
      ELSE 0
    END), 0)
    INTO v_saldo_pendiente, v_saldo_favor
    FROM public.cuentas_por_cobrar c
    WHERE c.cliente_id = v_cliente.id;

    UPDATE public.clientes
    SET saldo_pendiente = GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
        saldo_a_favor = GREATEST(0, ROUND(v_saldo_favor::NUMERIC, 4))
    WHERE id = v_cliente.id;
  END IF;

  RETURN jsonb_build_object(
    'balance_neto_usd', v_balance_neto,
    'cargo_monto', v_cargo,
    'abono_monto', v_abono,
    'credito_monto', v_credito,
    'destino_saldo', v_destino,
    'reembolso_total', v_reembolso_total,
    'comision_ajustada', v_comision_ajustada
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Grants (patrón 257/260) + recarga de esquema
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.calcularcomisiondespacho_238b(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.recalcularcomisiondespacho_238b(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalcularcomisiondespacho_238b(uuid) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comision_designacion_diaria TO service_role;
GRANT SELECT ON public.comision_designacion_diaria TO authenticated, anon;
REVOKE ALL ON FUNCTION public.validar_designacion_diaria() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
