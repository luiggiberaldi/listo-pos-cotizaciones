-- 118_rpc_registrar_pago_comision.sql

CREATE OR REPLACE FUNCTION public.registrar_pago_comision(
  p_comision_id UUID,
  p_cuenta_id UUID,
  p_operador_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_comision RECORD;
  v_saldo_por_pagar NUMERIC;
  v_nuevo_estado TEXT;
  v_res JSONB;
BEGIN
  -- 1. Bloquear la fila para evitar concurrencia (FOR UPDATE)
  SELECT * INTO v_comision 
  FROM public.comisiones 
  WHERE id = p_comision_id 
    AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  -- 2. Validaciones Críticas
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comisión no encontrada';
  END IF;

  IF v_comision.estado = 'pagada' THEN
    RAISE EXCEPTION 'Esta comisión ya fue marcada como pagada';
  END IF;

  -- Cálculo de saldo (Liberado - Ya Pagado)
  v_saldo_por_pagar := GREATEST(0, v_comision.comision_liberada - COALESCE(v_comision.comision_pagada_monto, 0));

  IF v_saldo_por_pagar <= 0 AND v_comision.comision_retenida > 0 THEN
    RAISE EXCEPTION 'No hay montos liberados disponibles para pago en esta comisión';
  END IF;

  -- 3. Determinar Estado Final
  -- Si después de este pago aún hay algo retenido, es pago_parcial. Si no, es pagada.
  v_nuevo_estado := CASE 
    WHEN v_comision.comision_retenida > 0 THEN 'pago_parcial' 
    ELSE 'pagada' 
  END;

  -- 4. Ejecutar Actualización Atómica
  UPDATE public.comisiones
  SET 
    estado = v_nuevo_estado,
    comision_pagada_monto = v_comision.comision_liberada, -- Se paga todo lo liberado hasta ahora
    pagada_en = NOW(),
    pagada_por = p_operador_id,
    actualizado_en = NOW()
  WHERE id = p_comision_id;

  -- 5. Construir Respuesta para Auditoría
  v_res := jsonb_build_object(
    'ok', true,
    'monto_pagado', v_saldo_por_pagar,
    'estado_anterior', v_comision.estado,
    'estado_nuevo', v_nuevo_estado,
    'total_comision', v_comision.total_comision,
    'despacho_id', v_comision.despacho_id,
    'vendedor_id', v_comision.vendedor_id
  );

  RETURN v_res;
END;
$$;
