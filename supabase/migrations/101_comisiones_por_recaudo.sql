-- 101_comisiones_por_recaudo.sql
-- Migración para prorratero lineal de comisiones basado en recaudo

-- 1. Modificar tabla de comisiones
ALTER TABLE public.comisiones
  ADD COLUMN IF NOT EXISTS comision_liberada NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_retenida NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. Eliminar el constraint de estado viejo para poder modificar los datos
ALTER TABLE public.comisiones DROP CONSTRAINT IF EXISTS comisiones_estado_check;

-- 3. Actualizar histórico: asume que todo lo viejo ya estaba liberado o pagado para no romper contabilidad.
UPDATE public.comisiones
SET 
  comision_liberada = total_comision,
  comision_retenida = 0,
  estado = CASE 
             WHEN trim(estado) = 'pagada' THEN 'pagada'
             WHEN trim(estado) = 'pago_parcial' THEN 'pago_parcial'
             WHEN trim(estado) = 'retenida' THEN 'retenida'
             ELSE 'liberada'
           END;

-- 4. Modificar constraint de estado (aplicar el nuevo)
ALTER TABLE public.comisiones ADD CONSTRAINT comisiones_estado_check 
  CHECK (estado IN ('retenida', 'pago_parcial', 'liberada', 'pagada'));

-- 4. Modificar calcular_comision_despacho (basado en la versión 043)
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
  
  -- Nuevas variables para recaudo
  v_total_comision  NUMERIC(12,2) := 0;
  v_estado_inicial  TEXT := 'retenida';
  v_comision_lib    NUMERIC(12,2) := 0;
  v_comision_ret    NUMERIC(12,2) := 0;
  v_porcentaje_abn  NUMERIC := 0;
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

  -- Calcular prorrateo inicial basado en abonos existentes o forma de pago
  DECLARE
    v_total_abonos NUMERIC(12,2) := 0;
    v_total_despacho NUMERIC(12,2) := COALESCE(v_despacho.total_usd, 0);
    v_es_credito BOOLEAN := FALSE;
  BEGIN
    -- Revisar si en los métodos de pago se indicó Crédito
    IF COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Credito%' OR 
       COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Credito%' THEN
      v_es_credito := TRUE;
    END IF;

    IF v_es_credito THEN
      SELECT COALESCE(SUM(monto_usd), 0) INTO v_total_abonos
      FROM public.cuentas_por_cobrar
      WHERE despacho_id = p_despacho_id AND tipo = 'abono';

      IF v_total_despacho > 0 THEN
        v_porcentaje_abn := v_total_abonos / v_total_despacho;
      ELSE
        v_porcentaje_abn := 1;
      END IF;
    ELSE
      -- Si es venta de contado (Efectivo, Zelle, etc), no se retiene nada
      v_porcentaje_abn := 1;
    END IF;
    
    IF v_porcentaje_abn > 1 THEN
      v_porcentaje_abn := 1;
    END IF;
  END;

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

  -- Calcular total general de la comisión
  v_total_comision := ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2)
                    + ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2)
                    + v_total_extras;

  -- Determinar liberada vs retenida basado en el porcentaje pagado (abonos vs total)
  v_comision_lib := ROUND(v_total_comision * v_porcentaje_abn, 2);
  v_comision_ret := GREATEST(0, v_total_comision - v_comision_lib);

  IF v_porcentaje_abn >= 1 THEN
    v_estado_inicial := 'liberada';
  ELSIF v_porcentaje_abn > 0 THEN
    v_estado_inicial := 'pago_parcial';
  ELSE
    v_estado_inicial := 'retenida';
  END IF;

  -- Insertar comisión
  INSERT INTO public.comisiones (
    despacho_id, vendedor_id, cotizacion_id,
    monto_cabilla, monto_otros,
    pct_cabilla, pct_otros,
    comision_cabilla, comision_otros, total_comision,
    detalle_extras,
    comision_liberada, comision_retenida, estado
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
    v_total_comision,
    v_extras_montos,
    v_comision_lib,
    v_comision_ret,
    v_estado_inicial
  )
  RETURNING id INTO v_comision_id;

  RETURN v_comision_id;
END;
$$;


-- 5. Trigger y función para calcular la liberación de comisión en cada abono
CREATE OR REPLACE FUNCTION public.tg_actualizar_comision_por_abono()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho_total NUMERIC(12,4);
  v_com_total      NUMERIC(12,2);
  v_com_liberada   NUMERIC(12,2);
  v_porcentaje_abn NUMERIC;
  v_monto_a_liberar NUMERIC(12,2);
BEGIN
  -- Solo actuar si es un abono
  IF NEW.tipo = 'abono' THEN
    -- Identificar a qué despacho(s) afecta. 
    -- Si el pago especifica el despacho:
    IF NEW.despacho_id IS NOT NULL THEN
      
      -- 1. Obtener el total del despacho
      SELECT total_usd INTO v_despacho_total
      FROM public.notas_despacho
      WHERE id = NEW.despacho_id;
      
      -- Si existe el despacho y su total es mayor a 0
      IF FOUND AND v_despacho_total > 0 THEN
        
        -- 2. Obtener la comisión asociada a ese despacho
        SELECT total_comision, comision_liberada 
        INTO v_com_total, v_com_liberada
        FROM public.comisiones
        WHERE despacho_id = NEW.despacho_id;
        
        IF FOUND THEN
          -- 3. Calcular porcentaje y monto a liberar
          v_porcentaje_abn := NEW.monto_usd / v_despacho_total;
          v_monto_a_liberar := ROUND((v_com_total * v_porcentaje_abn)::numeric, 2);
          
          -- 4. Actualizar comisión
          UPDATE public.comisiones
          SET 
            comision_liberada = LEAST(v_com_total, comision_liberada + v_monto_a_liberar),
            comision_retenida = GREATEST(0, comision_retenida - v_monto_a_liberar),
            estado = CASE 
                       WHEN estado = 'pagada' THEN 'pagada' -- Si ya fue pagada al empleado no cambiar
                       WHEN (comision_liberada + v_monto_a_liberar) >= v_com_total THEN 'liberada'
                       ELSE 'pago_parcial'
                     END,
            actualizado_en = now()
          WHERE despacho_id = NEW.despacho_id;
        END IF;
      END IF;
      
    ELSE
      -- Si el abono no tiene despacho específico (es global al cliente),
      -- idealmente el sistema POS asigna los pagos a la factura más vieja internamente.
      -- Si llegamos aquí, requiere una distribución (FIFO), pero lo más común
      -- es que el frontend o backend asignen el despacho_id al insertar en cuentas_por_cobrar.
      -- Por ahora, si no hay despacho_id explícito, no prorrateamos comisiones automáticamente.
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_cxc_comisiones ON public.cuentas_por_cobrar;
CREATE TRIGGER trigger_cxc_comisiones
  AFTER INSERT ON public.cuentas_por_cobrar
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_actualizar_comision_por_abono();

-- 6. Actualizar RPC obtener_reporte_ventas_comisiones
DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(date, date, uuid);
DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.obtener_reporte_ventas_comisiones(
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin    TIMESTAMPTZ DEFAULT NULL,
  p_vendedor_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  despacho_id UUID,
  despacho_numero INTEGER,
  fecha TIMESTAMPTZ,
  asesor TEXT,
  asesor_color TEXT,
  cliente TEXT,
  codigo TEXT,
  descripcion TEXT,
  pza TEXT,
  precio NUMERIC(12,4),
  cantidad NUMERIC(12,2),
  total NUMERIC(12,4),
  comision_pct NUMERIC(5,2),
  total_com NUMERIC(12,2),
  tasa NUMERIC(12,4),
  pago TEXT,
  total_bs NUMERIC(12,4),
  estado TEXT,
  estado_comision TEXT,
  despacho_comision_liberada NUMERIC(12,2),
  despacho_comision_total NUMERIC(12,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rol TEXT;
  v_cat_cabilla TEXT;
BEGIN
  v_rol := public.get_rol_actual();
  
  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'Acceso denegado. Solo administración puede ver este reporte.';
  END IF;

  SELECT lower(trim(comision_categoria_cabilla)) INTO v_cat_cabilla
  FROM public.configuracion_negocio WHERE id = 1;

  RETURN QUERY
  WITH items_con_descuento AS (
    SELECT 
      ci.id AS item_id,
      ci.cotizacion_id,
      nd.id AS despacho_id,
      ci.codigo_snap,
      ci.nombre_snap,
      ci.unidad_snap,
      ci.precio_unit_usd,
      ci.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS total_linea_neto
    FROM public.notas_despacho nd
    JOIN public.cotizacion_items ci ON ci.cotizacion_id = nd.cotizacion_id
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    LEFT JOIN public.despacho_descuentos dd ON dd.despacho_id = nd.id AND dd.cotizacion_item_id = ci.id
    WHERE nd.estado IN ('despachada', 'entregada')
      AND (p_fecha_inicio IS NULL OR COALESCE(nd.entregada_en, nd.creado_en) >= p_fecha_inicio)
      AND (p_fecha_fin IS NULL OR COALESCE(nd.entregada_en, nd.creado_en) <= p_fecha_fin)
  ),
  config_tasas AS (
    SELECT 
      comision_pct_cabilla, 
      comision_pct_otros, 
      COALESCE(_comision_extras, '[]'::jsonb) AS _comision_extras
    FROM public.configuracion_negocio WHERE id = 1
  ),
  items_con_comision AS (
    SELECT 
      i.*,
      COALESCE(com.pct_cabilla, cfg.comision_pct_cabilla) AS pct_cabilla,
      COALESCE(com.pct_otros, cfg.comision_pct_otros) AS pct_otros,
      COALESCE(com.detalle_extras, cfg._comision_extras) AS detalle_extras,
      COALESCE(com.estado, 'retenida') AS estado_comision,
      COALESCE(cl.vendedor_id, nd.vendedor_id) AS dueño_cliente_id,
      COALESCE(com.comision_liberada, 0) AS despacho_comision_liberada,
      COALESCE(com.total_comision, 0) AS despacho_comision_total
    FROM items_con_descuento i
    JOIN public.notas_despacho nd ON nd.id = i.despacho_id
    JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
    JOIN public.clientes cl ON cl.id = c.cliente_id
    LEFT JOIN public.comisiones com ON com.despacho_id = i.despacho_id
    CROSS JOIN config_tasas cfg
    WHERE (p_vendedor_id IS NULL OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id)
  )
  SELECT 
    i.despacho_id,
    nd.numero AS despacho_numero,
    COALESCE(nd.entregada_en, nd.creado_en) AS fecha,
    COALESCE(u.nombre, 'Sin asesor') AS asesor,
    COALESCE(u.color, '#1B365D') AS asesor_color,
    cl.nombre AS cliente,
    i.codigo_snap AS codigo,
    i.nombre_snap AS descripcion,
    i.unidad_snap AS pza,
    i.precio_unit_usd AS precio,
    i.cantidad AS cantidad,
    i.total_linea_neto AS total,
    (CASE
      WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.pct_cabilla
      ELSE COALESCE(
        (SELECT (elem->>'pct')::numeric FROM jsonb_array_elements(i.detalle_extras) elem WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria)) LIMIT 1),
        i.pct_otros
      )
    END) AS comision_pct,
    ROUND(i.total_linea_neto * (
      CASE
        WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.pct_cabilla
        ELSE COALESCE(
          (SELECT (elem->>'pct')::numeric FROM jsonb_array_elements(i.detalle_extras) elem WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria)) LIMIT 1),
          i.pct_otros
        )
      END
    ) / 100, 2) AS total_com,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot) AS tasa,
    COALESCE(nd.forma_pago, 'Pendiente') AS pago,
    ROUND(i.total_linea_neto * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot), 2) AS total_bs,
    nd.estado AS estado,
    i.estado_comision,
    i.despacho_comision_liberada,
    i.despacho_comision_total
  FROM items_con_comision i
  JOIN public.notas_despacho nd ON nd.id = i.despacho_id
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = c.cliente_id
  LEFT JOIN public.usuarios u ON u.id = i.dueño_cliente_id
  ORDER BY COALESCE(nd.entregada_en, nd.creado_en) DESC, i.nombre_snap ASC;
END;
$$;
