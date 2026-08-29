-- 238a_contract_neutral_review.sql
-- REVIEW ONLY - contrato estructural para 238b.
--
-- Este archivo prepara únicamente la estructura que el paquete 238b necesita:
--   * columnas de evidencia en public.comisiones;
--   * tablas de batch y snapshot;
--   * indice unico por public.comisiones.despachoid.
--
-- Politica explicita:
--   * no agrega pagadapor;
--   * no cambia estados ni constraints de comisiones;
--   * no recalcula ni actualiza filas historicas;
--   * no revoca/granta permisos;
--   * no instala funciones RPC de negocio.
--
-- El runner autorizado debe retirar REVIEW_ONLY solo en memoria, despues de
-- backup, baseline y validacion del contrato. El marcador de instalacion se
-- conserva para que un rollback posterior pueda demostrar que objetos creo.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 238a_contract_neutral_review.sql no debe ejecutarse directamente';
END
$$;

-- La extension se requiere para el UUID default de los snapshots. No se instala
-- automaticamente porque incluso CREATE EXTENSION debe aprobarse por separado.
DO $$
BEGIN
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: gen_random_uuid() no esta disponible';
  END IF;
  IF to_regclass('public.comisiones') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: public.comisiones no existe';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.comisiones
    WHERE despachoid IS NULL
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: existen comisiones sin despachoid';
  END IF;
  IF EXISTS (
    SELECT despachoid
    FROM public.comisiones
    GROUP BY despachoid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: existen comisiones duplicadas por despachoid';
  END IF;
END
$$;

-- El marcador es el unico objeto que esta fase conserva incluso despues de un
-- rollback, porque funciona como evidencia de ownership y de estado.
CREATE TABLE IF NOT EXISTS public.comision_238a_installation_marker (
  contract_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('installed', 'rolled_back')),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMPTZ,
  created_columns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_tables TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_indexes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes TEXT
);

INSERT INTO public.comision_238a_installation_marker (
  contract_key, status, notes
) VALUES (
  '238a', 'installed',
  'Contrato neutral: evidencia, batches, snapshots e indice unico. Sin pagadapor ni cambios historicos.'
)
ON CONFLICT (contract_key) DO UPDATE
SET status = 'installed',
    rolled_back_at = NULL,
    created_columns = CASE
      WHEN public.comision_238a_installation_marker.status = 'rolled_back'
        THEN ARRAY[]::TEXT[]
      ELSE public.comision_238a_installation_marker.created_columns
    END,
    created_tables = CASE
      WHEN public.comision_238a_installation_marker.status = 'rolled_back'
        THEN ARRAY[]::TEXT[]
      ELSE public.comision_238a_installation_marker.created_tables
    END,
    created_indexes = CASE
      WHEN public.comision_238a_installation_marker.status = 'rolled_back'
        THEN ARRAY[]::TEXT[]
      ELSE public.comision_238a_installation_marker.created_indexes
    END;

-- ---------------------------------------------------------------------------
-- 1. Columnas de evidencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_column RECORD;
  v_exists BOOLEAN;
  v_udt TEXT;
BEGIN
  FOR v_column IN
    SELECT * FROM (VALUES
      ('detalle_extras', 'JSONB', 'jsonb'),
      ('comision_liberada', 'NUMERIC(12,2)', 'numeric'),
      ('comision_retenida', 'NUMERIC(12,2)', 'numeric'),
      ('comision_cxc_excluida', 'NUMERIC(12,2)', 'numeric'),
      ('comision_pago_excluida', 'NUMERIC(12,2)', 'numeric'),
      ('comision_otras_exclusiones', 'NUMERIC(12,2)', 'numeric'),
      ('fraccion_no_cxc', 'NUMERIC(12,8)', 'numeric'),
      ('calculo_version', 'TEXT', 'text'),
      ('politica_comision', 'TEXT', 'text'),
      ('fuente_calculo', 'TEXT', 'text'),
      ('calculo_evidencia', 'JSONB', 'jsonb')
    ) AS columns(column_name, ddl_type, expected_udt)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'comisiones'
        AND column_name = v_column.column_name
    ),
    (
      SELECT c.udt_name FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'comisiones'
        AND c.column_name = v_column.column_name
    )
    INTO v_exists, v_udt;

    IF v_exists THEN
      IF v_udt IS DISTINCT FROM v_column.expected_udt THEN
        RAISE EXCEPTION 'CONTRATO_INCOMPATIBLE: comisiones.% esperaba % y encontro %',
          v_column.column_name, v_column.expected_udt, v_udt;
      END IF;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.comisiones ADD COLUMN %I %s',
        v_column.column_name, v_column.ddl_type
      );
      UPDATE public.comision_238a_installation_marker
      SET created_columns = array_append(created_columns, v_column.column_name)
      WHERE contract_key = '238a';
    END IF;
  END LOOP;
END
$$;

COMMENT ON COLUMN public.comisiones.calculo_evidencia IS
  'Evidencia del split de pago, exclusiones, tasas y bases usadas en totalcomision.';
COMMENT ON COLUMN public.comisiones.comision_cxc_excluida IS
  'Comision no generada por la porcion CxC; la CxC manual no entra en totalcomision.';
COMMENT ON COLUMN public.comisiones.fraccion_no_cxc IS
  'Porcion del despacho pagada con metodos distintos de CxC.';

-- ---------------------------------------------------------------------------
-- 2. Batch y snapshot de reconciliacion
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_batches_exists BOOLEAN;
  v_rows_exists BOOLEAN;
BEGIN
  v_batches_exists := to_regclass('public.comision_238b_batches') IS NOT NULL;
  v_rows_exists := to_regclass('public.comision_238b_batch_rows') IS NOT NULL;

  IF v_batches_exists AND v_rows_exists THEN
    RETURN;
  END IF;

  IF v_batches_exists OR v_rows_exists THEN
    RAISE EXCEPTION 'CONTRATO_INCOMPLETO: solo una tabla 238b existe; revisar manualmente';
  END IF;

  CREATE TABLE public.comision_238b_batches (
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
    approved_at TIMESTAMPTZ,
    approved_by UUID,
    apply_key UUID,
    applied_at TIMESTAMPTZ,
    applied_by UUID,
    rollback_key UUID,
    rollback_at TIMESTAMPTZ,
    rollback_by UUID,
    notes TEXT
  );

  CREATE TABLE public.comision_238b_batch_rows (
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

  UPDATE public.comision_238a_installation_marker
  SET created_tables = ARRAY['comision_238b_batches', 'comision_238b_batch_rows']::TEXT[]
  WHERE contract_key = '238a';
END
$$;

DO $$
DECLARE
  v_index_name CONSTANT TEXT := 'idx_comision_238b_batch_rows_batch';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = v_index_name
  ) THEN
    CREATE INDEX idx_comision_238b_batch_rows_batch
      ON public.comision_238b_batch_rows(batch_key, estado);
    UPDATE public.comision_238a_installation_marker
    SET created_indexes = array_append(created_indexes, v_index_name)
    WHERE contract_key = '238a';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Unicidad por despacho
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_index_name CONSTANT TEXT := 'ux_comisiones_despachoid_238a';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'comisiones'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%despachoid%'
  ) THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX %I ON public.comisiones (despachoid)',
    v_index_name
  );

  UPDATE public.comision_238a_installation_marker
  SET created_indexes = array_append(created_indexes, v_index_name)
  WHERE contract_key = '238a';
END
$$;

-- No se agregan grants, funciones, triggers, constraints de estado ni NOTIFY.
COMMIT;
