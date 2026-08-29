-- 053_rpc_cuentas_por_cobrar.sql
-- RPCs para registrar cargos (deuda) y abonos (pagos) en cuentas por cobrar

-- ════════════════════════════════════════════════════════════════════════════
-- RPC 1: registrar_cargo_cxc
-- Llamado automáticamente al crear despacho con forma_pago = 'Cta por cobrar'
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.registrar_cargo_cxc(
  p_despacho_id UUID
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id   UUID := auth.uid();
  v_despacho     RECORD;
  v_saldo_actual NUMERIC(12,4);
  v_nuevo_saldo  NUMERIC(12,4);
  v_cxc_id       UUID;
BEGIN
  -- 1. Validar caller: solo supervisores
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true
  ) THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden registrar cargos CxC';
  END IF;

  -- 2. Obtener despacho con datos del cliente
  SELECT nd.id, nd.total_usd, nd.cliente_id, nd.numero,
         c.nombre AS cliente_nombre
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes c ON c.id = nd.cliente_id
  WHERE nd.id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO: No existe el despacho %', p_despacho_id;
  END IF;

  -- 3. Verificar que no exista ya un cargo para este despacho
  IF EXISTS (
    SELECT 1 FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id AND tipo = 'cargo'
  ) THEN
    RAISE EXCEPTION 'CARGO_DUPLICADO: Ya existe un cargo para este despacho';
  END IF;

  -- 4. Obtener saldo actual del cliente
  SELECT COALESCE(saldo_pendiente, 0) INTO v_saldo_actual
  FROM public.clientes
  WHERE id = v_despacho.cliente_id
  FOR UPDATE;

  v_nuevo_saldo := v_saldo_actual + v_despacho.total_usd;

  -- 5. Insertar cargo
  INSERT INTO public.cuentas_por_cobrar (
    cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
    descripcion, registrado_por
  ) VALUES (
    v_despacho.cliente_id,
    p_despacho_id,
    'cargo',
    v_despacho.total_usd,
    v_nuevo_saldo,
    'Orden de despacho #' || v_despacho.numero,
    v_usuario_id
  ) RETURNING id INTO v_cxc_id;

  -- 6. Actualizar saldo denormalizado en clientes
  UPDATE public.clientes
  SET saldo_pendiente = v_nuevo_saldo
  WHERE id = v_despacho.cliente_id;

  RETURN v_cxc_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- RPC 2: registrar_abono_cxc
-- Llamado manualmente por supervisor al recibir un pago del cliente
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.registrar_abono_cxc(
  p_cliente_id    UUID,
  p_monto         NUMERIC,
  p_forma_pago    TEXT DEFAULT NULL,
  p_referencia    TEXT DEFAULT NULL,
  p_descripcion   TEXT DEFAULT 'Abono recibido'
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id   UUID := auth.uid();
  v_saldo_actual NUMERIC(12,4);
  v_nuevo_saldo  NUMERIC(12,4);
  v_cxc_id       UUID;
BEGIN
  -- 1. Validar caller: solo supervisores
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true
  ) THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden registrar abonos';
  END IF;

  -- 2. Validar monto
  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO: El monto debe ser mayor a cero';
  END IF;

  -- 3. Obtener saldo actual (con lock)
  SELECT COALESCE(saldo_pendiente, 0) INTO v_saldo_actual
  FROM public.clientes
  WHERE id = p_cliente_id AND activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO: Cliente no existe o está inactivo';
  END IF;

  IF v_saldo_actual <= 0 THEN
    RAISE EXCEPTION 'SIN_DEUDA: El cliente no tiene saldo pendiente';
  END IF;

  -- 4. Calcular nuevo saldo (no permitir saldo negativo)
  v_nuevo_saldo := GREATEST(0, v_saldo_actual - p_monto);

  -- 5. Insertar abono
  INSERT INTO public.cuentas_por_cobrar (
    cliente_id, tipo, monto_usd, saldo_usd,
    forma_pago_abono, referencia, descripcion, registrado_por
  ) VALUES (
    p_cliente_id,
    'abono',
    p_monto,
    v_nuevo_saldo,
    p_forma_pago,
    NULLIF(TRIM(COALESCE(p_referencia, '')), ''),
    COALESCE(NULLIF(TRIM(p_descripcion), ''), 'Abono recibido'),
    v_usuario_id
  ) RETURNING id INTO v_cxc_id;

  -- 6. Actualizar saldo denormalizado
  UPDATE public.clientes
  SET saldo_pendiente = v_nuevo_saldo
  WHERE id = p_cliente_id;

  RETURN v_cxc_id;
END;
$$;
