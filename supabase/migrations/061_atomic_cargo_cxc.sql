-- ═══════════════════════════════════════════════════════════════════════════
-- 061: RPC atómico para cargo CxC (saldo + transacción en 1 operación)
-- Resuelve race condition: saldo se leía y actualizaba en requests separados
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_cargo_cxc(
  p_cliente_id      UUID,
  p_despacho_id     UUID,
  p_monto_usd       NUMERIC(12,2),
  p_descripcion     TEXT,
  p_registrado_por  UUID
)
RETURNS NUMERIC(12,2)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_actual   NUMERIC(12,2);
  v_saldo_nuevo    NUMERIC(12,2);
BEGIN
  -- 1. Bloquear y leer saldo actual del cliente
  SELECT saldo_pendiente INTO v_saldo_actual
  FROM public.clientes
  WHERE id = p_cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO';
  END IF;

  v_saldo_nuevo := COALESCE(v_saldo_actual, 0) + p_monto_usd;

  -- 2. Insertar transacción CxC
  INSERT INTO public.cuentas_por_cobrar (
    cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
    descripcion, registrado_por
  ) VALUES (
    p_cliente_id, p_despacho_id, 'cargo', p_monto_usd, v_saldo_nuevo,
    p_descripcion, p_registrado_por
  );

  -- 3. Actualizar saldo del cliente
  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_nuevo
  WHERE id = p_cliente_id;

  RETURN v_saldo_nuevo;
END;
$$;
