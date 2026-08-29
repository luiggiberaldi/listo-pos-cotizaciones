-- 086: Comisión al dueño del cliente, no al creador de la cotización
-- Lógica: el cliente siempre tiene un vendedor_id (su dueño).
-- La comisión debe ir a ese vendedor, independientemente de quién haya
-- creado la cotización o el despacho.

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
  v_item_total      NUMERIC(12,4);
  v_vendedor_id     UUID;   -- dueño del cliente
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despacho_id = p_despacho_id) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho + vendedor_id del CLIENTE (dueño real)
  SELECT
    nd.*,
    cl.vendedor_id AS cliente_vendedor_id
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c  ON c.id  = nd.cotizacion_id
  JOIN public.clientes     cl ON cl.id = c.cliente_id
  WHERE nd.id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- El vendedor que recibe la comisión es el dueño del cliente
  v_vendedor_id := v_despacho.cliente_vendedor_id;

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

  -- Recorrer items de la cotización, restando descuentos del despacho si existen
  FOR v_item IN
    SELECT ci.id AS item_id, ci.total_linea_usd, p.categoria,
           COALESCE(dd.monto_usd, 0) AS descuento_usd
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    LEFT JOIN public.despacho_descuentos dd
      ON dd.despacho_id = p_despacho_id AND dd.cotizacion_item_id = ci.id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id
  LOOP
    -- Monto neto del ítem después de descuento
    v_item_total := GREATEST(COALESCE(v_item.total_linea_usd, 0) - v_item.descuento_usd, 0);
    v_matched := false;

    -- Check primary special category first
    IF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
      v_monto_cabilla := v_monto_cabilla + v_item_total;
      v_matched := true;
    END IF;

    -- Check extra categories
    IF NOT v_matched THEN
      FOR i IN 0..jsonb_array_length(v_extras) - 1 LOOP
        v_extra_cat := lower(trim(v_extras->i->>'cat'));
        IF lower(trim(COALESCE(v_item.categoria, ''))) = v_extra_cat THEN
          v_extra_monto := COALESCE((v_extras_montos->i->>'monto')::numeric, 0) + v_item_total;
          v_extra_pct := (v_extras->i->>'pct')::numeric;
          v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'monto'], to_jsonb(v_extra_monto));
          v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'comision'], to_jsonb(ROUND(v_extra_monto * v_extra_pct / 100, 2)));
          v_matched := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- If no category matched, it goes to "otros"
    IF NOT v_matched THEN
      v_monto_otros := v_monto_otros + v_item_total;
    END IF;
  END LOOP;

  -- Calculate total extras commission
  FOR i IN 0..jsonb_array_length(v_extras_montos) - 1 LOOP
    v_total_extras := v_total_extras + COALESCE((v_extras_montos->i->>'comision')::numeric, 0);
  END LOOP;

  -- Insertar comisión → vendedor_id es el DUEÑO DEL CLIENTE
  INSERT INTO public.comisiones (
    despacho_id, vendedor_id, cotizacion_id,
    monto_cabilla, monto_otros,
    pct_cabilla, pct_otros,
    comision_cabilla, comision_otros, total_comision,
    detalle_extras
  ) VALUES (
    p_despacho_id,
    v_vendedor_id,                                          -- ← dueño del cliente
    v_despacho.cotizacion_id,
    v_monto_cabilla,
    v_monto_otros,
    v_config.comision_pct_cabilla,
    v_config.comision_pct_otros,
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2),
    ROUND(v_monto_otros   * v_config.comision_pct_otros   / 100, 2),
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2)
      + ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2)
      + v_total_extras,
    v_extras_montos
  )
  RETURNING id INTO v_comision_id;

  RETURN v_comision_id;
END;
$$;
