-- 206_transportistas_locales.sql
-- Transportistas locales: cobran % o tarifa fija del flete.
-- El neto se acumula como saldo a liquidar (pagos_transportistas).
-- La configuración del cálculo (% o tarifa) es GLOBAL en configuracion_negocio,
-- no por transportista. En la ficha del chofer solo se marca es_local.

-- ── 1) Extender transportistas (solo es_local) ──────────────────────────────
ALTER TABLE public.transportistas
  ADD COLUMN IF NOT EXISTS es_local BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.transportistas.es_local
  IS 'true = transportista local que recibe comisión/pago del flete; false = propio del negocio. El tipo de cálculo y el valor están en configuracion_negocio.';

-- ── 2) Configuración global del cálculo del neto (singleton) ────────────────
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS transp_tipo_calculo TEXT NOT NULL DEFAULT 'porcentaje'
    CHECK (transp_tipo_calculo IN ('porcentaje', 'fija')),
  ADD COLUMN IF NOT EXISTS transp_pct_comision NUMERIC(5,2) NOT NULL DEFAULT 20
    CHECK (transp_pct_comision >= 0 AND transp_pct_comision <= 100),
  ADD COLUMN IF NOT EXISTS transp_tarifa_fija_usd NUMERIC(12,4) NOT NULL DEFAULT 50
    CHECK (transp_tarifa_fija_usd >= 0);

COMMENT ON COLUMN public.configuracion_negocio.transp_tipo_calculo
  IS 'Cómo se calcula el neto de TODOS los transportistas locales: porcentaje = neto = flete * transp_pct_comision/100; fija = neto = MIN(transp_tarifa_fija_usd, flete).';
COMMENT ON COLUMN public.configuracion_negocio.transp_pct_comision
  IS 'Porcentaje global del flete que recibe cada chofer local. Solo aplica cuando transp_tipo_calculo = porcentaje.';
COMMENT ON COLUMN public.configuracion_negocio.transp_tarifa_fija_usd
  IS 'Tarifa fija global a pagar al chofer por despacho. Solo aplica cuando transp_tipo_calculo = fija. Se acota al flete cobrado (MIN).';

-- ── 3) Extender notas_despacho con snapshot del neto ────────────────────────
ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS flete_neto_transportista_usd NUMERIC(12,4) NOT NULL DEFAULT 0
    CHECK (flete_neto_transportista_usd >= 0),
  ADD COLUMN IF NOT EXISTS flete_pct_aplicado NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS flete_pagado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flete_pagado_en TIMESTAMPTZ;

COMMENT ON COLUMN public.notas_despacho.flete_neto_transportista_usd
  IS 'Snapshot del monto a pagar al transportista local. Se calcula al crear/editar el despacho usando la config global de ese momento.';
COMMENT ON COLUMN public.notas_despacho.flete_pagado
  IS 'true cuando el neto ya fue liquidado al chofer. Editable solo vía /api/transportistas/pagar.';

-- ── 4) Tabla de pagos a transportistas (append-only) ────────────────────────
CREATE TABLE IF NOT EXISTS public.pagos_transportistas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transportista_id UUID NOT NULL REFERENCES public.transportistas(id) ON DELETE RESTRICT,
  monto_usd        NUMERIC(12,4) NOT NULL CHECK (monto_usd >= 0),
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  referencia       TEXT,
  nota             TEXT,
  cuenta_id        UUID,
  creado_por       UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagos_transportistas_transp
  ON public.pagos_transportistas(transportista_id, fecha DESC);

ALTER TABLE public.pagos_transportistas ENABLE ROW LEVEL SECURITY;

-- SELECT: administración, desarrollador, logística (no supervisor ni jefe ni vendedores)
CREATE POLICY pagos_transportistas_admin_select ON public.pagos_transportistas
  FOR SELECT
  USING (public.get_rol_actual() IN ('administracion', 'desarrollador', 'logistica'));

-- INSERT: solo administración, desarrollador (el handler del Worker usa service_role que bypassa RLS)
CREATE POLICY pagos_transportistas_admin_insert ON public.pagos_transportistas
  FOR INSERT
  WITH CHECK (public.get_rol_actual() IN ('administracion', 'desarrollador'));

-- No UPDATE ni DELETE → DENY por default (append-only como auditoria)

-- ── 5) Realtime ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transportistas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transportistas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pagos_transportistas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pagos_transportistas;
  END IF;
END $$;

-- ── 6) Función y trigger: solo admin/desarrollador pueden marcar flete_pagado ─
-- Defensa en profundidad: si alguien lograra ejecutar UPDATE directo en
-- notas_despacho (vía SQL Editor o servicio no autorizado), el trigger bloquea.
CREATE OR REPLACE FUNCTION public.validar_cambio_flete_pagado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  -- Solo actuar cuando cambia flete_pagado
  IF NEW.flete_pagado = OLD.flete_pagado THEN
    RETURN NEW;
  END IF;

  -- El service_role (postgres) puede cambiarlo libremente (Worker lo usa).
  -- Para usuarios normales, validar rol.
  v_rol := public.get_rol_actual();
  -- Cuando se ejecuta con service_role, get_rol_actual() retorna NULL
  -- (no hay auth.uid()) → permitimos.
  IF v_rol IS NULL THEN
    IF NEW.flete_pagado = true AND OLD.flete_pagado = false THEN
      NEW.flete_pagado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Solo administración y desarrollador pueden marcar como pagado desde el cliente.
  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: solo administración o desarrollador pueden liquidar fletes al transportista';
  END IF;

  IF NEW.flete_pagado = true AND OLD.flete_pagado = false THEN
    NEW.flete_pagado_en := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flete_pagado ON public.notas_despacho;
CREATE TRIGGER trg_flete_pagado
  BEFORE UPDATE OF flete_pagado ON public.notas_despacho
  FOR EACH ROW EXECUTE FUNCTION public.validar_cambio_flete_pagado();

-- ── 6.1) Evitar editar flete_neto_transportista_usd si ya está pagado ────
CREATE OR REPLACE FUNCTION public.bloquear_edicion_flete_pagado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  IF OLD.flete_pagado = true
     AND (NEW.flete_usd <> OLD.flete_usd
          OR NEW.flete_neto_transportista_usd <> OLD.flete_neto_transportista_usd
          OR NEW.transportista_id IS DISTINCT FROM OLD.transportista_id)
  THEN
    v_rol := public.get_rol_actual();
    -- service_role o rol nulo: permitir (vía Worker, ya validado en el handler).
    IF v_rol IS NOT NULL THEN
      RAISE EXCEPTION 'FLETE_YA_PAGADO: el despacho ya fue liquidado al chofer. Revierte el pago antes de editar el flete.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_flete_pagado ON public.notas_despacho;
CREATE TRIGGER trg_bloquear_flete_pagado
  BEFORE UPDATE OF flete_usd, flete_neto_transportista_usd, transportista_id
  ON public.notas_despacho
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_edicion_flete_pagado();
