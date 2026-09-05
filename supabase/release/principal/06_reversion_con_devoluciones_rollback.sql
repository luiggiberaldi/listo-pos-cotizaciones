-- 06_reversion_con_devoluciones_rollback.sql
-- Restaura la definición original de revertir_entrega_finanzas_atomica
-- (migración 232). Ejecutar solo si hay que revertir el release 06.
-- Las filas CxC eliminadas por reversiones ya ejecutadas bajo la versión
-- nueva son histórico válido y no se restauran aquí.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.revertir_entrega_finanzas_atomica(UUID,TEXT,UUID,TEXT,TEXT)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALLIDA: revertir_entrega_finanzas_atomica(UUID,TEXT,UUID,TEXT,TEXT) no existe';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.revertir_entrega_finanzas_atomica(
  p_despacho_id    UUID,
  p_nuevo_estado   TEXT,
  p_usuario_id     UUID,
  p_usuario_nombre TEXT,
  p_usuario_color  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho    RECORD;
  v_comision    RECORD;
  v_inventario  JSONB;
  v_cxc_count   INTEGER := 0;
  v_com_count   INTEGER := 0;
BEGIN
  IF p_despacho_id IS NULL
     OR p_nuevo_estado NOT IN ('pendiente', 'despachada', 'anulada')
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_FINANCIERA_INVALIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede revertir un despacho entregado';
  END IF;

  IF COALESCE(v_despacho.flete_pagado, FALSE) THEN
    RAISE EXCEPTION 'FLETE_YA_PAGADO: revierta primero la liquidación del transportista';
  END IF;

  -- Guarda original (232): cualquier abono distinto de 'Saldo a favor'
  -- bloquea la reversión.
  IF EXISTS (
    SELECT 1
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id
      AND tipo = 'abono'
      AND COALESCE(forma_pago_abono, '') <> 'Saldo a favor'
  ) THEN
    RAISE EXCEPTION 'CXC_CON_ABONOS: anule primero los cobros registrados';
  END IF;

  SELECT *
  INTO v_comision
  FROM public.comisiones
  WHERE despachoid = p_despacho_id
  FOR UPDATE;

  IF FOUND AND (v_comision.estado = 'pagada' OR COALESCE(v_comision.montopagado, 0) > 0.01) THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta primero el pago de comisión';
  END IF;

  v_inventario := public.revertir_entrega_inventario_atomica(
    p_despacho_id,
    p_nuevo_estado,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color
  );

  DELETE FROM public.cuentas_por_cobrar
  WHERE despacho_id = p_despacho_id;
  GET DIAGNOSTICS v_cxc_count = ROW_COUNT;

  DELETE FROM public.comisiones
  WHERE despachoid = p_despacho_id;
  GET DIAGNOSTICS v_com_count = ROW_COUNT;

  RETURN v_inventario || jsonb_build_object(
    'finanzas_revertidas', TRUE,
    'cxc_movimientos_eliminados', v_cxc_count,
    'comisiones_eliminadas', v_com_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revertir_entrega_finanzas_atomica(UUID, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_finanzas_atomica(UUID, TEXT, UUID, TEXT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
