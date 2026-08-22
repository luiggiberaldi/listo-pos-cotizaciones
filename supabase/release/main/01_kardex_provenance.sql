-- 01_kardex_provenance.sql
-- REVIEW ONLY — proyecto principal.
-- Baseline verificado el 2026-08-21: PostgreSQL 17.6; historial formal remoto
-- con una sola fila (001); las columnas de provenance aún no existen.
-- No ejecutar hasta aprobar el historial de migraciones, backup y contratos RPC.

BEGIN;

-- SAFETY GATE: este archivo es un artefacto de revisión. Elimina este bloque
-- únicamente después de aprobar backup, historial, contrato y plan de rollback.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 01_kardex_provenance.sql no debe ejecutarse todavía';
END
$$;

-- Contrato observado en el principal el 2026-08-21. Este bloque solo lee el
-- catálogo del sistema y falla de forma explícita si el restore no coincide.
DO $$
BEGIN
  IF to_regclass('public.productos') IS NULL
     OR to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.configuracion_negocio') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas base de inventario ausentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'productos'
      AND column_name = 'cuenta_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventario_movimientos'
      AND column_name = 'cuenta_id'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: cuenta_id no existe en productos/movimientos';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'tipo_movimiento'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'motivo_movimiento'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: enums del Kardex ausentes';
  END IF;
END
$$;

ALTER TABLE public.inventario_movimientos
  ADD COLUMN IF NOT EXISTS origen_tipo TEXT,
  ADD COLUMN IF NOT EXISTS origen_id UUID,
  ADD COLUMN IF NOT EXISTS origen_referencia TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_origen
  ON public.inventario_movimientos (cuenta_id, origen_tipo, origen_id);

CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_idempotency
  ON public.inventario_movimientos (cuenta_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventario_operaciones (
  idempotency_key UUID NOT NULL,
  cuenta_id       UUID NOT NULL,
  operacion_tipo  TEXT NOT NULL,
  resultado       JSONB,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.kardex_reconciliaciones (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key                UUID NOT NULL,
  ancla_key                TEXT NOT NULL,
  cuenta_id                UUID NOT NULL,
  producto_id              UUID NOT NULL,
  movimiento_ancla_id     UUID,
  movimiento_correctivo_id UUID,
  clase                    TEXT NOT NULL CHECK (clase IN ('continuity_gap', 'stock_actual_vs_kardex')),
  delta                    NUMERIC(12,4) NOT NULL,
  stock_anterior           NUMERIC(12,4) NOT NULL,
  stock_nuevo              NUMERIC(12,4) NOT NULL,
  -- Snapshot del catálogo al aplicar la propuesta. El rollback no puede
  -- modificar stock si el catálogo cambió después del batch.
  stock_catalogo_snapshot          NUMERIC(12,4) NOT NULL,
  producto_actualizado_en_snapshot TIMESTAMPTZ NOT NULL,
  motivo                   TEXT NOT NULL,
  aplicado_por             UUID,
  aplicado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado                   TEXT NOT NULL DEFAULT 'aplicado' CHECK (estado IN ('aplicado', 'revertido')),
  revertido_en             TIMESTAMPTZ,
  revertido_por            UUID,
  UNIQUE (batch_key, ancla_key)
);

CREATE INDEX IF NOT EXISTS idx_kardex_reconciliaciones_producto
  ON public.kardex_reconciliaciones (cuenta_id, producto_id, aplicado_en DESC);

CREATE TABLE IF NOT EXISTS public.kardex_provenance_backfills (
  batch_key     UUID NOT NULL,
  cuenta_id     UUID NOT NULL,
  rows_updated  INTEGER NOT NULL DEFAULT 0,
  ejecutado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_key, cuenta_id)
);

ALTER TABLE public.inventario_operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kardex_reconciliaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kardex_provenance_backfills ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventario_operaciones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kardex_reconciliaciones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kardex_provenance_backfills FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enriquecer_proveniencia_kardex()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero TEXT;
  v_cuenta UUID;
BEGIN
  -- No reemplaza el trigger histórico de cuenta; solo completa si viene vacío.
  -- Si el caller trae un tenant distinto al del producto, se rechaza para no
  -- introducir provenance cross-tenant. Los movimientos sin producto siguen
  -- siendo permitidos para conservar el historial legacy.
  IF NEW.producto_id IS NOT NULL THEN
    SELECT p.cuenta_id INTO v_cuenta
    FROM public.productos p
    WHERE p.id = NEW.producto_id;
    IF v_cuenta IS NOT NULL AND NEW.cuenta_id IS NULL THEN
      NEW.cuenta_id := v_cuenta;
    ELSIF v_cuenta IS NOT NULL AND NEW.cuenta_id IS DISTINCT FROM v_cuenta THEN
      RAISE EXCEPTION 'PRODUCTO_PROVENIENCIA_FUERA_DE_TENANT';
    END IF;
  END IF;

  IF NEW.origen_tipo IS NULL THEN
    NEW.origen_tipo := CASE COALESCE(NEW.motivo_tipo::TEXT, 'otro')
      WHEN 'venta' THEN 'despacho'
      WHEN 'devolucion' THEN 'devolucion'
      WHEN 'ajuste_inventario' THEN 'ajuste_inventario'
      WHEN 'compra_proveedor' THEN 'compra'
      WHEN 'transferencia' THEN 'transferencia'
      ELSE 'otro'
    END;
  END IF;

  IF NEW.origen_id IS NULL THEN
    NEW.origen_id := COALESCE(NEW.lote_id, NEW.id);
  END IF;

  IF NEW.idempotency_key IS NULL THEN
    -- Identidad sintética mínima para operaciones históricas sin clave de cliente.
    NEW.idempotency_key := COALESCE(NEW.lote_id, NEW.id);
  END IF;

  IF NEW.origen_referencia IS NULL THEN
    v_numero := substring(COALESCE(NEW.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)');
    IF v_numero IS NOT NULL THEN
      NEW.origen_referencia := 'despacho_numero:' || v_numero;
    ELSE
      NEW.origen_referencia := 'lote:' || COALESCE(NEW.lote_id, NEW.id)::TEXT;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_proveniencia_kardex
  ON public.inventario_movimientos;

CREATE TRIGGER trg_enriquecer_proveniencia_kardex
  BEFORE INSERT ON public.inventario_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.enriquecer_proveniencia_kardex();

-- Los wrappers SECURITY DEFINER de 02–05 reservan la clave dentro de la misma
-- transacción. Una operación incompleta no queda registrada si la transacción falla.
CREATE OR REPLACE FUNCTION public.reservar_operacion_inventario(
  p_cuenta_id       UUID,
  p_idempotency_key UUID,
  p_operacion_tipo  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resultado JSONB;
  v_tipo TEXT;
BEGIN
  IF p_cuenta_id IS NULL OR p_operacion_tipo IS NULL OR btrim(p_operacion_tipo) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_OPERACION_INVALIDOS';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  SELECT resultado, operacion_tipo
  INTO v_resultado, v_tipo
  FROM public.inventario_operaciones
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_tipo <> p_operacion_tipo THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUTILIZADA';
    END IF;
    RETURN jsonb_build_object('existente', TRUE, 'resultado', v_resultado);
  END IF;

  INSERT INTO public.inventario_operaciones (idempotency_key, cuenta_id, operacion_tipo)
  VALUES (p_idempotency_key, p_cuenta_id, p_operacion_tipo);

  RETURN jsonb_build_object('existente', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_operacion_inventario(
  p_cuenta_id       UUID,
  p_idempotency_key UUID,
  p_resultado       JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_idempotency_key IS NULL THEN RETURN; END IF;
  UPDATE public.inventario_operaciones
  SET resultado = p_resultado, actualizado_en = now()
  WHERE cuenta_id = p_cuenta_id AND idempotency_key = p_idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.etiquetar_lote_inventario(
  p_cuenta_id       UUID,
  p_lote_id         UUID,
  p_idempotency_key UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cuenta_id IS NULL OR p_lote_id IS NULL OR p_idempotency_key IS NULL THEN RETURN; END IF;
  UPDATE public.inventario_movimientos
  SET idempotency_key = p_idempotency_key
  WHERE cuenta_id = p_cuenta_id
    AND lote_id = p_lote_id
    AND (idempotency_key IS NULL OR idempotency_key = lote_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_operacion_inventario(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guardar_operacion_inventario(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.etiquetar_lote_inventario(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_operacion_inventario(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.guardar_operacion_inventario(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.etiquetar_lote_inventario(UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
