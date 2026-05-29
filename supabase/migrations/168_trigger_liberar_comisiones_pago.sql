-- 168_trigger_liberar_comisiones_pago.sql
-- Liberación automática de comisiones retenidas ('cta_cobrar') al saldar la deuda CxC / COD.

-- 1. Trigger function to release commissions on accounts receivable payment changes
CREATE OR REPLACE FUNCTION public.trg_liberar_comision_por_pago()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho_id UUID;
  v_cliente_id UUID;
  v_balance NUMERIC(12,4);
  v_saldo_cliente NUMERIC(12,4);
BEGIN
  -- Obtener despacho_id y cliente_id según el tipo de operación
  IF TG_OP = 'DELETE' THEN
    v_despacho_id := OLD.despacho_id;
    v_cliente_id := OLD.cliente_id;
  ELSE
    v_despacho_id := NEW.despacho_id;
    v_cliente_id := NEW.cliente_id;
  END IF;

  -- CASO 1: El abono o movimiento está asociado a un despacho específico
  IF v_despacho_id IS NOT NULL THEN
    -- Calcular balance neto de ese despacho (cargos - abonos)
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END
    ), 0)
    INTO v_balance
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = v_despacho_id;

    IF v_balance <= 0.01 THEN
      -- Liberar la comisión: cta_cobrar -> pendiente
      UPDATE public.comisiones
      SET estado = 'pendiente', actualizadoen = now()
      WHERE despachoid = v_despacho_id
        AND estado = 'cta_cobrar';
    ELSE
      -- Volver a retener la comisión si la deuda vuelve a ser positiva (reversión de abono)
      UPDATE public.comisiones
      SET estado = 'cta_cobrar', actualizadoen = now()
      WHERE despachoid = v_despacho_id
        AND estado = 'pendiente';
    END IF;
  END IF;

  -- CASO 2: Manejo de abonos globales / saldo del cliente general
  IF v_cliente_id IS NOT NULL THEN
    -- Calcular balance global de cuentas por cobrar para el cliente
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END
    ), 0)
    INTO v_saldo_cliente
    FROM public.cuentas_por_cobrar
    WHERE cliente_id = v_cliente_id;

    -- Si el cliente saldó toda su deuda global, liberamos todas sus comisiones 'cta_cobrar'
    IF v_saldo_cliente <= 0.01 THEN
      UPDATE public.comisiones com
      SET estado = 'pendiente', actualizadoen = now()
      WHERE com.estado = 'cta_cobrar'
        AND EXISTS (
          SELECT 1 FROM public.notas_despacho nd
          WHERE nd.id = com.despachoid
            AND nd.cliente_id = v_cliente_id
        );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. Asociar la función trigger a la tabla cuentas_por_cobrar
DROP TRIGGER IF EXISTS trg_liberar_comision_pago ON public.cuentas_por_cobrar;
CREATE TRIGGER trg_liberar_comision_pago
  AFTER INSERT OR UPDATE ON public.cuentas_por_cobrar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_liberar_comision_por_pago();

DROP TRIGGER IF EXISTS trg_liberar_comision_pago_delete ON public.cuentas_por_cobrar;
CREATE TRIGGER trg_liberar_comision_pago_delete
  AFTER DELETE ON public.cuentas_por_cobrar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_liberar_comision_por_pago();

-- 3. Redefinir calcularcomisiondespacho para que use la sumatoria neta de cargos - abonos en vez del snapshot saldo_usd del cargo
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho RECORD;
  v_tiene_items_despacho BOOLEAN;
  v_pct_cabilla NUMERIC;
  v_pct_otros NUMERIC;
  v_pct_externos NUMERIC;
  v_extras_json JSONB;
  v_cat_cabilla TEXT;
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_monto_externos NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_comision_externos NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT;
  v_comisionid UUID;
BEGIN
  -- Si ya tiene registro de comisión calculado, omitir
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despachoid = p_despachoid) THEN
    RETURN NULL;
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         cl.vendedor_id AS vendedor_dueno_cliente_id,
         u.rol AS vendedor_rol,
         u.es_externo AS vendedor_es_externo
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = cl.vendedor_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.vendedor_dueno_cliente_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- NO generar comisión para roles administrativos, ni para vendedor_sin_comision a menos que sea externo
  IF v_despacho.vendedor_rol IN ('jefe', 'logistica', 'administracion', 'desarrollador') OR 
     (v_despacho.vendedor_rol = 'vendedor_sin_comision' AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE)) THEN 
    RETURN NULL; 
  END IF;

  -- Modificación: Permitir estado 'despachada' (aprobado por administración) o 'entregada' (logística)
  IF v_despacho.estado NOT IN ('despachada', 'entregada') THEN RETURN NULL; END IF;
  IF v_despacho.cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;

  -- Obtener configuración global (interna y externa)
  DECLARE
    v_cfg RECORD;
  BEGIN
    SELECT
      cn.comision_pct_cabilla,
      cn.comision_pct_otros,
      cn.comision_pct_externos,
      cn._comision_extras,
      cn.comision_ext_pct_cabilla,
      cn.comision_ext_pct_otros,
      cn.comision_ext_pct_externos,
      cn._comision_ext_extras,
      COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla') AS comision_categoria_cabilla
    INTO v_cfg
    FROM public.configuracion_negocio cn
    WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
    ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      -- Fallback hardcoded por si acaso
      v_pct_cabilla := 0;
      v_pct_otros := 0;
      v_pct_externos := 3;
      v_extras_json := '[]'::jsonb;
      v_cat_cabilla := 'cabilla';
    ELSE
      v_cat_cabilla := lower(trim(v_cfg.comision_categoria_cabilla));
      
      -- Asignar tasas según si el vendedor es externo o no
      IF COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
        v_pct_cabilla := COALESCE(v_cfg.comision_ext_pct_cabilla, 2.00);
        v_pct_otros   := COALESCE(v_cfg.comision_ext_pct_otros, 3.00);
        v_pct_externos := COALESCE(v_cfg.comision_ext_pct_externos, 3.00);
        v_extras_json := COALESCE(v_cfg._comision_ext_extras, '[]'::jsonb);
      ELSE
        v_pct_cabilla := COALESCE(v_cfg.comision_pct_cabilla, 2.00);
        v_pct_otros   := COALESCE(v_cfg.comision_pct_otros, 3.00);
        v_pct_externos := COALESCE(v_cfg.comision_pct_externos, 3.00);
        v_extras_json := COALESCE(v_cfg._comision_extras, '[]'::jsonb);
      END IF;
    END IF;
  END;

  -- Si es vendedor_sin_comision, forzar tasas a 0%
  IF v_despacho.vendedor_rol = 'vendedor_sin_comision' THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_pct_externos := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items ndi WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    SELECT
      COALESCE(SUM(CASE
        WHEN ndi.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, comparte tasa de cabilla
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ndi.nombre_snap)) LIKE '%cemento%') THEN ndi.total_linea_usd
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ndi.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, ya entra en cabilla, aquí da 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ndi.nombre_snap)) LIKE '%cemento%') THEN 0
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        ELSE ndi.total_linea_usd
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN ndi.total_linea_usd
        ELSE 0
      END), 0)
    INTO v_monto_cabilla, v_monto_otros, v_monto_externos
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE
        WHEN ci.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, comparte tasa de cabilla
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ci.nombre_snap)) LIKE '%cemento%') THEN ci.total_linea_usd
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ci.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, ya entra en cabilla, aquí da 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ci.nombre_snap)) LIKE '%cemento%') THEN 0
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        ELSE ci.total_linea_usd
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN ci.total_linea_usd
        ELSE 0
      END), 0)
    INTO v_monto_cabilla, v_monto_otros, v_monto_externos
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id;
  END IF;

  v_comision_cabilla := ROUND((v_monto_cabilla * v_pct_cabilla / 100)::numeric, 2);
  v_comision_externos := ROUND((v_monto_externos * v_pct_externos / 100)::numeric, 2);
  v_comision_otros   := ROUND((v_monto_otros   * v_pct_otros   / 100)::numeric, 2) + v_comision_externos;
  v_total_comision   := v_comision_cabilla + v_comision_otros;

  -- Modificado para usar sumatoria neta en lugar del snapshot saldo_usd del cargo
  IF (
    SELECT COALESCE(SUM(
      CASE WHEN cxc.tipo = 'cargo' THEN cxc.monto_usd ELSE -cxc.monto_usd END
    ), 0)
    FROM public.cuentas_por_cobrar cxc
    WHERE cxc.despacho_id = p_despachoid
  ) > 0.01 THEN
    v_estado := 'cta_cobrar';
  ELSE
    v_estado := 'pendiente';
  END IF;

  INSERT INTO public.comisiones (
    despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros, estado
  ) VALUES (
    p_despachoid, v_despacho.vendedor_dueno_cliente_id, v_despacho.cotizacion_id, v_despacho.cuenta_id,
    v_total_comision, v_comision_cabilla, v_comision_otros, v_pct_cabilla, v_pct_otros, v_estado
  ) RETURNING id INTO v_comisionid;

  RETURN v_comisionid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;

-- 4. Backfill: Actualizar comisiones existentes que ya están saldadas a 'pendiente'
UPDATE public.comisiones com
SET estado = 'pendiente', actualizadoen = now()
WHERE com.estado = 'cta_cobrar'
  AND (
    SELECT COALESCE(SUM(
      CASE WHEN cxc.tipo = 'cargo' THEN cxc.monto_usd ELSE -cxc.monto_usd END
    ), 0)
    FROM public.cuentas_por_cobrar cxc
    WHERE cxc.despacho_id = com.despachoid
  ) <= 0.01;
