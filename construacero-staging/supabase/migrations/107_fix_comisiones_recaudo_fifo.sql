-- Migración 107: Lógica FIFO para distribución de abonos globales en comisiones
-- Esta migración actualiza el trigger de cuentas_por_cobrar para que los abonos
-- globales (sin despacho_id) se distribuyan de forma FIFO a las comisiones pendientes.
-- También procesa los abonos globales existentes para corregir los estados actuales.

-- 1. Reemplazar el trigger para distribuir abonos globales
CREATE OR REPLACE FUNCTION public.tg_actualizar_comision_por_abono()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho_total NUMERIC(12,4);
  v_com_total      NUMERIC(12,2);
  v_com_liberada   NUMERIC(12,2);
  v_porcentaje_abn NUMERIC;
  v_monto_a_liberar NUMERIC(12,2);
  r RECORD;
  v_monto_restante NUMERIC;
  v_deuda_despacho NUMERIC;
  v_monto_aplicado NUMERIC;
BEGIN
  -- Solo actuar si es un abono
  IF NEW.tipo = 'abono' THEN
    -- Identificar a qué despacho(s) afecta. 
    IF NEW.despacho_id IS NOT NULL THEN
      
      -- 1. Obtener el total del despacho específico
      SELECT total_usd INTO v_despacho_total
      FROM public.notas_despacho
      WHERE id = NEW.despacho_id;
      
      -- Si existe el despacho y su total es mayor a 0
      IF FOUND AND v_despacho_total > 0 THEN
        
        -- 2. Obtener la comisión asociada a ese despacho
        SELECT total_comision, comision_liberada 
        INTO v_com_total, v_com_liberada
        FROM public.comisiones
        WHERE despacho_id = NEW.despacho_id;
        
        IF FOUND THEN
          -- 3. Calcular porcentaje y monto a liberar
          v_porcentaje_abn := NEW.monto_usd / v_despacho_total;
          v_monto_a_liberar := ROUND((v_com_total * v_porcentaje_abn)::numeric, 2);
          
          -- 4. Actualizar comisión
          UPDATE public.comisiones
          SET 
            comision_liberada = LEAST(v_com_total, comision_liberada + v_monto_a_liberar),
            comision_retenida = GREATEST(0, comision_retenida - v_monto_a_liberar),
            estado = CASE 
                       WHEN estado = 'pagada' THEN 'pagada' -- Si ya fue pagada al empleado no cambiar
                       WHEN (comision_liberada + v_monto_a_liberar) >= v_com_total THEN 'liberada'
                       ELSE 'pago_parcial'
                     END,
            actualizado_en = now()
          WHERE despacho_id = NEW.despacho_id;
        END IF;
      END IF;
      
    ELSE
      -- Lógica FIFO para abonos globales (sin despacho_id explícito)
      v_monto_restante := NEW.monto_usd;
      
      -- Recorrer despachos con comisiones retenidas o parciales, del más antiguo al más reciente
      FOR r IN 
        SELECT nd.id AS despacho_id, nd.total_usd, c.total_comision, c.comision_liberada, c.comision_retenida
        FROM public.notas_despacho nd
        JOIN public.comisiones c ON c.despacho_id = nd.id
        WHERE nd.cliente_id = NEW.cliente_id
          AND c.estado IN ('retenida', 'pago_parcial')
        ORDER BY nd.creado_en ASC
      LOOP
        EXIT WHEN v_monto_restante <= 0;
        
        -- Calcular la deuda restante del despacho en base a la porción de comisión retenida
        -- Si la comisión retenida es el X% de la comisión total, entonces la deuda es el X% del total_usd.
        IF r.total_comision > 0 AND r.total_usd > 0 THEN
          v_deuda_despacho := ROUND((r.comision_retenida / r.total_comision) * r.total_usd, 2);
        ELSE
          v_deuda_despacho := 0;
        END IF;
        
        IF v_deuda_despacho > 0 THEN
          IF v_monto_restante >= v_deuda_despacho THEN
            v_monto_aplicado := v_deuda_despacho;
          ELSE
            v_monto_aplicado := v_monto_restante;
          END IF;
          
          -- Liberar la comisión proporcional al monto aplicado sobre el total del despacho
          v_porcentaje_abn := v_monto_aplicado / r.total_usd;
          v_monto_a_liberar := ROUND((r.total_comision * v_porcentaje_abn)::numeric, 2);
          
          UPDATE public.comisiones
          SET 
            comision_liberada = LEAST(r.total_comision, comision_liberada + v_monto_a_liberar),
            comision_retenida = GREATEST(0, comision_retenida - v_monto_a_liberar),
            estado = CASE 
                       WHEN estado = 'pagada' THEN 'pagada'
                       WHEN (comision_liberada + v_monto_a_liberar) >= r.total_comision THEN 'liberada'
                       ELSE 'pago_parcial'
                     END,
            actualizado_en = now()
          WHERE despacho_id = r.despacho_id;
          
          v_monto_restante := v_monto_restante - v_monto_aplicado;
        END IF;
      END LOOP;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 2. Retroactivo: Procesar los abonos globales existentes que no se aplicaron a las comisiones
DO $$
DECLARE
  rec_abono RECORD;
  r RECORD;
  v_monto_restante NUMERIC;
  v_deuda_despacho NUMERIC;
  v_monto_aplicado NUMERIC;
  v_porcentaje_abn NUMERIC;
  v_monto_a_liberar NUMERIC;
BEGIN
  -- Buscar todos los abonos globales ordenados cronológicamente
  FOR rec_abono IN
    SELECT * FROM public.cuentas_por_cobrar 
    WHERE tipo = 'abono' AND despacho_id IS NULL
    ORDER BY creado_en ASC
  LOOP
      v_monto_restante := rec_abono.monto_usd;
      
      -- Buscar las comisiones con estado retenido o parcial para ese cliente
      FOR r IN 
        SELECT nd.id AS despacho_id, nd.total_usd, c.total_comision, c.comision_liberada, c.comision_retenida
        FROM public.notas_despacho nd
        JOIN public.comisiones c ON c.despacho_id = nd.id
        WHERE nd.cliente_id = rec_abono.cliente_id
          AND c.estado IN ('retenida', 'pago_parcial')
        ORDER BY nd.creado_en ASC
      LOOP
        EXIT WHEN v_monto_restante <= 0;
        
        IF r.total_comision > 0 AND r.total_usd > 0 THEN
          v_deuda_despacho := ROUND((r.comision_retenida / r.total_comision) * r.total_usd, 2);
        ELSE
          v_deuda_despacho := 0;
        END IF;
        
        IF v_deuda_despacho > 0 THEN
          IF v_monto_restante >= v_deuda_despacho THEN
            v_monto_aplicado := v_deuda_despacho;
          ELSE
            v_monto_aplicado := v_monto_restante;
          END IF;
          
          v_porcentaje_abn := v_monto_aplicado / r.total_usd;
          v_monto_a_liberar := ROUND((r.total_comision * v_porcentaje_abn)::numeric, 2);
          
          UPDATE public.comisiones
          SET 
            comision_liberada = LEAST(r.total_comision, comision_liberada + v_monto_a_liberar),
            comision_retenida = GREATEST(0, comision_retenida - v_monto_a_liberar),
            estado = CASE 
                       WHEN estado = 'pagada' THEN 'pagada'
                       WHEN (comision_liberada + v_monto_a_liberar) >= r.total_comision THEN 'liberada'
                       ELSE 'pago_parcial'
                     END,
            actualizado_en = now()
          WHERE despacho_id = r.despacho_id;
          
          v_monto_restante := v_monto_restante - v_monto_aplicado;
        END IF;
      END LOOP;
  END LOOP;
END;
$$;
