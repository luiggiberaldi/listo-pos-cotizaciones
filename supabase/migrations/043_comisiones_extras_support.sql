-- 043_comisiones_extras_support.sql
-- Add detalle_extras JSONB column to comisiones table
-- and update calcular_comision_despacho() to use _comision_extras config

-- 1. Add detalle_extras column to store per-extra-category breakdown
ALTER TABLE public.comisiones
  ADD COLUMN IF NOT EXISTS detalle_extras JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.comisiones.detalle_extras
  IS 'Desglose de comisiones por categorías extras: [{"cat":"Cemento","pct":5,"monto":1000,"comision":50}, ...]';

-- 2. Fix any string-encoded _comision_extras values to proper JSONB arrays
UPDATE public.configuracion_negocio
  SET _comision_extras = CASE
    WHEN jsonb_typeof(_comision_extras) = 'string'
    THEN (_comision_extras #>> '{}'::text[])::jsonb
    ELSE _comision_extras
  END
WHERE id = 1;

-- 3. Replace calcular_comision_despacho() to support N categories
CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(
  p_despacho_id UUID
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho        RECORD;
  v_config          RECORD;
  v_monto_cabilla   NUMERIC(12,2) := 0;
  v_monto_otros     NUMERIC(12,2) := 0;
  v_item            RECORD;
  v_cat_cabilla     TEXT;
  v_comision_id     UUID;
  v_extras          JSONB;
  v_raw_extras      JSONB;
  v_extras_montos   JSONB := '[]'::jsonb;
  v_extra_cat       TEXT;
  v_extra_pct       NUMERIC(5,2);
  v_extra_monto     NUMERIC(12,2);
  v_matched         BOOLEAN;
  v_total_extras    NUMERIC(12,2) := 0;
  i                 INT;
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despacho_id = p_despacho_id) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho
  SELECT nd.*, c.vendedor_id AS cot_vendedor_id
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  WHERE nd.id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- Obtener configuración de tasas (incluyendo extras)
  SELECT comision_pct_cabilla, comision_pct_otros, comision_categoria_cabilla,
         COALESCE(_comision_extras, '[]'::jsonb) AS _comision_extras
  INTO v_config
  FROM public.configuracion_negocio
  WHERE id = 1;

  v_cat_cabilla := lower(trim(v_config.comision_categoria_cabilla));

  -- Handle both string-encoded and native JSONB arrays
  v_raw_extras := v_config._comision_extras;
  IF jsonb_typeof(v_raw_extras) = 'string' THEN
    v_extras := (v_raw_extras #>> '{}')::jsonb;
  ELSE
    v_extras := v_raw_extras;
  END IF;
  IF jsonb_typeof(v_extras) != 'array' THEN
    v_extras := '[]'::jsonb;
  END IF;

  -- Initialize extras accumulator array with zero montos
  FOR i IN 0..jsonb_array_length(v_extras) - 1 LOOP
    v_extras_montos := v_extras_montos || jsonb_build_object(
      'cat', v_extras->i->>'cat',
      'pct', (v_extras->i->>'pct')::numeric,
      'monto', 0,
      'comision', 0
    );
  END LOOP;

  -- Recorrer items de la cotización y clasificar por categoría
  FOR v_item IN
    SELECT ci.total_linea_usd, p.categoria
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id
  LOOP
    v_matched := false;

    -- Check primary special category first
    IF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
      v_monto_cabilla := v_monto_cabilla + COALESCE(v_item.total_linea_usd, 0);
      v_matched := true;
    END IF;

    -- Check extra categories
    IF NOT v_matched THEN
      FOR i IN 0..jsonb_array_length(v_extras) - 1 LOOP
        v_extra_cat := lower(trim(v_extras->i->>'cat'));
        IF lower(trim(COALESCE(v_item.categoria, ''))) = v_extra_cat THEN
          -- Accumulate monto for this extra category
          v_extra_monto := COALESCE((v_extras_montos->i->>'monto')::numeric, 0) + COALESCE(v_item.total_linea_usd, 0);
          v_extra_pct := (v_extras->i->>'pct')::numeric;
          v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'monto'], to_jsonb(v_extra_monto));
          v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'comision'], to_jsonb(ROUND(v_extra_monto * v_extra_pct / 100, 2)));
          v_matched := true;
          EXIT; -- Only match first matching extra category
        END IF;
      END LOOP;
    END IF;

    -- If no category matched, it goes to "otros"
    IF NOT v_matched THEN
      v_monto_otros := v_monto_otros + COALESCE(v_item.total_linea_usd, 0);
    END IF;
  END LOOP;

  -- Calculate total extras commission
  FOR i IN 0..jsonb_array_length(v_extras_montos) - 1 LOOP
    v_total_extras := v_total_extras + COALESCE((v_extras_montos->i->>'comision')::numeric, 0);
  END LOOP;

  -- Insertar comisión
  INSERT INTO public.comisiones (
    despacho_id, vendedor_id, cotizacion_id,
    monto_cabilla, monto_otros,
    pct_cabilla, pct_otros,
    comision_cabilla, comision_otros, total_comision,
    detalle_extras
  ) VALUES (
    p_despacho_id,
    v_despacho.cot_vendedor_id,
    v_despacho.cotizacion_id,
    v_monto_cabilla,
    v_monto_otros,
    v_config.comision_pct_cabilla,
    v_config.comision_pct_otros,
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2),
    ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2),
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2)
      + ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2)
      + v_total_extras,
    v_extras_montos
  )
  RETURNING id INTO v_comision_id;

  RETURN v_comision_id;
END;
$$;
