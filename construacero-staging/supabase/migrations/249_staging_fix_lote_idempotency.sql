-- 249_staging_fix_lote_idempotency.sql
--
-- 248 asigna lote_id como provenance mínimo a todo movimiento histórico nuevo.
-- Este ajuste permite que los wrappers sustituyan ese valor por la clave de
-- idempotencia del request sin tocar una operación ya etiquetada.

BEGIN;

CREATE OR REPLACE FUNCTION public.staging_etiquetar_lote(
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
  IF p_lote_id IS NULL OR p_idempotency_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.inventario_movimientos
  SET idempotency_key = p_idempotency_key
  WHERE cuenta_id = p_cuenta_id
    AND lote_id = p_lote_id
    AND (idempotency_key IS NULL OR idempotency_key = p_lote_id);
END;
$$;

REVOKE ALL ON FUNCTION public.staging_etiquetar_lote(UUID, UUID, UUID)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.staging_etiquetar_lote(UUID, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
