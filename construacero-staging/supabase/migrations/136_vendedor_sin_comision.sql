-- 136_vendedor_sin_comision.sql
-- Excluir la generación de comisiones para usuarios con el rol 'vendedor_sin_comision' y limpiar los registros existentes.

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
  v_cat_cabilla TEXT;
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT;
  v_comisionid UUID;
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despachoid = p_despachoid) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho + vendedor del cliente (dueño) y su rol
  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         cl.vendedor_id AS vendedor_dueno_cliente_id,
         u.rol AS vendedor_rol
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = cl.vendedor_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- Si el vendedor está configurado como 'vendedor_sin_comision', abortar la generación
  IF v_despacho.vendedor_rol = 'vendedor_sin_comision' THEN
    RETURN NULL;
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RETURN NULL;
  END IF;

  IF v_despacho.cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_ID_REQUERIDO';
  END IF;

  SELECT
    COALESCE(cn.comision_pct_cabilla, 0) AS comision_pct_cabilla,
    COALESCE(cn.comision_pct_otros, 0) AS comision_pct_otros,
    COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla') AS comision_categoria_cabilla
  INTO v_pct_cabilla, v_pct_otros, v_cat_cabilla
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
     OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_cat_cabilla := 'Cabilla';
  END IF;

  v_cat_cabilla := lower(trim(v_cat_cabilla));

  SELECT EXISTS (
    SELECT 1
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    SELECT
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN ndi.total_linea_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE 
        WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN 0 
        WHEN ndi.origen = 'externo' AND lower(ndi.nombre_snap) LIKE '%corte%' THEN 0
        ELSE ndi.total_linea_usd 
      END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN ci.total_linea_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE 
        WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN 0 
        WHEN ci.origen = 'externo' AND lower(ci.nombre_snap) LIKE '%corte%' THEN 0
        ELSE ci.total_linea_usd 
      END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id;
  END IF;

  v_comision_cabilla := ROUND((v_monto_cabilla * v_pct_cabilla / 100)::numeric, 2);
  v_comision_otros := ROUND((v_monto_otros * v_pct_otros / 100)::numeric, 2);
  v_total_comision := v_comision_cabilla + v_comision_otros;

  IF EXISTS (
    SELECT 1
    FROM public.cuentas_por_cobrar cxc
    WHERE cxc.despacho_id = p_despachoid
      AND cxc.tipo = 'cargo'
      AND COALESCE(cxc.saldo_usd, 0) > 0
  ) THEN
    v_estado := 'cta_cobrar';
  ELSE
    v_estado := 'pendiente';
  END IF;

  INSERT INTO public.comisiones (
    despachoid,
    vendedorid,
    cotizacionid,
    cuentaid,
    totalcomision,
    comisioncabilla,
    comisionotros,
    pctcabilla,
    pctotros,
    estado
  ) VALUES (
    p_despachoid,
    v_despacho.vendedor_dueno_cliente_id,
    v_despacho.cotizacion_id,
    v_despacho.cuenta_id,
    v_total_comision,
    v_comision_cabilla,
    v_comision_otros,
    v_pct_cabilla,
    v_pct_otros,
    v_estado
  )
  RETURNING id INTO v_comisionid;

  RETURN v_comisionid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;

-- 2. Limpiar las comisiones existentes generadas accidentalmente para vendedores sin comisión.
DELETE FROM public.comisiones
WHERE vendedorid IN (
  SELECT id FROM public.usuarios WHERE rol = 'vendedor_sin_comision'
);
