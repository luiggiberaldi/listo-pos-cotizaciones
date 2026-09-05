-- 06_reversion_con_devoluciones.sql
-- Release principal — Plan A+B "reversión consciente de devoluciones" (2026-09-05).
--
-- Problema que corrige:
--   Un despacho entregado y luego devuelto al 100% (o parcialmente) registra en
--   CxC abonos con forma_pago_abono = 'Devolución' — ajustes contables del
--   propio despacho, no cobros reales — y la guarda de reversión
--   (migración 232, replicada en el Worker) los trataba igual que un pago en
--   efectivo: bloqueaba la reapertura con "Anule los cobros primero", un
--   callejón sin salida que obligaba a anular abonos a mano.
--
-- Qué hace (reemplazo IN-PLACE, misma identidad de 5 argumentos — lección
-- 42725: sin sobrecargas):
--   * Guarda relajada: solo bloquean los cobros REALES (abonos cuya forma de
--     pago no es 'Devolución' ni 'Saldo a favor'; NULL cuenta como real).
--   * Nuevo bloqueo REEMBOLSO_EFECTIVO_REGISTRADO: si el despacho tiene filas
--     'devolucion_credito' (efectivo ya pagado al cliente), la reversión se
--     bloquea — revertir devolvería además el efectivo cobrado (doble beneficio).
--   * Nuevo bloqueo CREDITO_YA_CONSUMIDO (antes solo en el Worker, ahora
--     atómico): si el saldo a favor generado por créditos de este despacho ya
--     fue consumido, se bloquea.
--   * La eliminación de CxC y comisiones no pagadas sigue igual; los triggers
--     trg_recalcular_saldo_pendiente[_delete] (179) recalculan
--     saldo_pendiente/saldo_a_favor del cliente con cada DELETE dentro de esta
--     misma transacción.
--   * Respuesta enriquecida: abonos_devolucion_anulados y credito_anulado_usd.
--
-- Rollback: 06_reversion_con_devoluciones_rollback.sql

BEGIN;

-- Precondición: la firma actual de 5 argumentos debe existir (migración 232).
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
  v_abonos_dev  INTEGER := 0;
  v_creditos    NUMERIC(12,2) := 0;
  v_cliente_id  UUID;
  v_saldo_favor NUMERIC(12,2);
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

  -- Guarda (06, relajada): un abono REAL no se puede borrar silenciosamente.
  -- Los abonos 'Devolución' y 'Saldo a favor' son ajustes contables del propio
  -- despacho y se anulan abajo dentro de esta transacción. Un abono sin forma
  -- de pago (NULL) se trata como real por conservadurismo.
  -- El Worker mantiene la misma guarda antes de llamar a esta RPC.
  IF EXISTS (
    SELECT 1
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id
      AND tipo = 'abono'
      AND (
        forma_pago_abono IS NULL
        OR (
          forma_pago_abono IS DISTINCT FROM 'Saldo a favor'
          AND forma_pago_abono IS DISTINCT FROM 'Devolución'
        )
      )
  ) THEN
    RAISE EXCEPTION 'CXC_CON_ABONOS: anule primero los cobros registrados';
  END IF;

  -- Guarda (06, nueva): reembolso en efectivo ya entregado al cliente. La
  -- reversión reactivaría la deuda Y dejaría el efectivo pagado: doble
  -- beneficio. Requiere anular el egreso primero.
  IF EXISTS (
    SELECT 1
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id
      AND tipo = 'devolucion_credito'
  ) THEN
    RAISE EXCEPTION 'REEMBOLSO_EFECTIVO_REGISTRADO: ya se pagó efectivo al cliente por devoluciones de este despacho; anule el egreso primero';
  END IF;

  -- Guarda (06, nueva): el saldo a favor generado por créditos de este
  -- despacho no debe haber sido consumido en otras compras (antes solo el
  -- Worker lo validaba con REST; ahora es atómico).
  SELECT COALESCE(SUM(monto_usd), 0)
  INTO v_creditos
  FROM public.cuentas_por_cobrar
  WHERE despacho_id = p_despacho_id
    AND tipo = 'credito';

  IF v_creditos > 0 THEN
    v_cliente_id := COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);
    SELECT COALESCE(saldo_a_favor, 0)
    INTO v_saldo_favor
    FROM public.clientes
    WHERE id = v_cliente_id;
    IF COALESCE(v_saldo_favor, 0) < (v_creditos - 0.01) THEN
      RAISE EXCEPTION 'CREDITO_YA_CONSUMIDO: el cliente ya consumió parte del saldo a favor ($%, disponible $%) generado por este despacho', to_char(v_creditos, 'FM999990.00'), to_char(COALESCE(v_saldo_favor, 0), 'FM999990.00');
    END IF;
  END IF;

  -- Una comisión pagada tampoco puede desaparecer por una reversión.
  SELECT *
  INTO v_comision
  FROM public.comisiones
  WHERE despachoid = p_despacho_id
  FOR UPDATE;

  IF FOUND AND (v_comision.estado = 'pagada' OR COALESCE(v_comision.montopagado, 0) > 0.01) THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta primero el pago de comisión';
  END IF;

  -- La 224 restaura el stock neto de devoluciones/intercambios y actualiza el
  -- estado. Todas las operaciones siguientes forman parte de esta transacción.
  v_inventario := public.revertir_entrega_inventario_atomica(
    p_despacho_id,
    p_nuevo_estado,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color
  );

  -- Contador de ajustes de devolución que se anularán (para auditoría/UX).
  SELECT COUNT(*)
  INTO v_abonos_dev
  FROM public.cuentas_por_cobrar
  WHERE despacho_id = p_despacho_id
    AND tipo = 'abono'
    AND forma_pago_abono = 'Devolución';

  DELETE FROM public.cuentas_por_cobrar
  WHERE despacho_id = p_despacho_id;
  GET DIAGNOSTICS v_cxc_count = ROW_COUNT;

  DELETE FROM public.comisiones
  WHERE despachoid = p_despacho_id;
  GET DIAGNOSTICS v_com_count = ROW_COUNT;

  -- Los triggers trg_recalcular_saldo_pendiente[_delete] (179) recalculan
  -- saldo_pendiente y saldo_a_favor del cliente con cada DELETE: los saldos
  -- quedan exactamente como antes de la(s) devolución(es).

  RETURN v_inventario || jsonb_build_object(
    'finanzas_revertidas', TRUE,
    'cxc_movimientos_eliminados', v_cxc_count,
    'comisiones_eliminadas', v_com_count,
    'abonos_devolucion_anulados', v_abonos_dev,
    'credito_anulado_usd', v_creditos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revertir_entrega_finanzas_atomica(UUID, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_finanzas_atomica(UUID, TEXT, UUID, TEXT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
