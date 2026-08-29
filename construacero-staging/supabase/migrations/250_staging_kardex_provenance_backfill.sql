-- 250_staging_kardex_provenance_backfill.sql
--
-- Completes the traceability portion of the staging fix. This migration never
-- changes stock_anterior, stock_nuevo, cantidad, tipo or business timestamps.
-- Legacy rows receive an explicit synthetic identity derived from lote_id and
-- are marked through origen_referencia=legacy_lote:*; this is lineage metadata,
-- not a claim that the original client sent an idempotency key.
--
-- Staging only. Do not apply to the principal project without a promotion
-- review, backup and a separately approved historical metadata backfill.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kardex_provenance_backfills_staging (
  batch_key     UUID NOT NULL,
  cuenta_id     UUID NOT NULL,
  rows_updated  INTEGER NOT NULL DEFAULT 0,
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_key, cuenta_id)
);

CREATE OR REPLACE FUNCTION public.enriquecer_proveniencia_kardex_staging()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero TEXT;
  v_lote   TEXT;
BEGIN
  IF NEW.cuenta_id IS NULL AND NEW.producto_id IS NOT NULL THEN
    SELECT p.cuenta_id
      INTO NEW.cuenta_id
    FROM public.productos p
    WHERE p.id = NEW.producto_id;
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
    NEW.idempotency_key := COALESCE(NEW.lote_id, NEW.id);
  END IF;

  IF NEW.origen_referencia IS NULL THEN
    v_numero := substring(COALESCE(NEW.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)');
    IF v_numero IS NOT NULL THEN
      NEW.origen_referencia := 'despacho_numero:' || v_numero;
    ELSE
      v_lote := COALESCE(NEW.lote_id, NEW.id)::TEXT;
      IF v_lote IS NOT NULL THEN
        NEW.origen_referencia := 'lote:' || v_lote;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_proveniencia_kardex_staging
  ON public.inventario_movimientos;
CREATE TRIGGER trg_enriquecer_proveniencia_kardex_staging
  BEFORE INSERT ON public.inventario_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.enriquecer_proveniencia_kardex_staging();

CREATE OR REPLACE FUNCTION public.backfill_kardex_provenance_staging(
  p_cuenta_id UUID,
  p_batch_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_updated  INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_BACKFILL_PROVENANCE_INVALIDOS';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.kardex_provenance_backfills_staging
  WHERE cuenta_id = p_cuenta_id
    AND batch_key = p_batch_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'idempotent', TRUE,
      'batch_key', p_batch_key,
      'cuenta_id', p_cuenta_id,
      'rows_updated', v_existing.rows_updated
    );
  END IF;

  UPDATE public.inventario_movimientos m
  SET origen_tipo = COALESCE(m.origen_tipo, CASE COALESCE(m.motivo_tipo::TEXT, 'otro')
        WHEN 'venta' THEN 'despacho'
        WHEN 'devolucion' THEN 'devolucion'
        WHEN 'ajuste_inventario' THEN 'ajuste_inventario'
        WHEN 'compra_proveedor' THEN 'compra'
        WHEN 'transferencia' THEN 'transferencia'
        ELSE 'otro'
      END),
      origen_id = COALESCE(m.origen_id, COALESCE(m.lote_id, m.id)),
      origen_referencia = COALESCE(
        m.origen_referencia,
        CASE
          WHEN substring(COALESCE(m.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)') IS NOT NULL
            THEN 'despacho_numero:' || substring(COALESCE(m.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)')
          ELSE 'legacy_lote:' || COALESCE(m.lote_id, m.id)::TEXT
        END
      ),
      idempotency_key = COALESCE(m.idempotency_key, COALESCE(m.lote_id, m.id))
  WHERE m.cuenta_id = p_cuenta_id
    AND (
      m.origen_tipo IS NULL
      OR m.origen_id IS NULL
      OR m.origen_referencia IS NULL
      OR m.idempotency_key IS NULL
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.kardex_provenance_backfills_staging
    (batch_key, cuenta_id, rows_updated)
  VALUES
    (p_batch_key, p_cuenta_id, v_updated);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'idempotent', FALSE,
    'batch_key', p_batch_key,
    'cuenta_id', p_cuenta_id,
    'rows_updated', v_updated,
    'stock_values_changed', FALSE,
    'original_movements_rewritten', FALSE
  );
END;
$$;

REVOKE ALL ON TABLE public.kardex_provenance_backfills_staging FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.backfill_kardex_provenance_staging(UUID, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_kardex_provenance_staging(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
