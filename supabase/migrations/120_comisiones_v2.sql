-- 120_comisiones_v2.sql
-- Comisiones 2.0: calculo simple por despacho entregado.

-- ============================================================
-- 1. Eliminar sistema viejo
-- ============================================================

DROP FUNCTION IF EXISTS public.calcularcomisiondespacho(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.calcular_comision_despacho(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.tgactualizarcomisionporabono() CASCADE;
DROP FUNCTION IF EXISTS public.tg_actualizar_comision_por_abono() CASCADE;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND (
        lower(t.tgname) LIKE '%comision%'
        OR lower(pg_get_triggerdef(t.oid)) LIKE '%comision%'
      )
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      r.trigger_name,
      r.schema_name,
      r.table_name
    );
  END LOOP;
END;
$$;

DROP TABLE IF EXISTS public.comisiones CASCADE;

-- ============================================================
-- 2. Nueva tabla comisiones
-- ============================================================

CREATE TABLE public.comisiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despachoid UUID NOT NULL REFERENCES public.notas_despacho(id),
  vendedorid UUID NOT NULL REFERENCES public.usuarios(id),
  cotizacionid UUID NOT NULL REFERENCES public.cotizaciones(id),
  cuentaid UUID NOT NULL,
  totalcomision NUMERIC(12,2) NOT NULL DEFAULT 0,
  comisioncabilla NUMERIC(12,2) NOT NULL DEFAULT 0,
  comisionotros NUMERIC(12,2) NOT NULL DEFAULT 0,
  pctcabilla NUMERIC(5,2) NOT NULL DEFAULT 0,
  pctotros NUMERIC(5,2) NOT NULL DEFAULT 0,
  montopagado NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','cta_cobrar','pagada')),
  pagadaen TIMESTAMPTZ,
  pagadapor UUID,
  creadoen TIMESTAMPTZ DEFAULT now(),
  actualizadoen TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_comisiones_despachoid ON public.comisiones(despachoid);
CREATE INDEX idx_comisiones_vendedorid ON public.comisiones(vendedorid);
CREATE INDEX idx_comisiones_cuentaid ON public.comisiones(cuentaid);
CREATE INDEX idx_comisiones_estado ON public.comisiones(estado);

COMMENT ON TABLE public.comisiones IS 'Comisiones 2.0: calculadas solo al entregar un despacho.';

-- ============================================================
-- 3. RLS basico
-- ============================================================

ALTER TABLE public.comisiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY comisiones_vendedor_select ON public.comisiones
  FOR SELECT
  USING (vendedorid = auth.uid());

CREATE POLICY comisiones_admin_select ON public.comisiones
  FOR SELECT
  USING (public.get_rol_actual() IN ('supervisor', 'admin', 'administracion', 'desarrollador', 'jefe'));

GRANT SELECT ON public.comisiones TO authenticated;

-- No se crean politicas INSERT/UPDATE/DELETE: solo funciones SECURITY DEFINER modifican la tabla.

-- ============================================================
-- 4. Funcion de calculo
-- ============================================================

CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_comisionid UUID;
  v_despacho RECORD;
  v_cat_cabilla TEXT;
  v_pct_cabilla NUMERIC(5,2) := 0;
  v_pct_otros NUMERIC(5,2) := 0;
  v_monto_cabilla NUMERIC(12,4) := 0;
  v_monto_otros NUMERIC(12,4) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT := 'pendiente';
  v_tiene_items_despacho BOOLEAN := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.comisiones c
    WHERE c.despachoid = p_despachoid
  ) THEN
    RETURN NULL;
  END IF;

  SELECT
    nd.id,
    nd.cotizacion_id,
    nd.vendedor_id,
    nd.cuenta_id,
    nd.estado,
    nd.cliente_id
  INTO v_despacho
  FROM public.notas_despacho nd
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
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
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN 0 ELSE ndi.total_linea_usd END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN ci.total_linea_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN lower(trim(COALESCE(p.categoria, ''))) = v_cat_cabilla THEN 0 ELSE ci.total_linea_usd END), 0)
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
    v_despacho.vendedor_id,
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

CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(p_despacho_id UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT public.calcularcomisiondespacho(p_despacho_id);
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calcular_comision_despacho(UUID) TO authenticated, service_role;
