-- 02_devolucion_cobro_diferencia.sql
-- Proyecto principal — Cobro de la diferencia en devolución parcial (Opción A).
--
-- ADDITIVO: no altera la firma existente de 13 parámetros de
-- registrar_devolucion_parcial_idempotente. Publica una función DEDICADA de
-- 14 parámetros con nombre nuevo (registrar_devolucion_parcial_cobro_idempotente,
-- p_pagos_diferencia JSONB DEFAULT NULL). El wrapper nuevo:
--   1) valida los pagos ANTES de reservar la clave idempotente (un payload
--      inválido no quema la clave ni toca la transacción financiera);
--   2) delega en la función original de 13 parámetros (inventario, Kardex,
--      cargo de diferencia, comisión y replay guard quedan intactos);
--   3) en replay (idempotent=true) devuelve el resultado guardado sin
--      re-insertar abonos (cero duplicación);
--   4) en primera ejecución inserta un abono por cada pago cobrado dentro
--      de la MISMA transacción y recalcula los saldos del cliente.
--
-- El Worker es el único consumidor: solo service_role obtiene EXECUTE.
--
-- SAFETY GATE: elimina el bloque REVIEW_ONLY únicamente en una ventana
-- autorizada, con backup verificado y rollback aprobado. Nunca lo comentes
-- globalmente ni lo saltes.

BEGIN;

-- SAFETY GATE: elimina este bloque únicamente después de aprobar backup,
-- historial remoto, preflight, pruebas de staging y rollback.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 02_devolucion_cobro_diferencia.sql no debe ejecutarse todavía';
END
$$;

-- Preflight: la firma vigente de 13 args y las columnas CxC deben existir.
DO $$
BEGIN
  IF to_regprocedure('public.registrar_devolucion_parcial_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: falta registrar_devolucion_parcial_idempotente de 13 parámetros (release 04)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cuentas_por_cobrar'
      AND column_name IN ('forma_pago_abono', 'referencia', 'metodo_pago')
    GROUP BY table_schema, table_name
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: faltan columnas de abono en cuentas_por_cobrar';
  END IF;

  IF to_regclass('public.notas_despacho') IS NULL
     OR to_regclass('public.clientes') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas base ausentes';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Helper de validación (sin efectos, lanza excepción ante payload inválido).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validar_pagos_diferencia_devolucion(
  p_cuenta_id              UUID,
  p_despacho_id            UUID,
  p_total_devuelto_usd     NUMERIC,
  p_total_intercambio_usd  NUMERIC,
  p_pagos                  JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho   RECORD;
  v_diferencia NUMERIC(12,2);
  v_suma       NUMERIC(12,2);
BEGIN
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array'
     OR jsonb_array_length(p_pagos) = 0
     OR jsonb_array_length(p_pagos) > 12 THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_INVALIDO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_pagos) AS x(metodo TEXT, monto NUMERIC, referencia TEXT)
    WHERE btrim(COALESCE(x.metodo, '')) NOT IN (
        'Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil',
        'Punto de Venta', 'USDT', 'Cruce'
      )
       OR x.monto IS NULL OR x.monto <> x.monto OR ROUND(x.monto, 4) <= 0
       OR x.monto > 1000000000
       OR (btrim(x.metodo) = 'Transf. / Pago Móvil'
           AND btrim(COALESCE(x.referencia, '')) = '')
       OR length(btrim(COALESCE(x.referencia, ''))) > 160
  ) THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_INVALIDO';
  END IF;

  SELECT numero, cuenta_id, COALESCE(cliente_factura_id, cliente_id) AS cliente_id
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id;

  IF v_despacho.numero IS NULL OR v_despacho.cuenta_id IS DISTINCT FROM p_cuenta_id THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_DESPACHO_INVALIDO';
  END IF;

  IF v_despacho.cliente_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = v_despacho.cliente_id AND c.cuenta_id = p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_SIN_CLIENTE';
  END IF;

  v_diferencia := ROUND((COALESCE(p_total_intercambio_usd, 0) - COALESCE(p_total_devuelto_usd, 0))::NUMERIC, 2);
  IF v_diferencia <= 0 THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_SIN_CARGO';
  END IF;

  SELECT ROUND(COALESCE(SUM(ROUND(x.monto, 4)), 0), 2)
  INTO v_suma
  FROM jsonb_to_recordset(p_pagos) AS x(monto NUMERIC);

  IF v_suma > v_diferencia + 0.01 THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_EXCEDE_DIFERENCIA';
  END IF;

  RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper de registro: un abono por cada pago cobrado + recálculo de saldos.
-- Debe invocarse DESPUÉS de la RPC de devolución en la misma transacción.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_cobro_diferencia_devolucion(
  p_cuenta_id              UUID,
  p_despacho_id            UUID,
  p_usuario_id             UUID,
  p_usuario_nombre         TEXT,
  p_total_devuelto_usd     NUMERIC,
  p_total_intercambio_usd  NUMERIC,
  p_pagos                  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho   RECORD;
  v_cliente_id UUID;
  v_saldo      NUMERIC(12,4);
  v_favor      NUMERIC(12,4);
  v_pagado     NUMERIC(12,4) := 0;
  v_diferencia NUMERIC(12,2);
  v_pago       RECORD;
BEGIN
  PERFORM public.validar_pagos_diferencia_devolucion(
    p_cuenta_id, p_despacho_id, p_total_devuelto_usd, p_total_intercambio_usd, p_pagos
  );

  SELECT numero, cuenta_id, COALESCE(cliente_factura_id, cliente_id) AS cliente_id
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF v_despacho.numero IS NULL THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_DESPACHO_INVALIDO';
  END IF;

  v_cliente_id := v_despacho.cliente_id;
  SELECT saldo_pendiente
  INTO v_saldo
  FROM public.clientes
  WHERE id = v_cliente_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF v_saldo IS NULL THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_SIN_CLIENTE';
  END IF;

  v_diferencia := ROUND((COALESCE(p_total_intercambio_usd, 0) - COALESCE(p_total_devuelto_usd, 0))::NUMERIC, 2);

  FOR v_pago IN
    SELECT * FROM jsonb_to_recordset(p_pagos) AS x(metodo TEXT, monto NUMERIC, referencia TEXT)
  LOOP
    INSERT INTO public.cuentas_por_cobrar (
      cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
      forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id,
      metodo_pago
    ) VALUES (
      v_cliente_id,
      p_despacho_id,
      'abono',
      ROUND(v_pago.monto, 4),
      GREATEST(0, ROUND((v_saldo - ROUND(v_pago.monto, 4))::NUMERIC, 4)),
      btrim(v_pago.metodo),
      NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''),
      'Cobro de diferencia en intercambio — Despacho #' || v_despacho.numero,
      p_usuario_id,
      p_cuenta_id,
      'cxc'
    );
    v_saldo := GREATEST(0, ROUND((v_saldo - ROUND(v_pago.monto, 4))::NUMERIC, 4));
    v_pagado := v_pagado + ROUND(v_pago.monto, 4);
  END LOOP;

  -- Mismo cierre que 03/04: los triggers mantienen los saldos denormalizados;
  -- se recalculan bajo el mismo bloqueo para dejarlo explícito.
  SELECT
    COALESCE(SUM(CASE
      WHEN c.tipo = 'cargo' THEN c.monto_usd
      WHEN c.tipo = 'abono' THEN -c.monto_usd
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN c.tipo = 'credito' THEN c.monto_usd
      WHEN c.tipo = 'abono' AND c.forma_pago_abono = 'Saldo a favor' THEN -c.monto_usd
      WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
      ELSE 0 END), 0)
  INTO v_saldo, v_favor
  FROM public.cuentas_por_cobrar c
  WHERE c.cliente_id = v_cliente_id;

  UPDATE public.clientes
  SET saldo_pendiente = GREATEST(0, ROUND(v_saldo::NUMERIC, 4)),
      saldo_a_favor = GREATEST(0, ROUND(v_favor::NUMERIC, 4))
  WHERE id = v_cliente_id;

  RETURN jsonb_build_object(
    'pagos_diferencia', p_pagos,
    'pagado_diferencia_usd', ROUND(v_pagado, 2),
    'pendiente_diferencia_usd', GREATEST(0, ROUND((v_diferencia - v_pagado)::NUMERIC, 2))
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Función DEDICADA de 14 parámetros con nombre nuevo.
-- NOTA: no se usa sobrecarga del mismo nombre porque esta versión de
-- PostgREST no resuelve overloads con parámetros opcionalmente omitidos
-- (42725 "could not choose a best candidate"), lo que rompería a los
-- llamadores existentes de 13 args. Un nombre nuevo es igual de aditivo
-- y elimina toda ambigüedad. Delega en la RPC original de 13 parámetros,
-- que DEBE permanecer intacta (esta función la invoca internamente).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(
  p_cuenta_id                UUID,
  p_despacho_id              UUID,
  p_idempotency_key          UUID,
  p_devoluciones             JSONB,
  p_intercambios             JSONB DEFAULT '[]'::JSONB,
  p_motivo                   TEXT DEFAULT NULL,
  p_usuario_id               UUID DEFAULT NULL,
  p_usuario_nombre           TEXT DEFAULT NULL,
  p_usuario_color            TEXT DEFAULT NULL,
  p_cotizacion_reemplazo_id  UUID DEFAULT NULL,
  p_total_devuelto_usd       NUMERIC DEFAULT 0,
  p_total_intercambio_usd    NUMERIC DEFAULT 0,
  p_reemplazo                JSONB DEFAULT NULL,
  p_pagos_diferencia         JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resultado JSONB;
  v_cobro     JSONB;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  -- Validación temprana: un payload inválido no consume la clave idempotente.
  IF p_pagos_diferencia IS NOT NULL AND p_pagos_diferencia <> 'null'::JSONB THEN
    IF jsonb_typeof(p_pagos_diferencia) <> 'array' THEN
      RAISE EXCEPTION 'PAGO_DIFERENCIA_INVALIDO';
    END IF;
    IF jsonb_array_length(p_pagos_diferencia) > 0 THEN
      PERFORM public.validar_pagos_diferencia_devolucion(
        p_cuenta_id, p_despacho_id, p_total_devuelto_usd, p_total_intercambio_usd,
        p_pagos_diferencia
      );
    END IF;
  END IF;

  v_resultado := public.registrar_devolucion_parcial_idempotente(
    p_cuenta_id, p_despacho_id, p_idempotency_key, p_devoluciones, p_intercambios,
    p_motivo, p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_cotizacion_reemplazo_id, p_total_devuelto_usd, p_total_intercambio_usd, p_reemplazo
  );

  -- Replay: devolver el resultado original guardado sin re-insertar abonos.
  IF COALESCE((v_resultado->>'idempotent')::BOOLEAN, FALSE) THEN
    RETURN v_resultado;
  END IF;

  IF p_pagos_diferencia IS NOT NULL AND p_pagos_diferencia <> 'null'::JSONB
     AND jsonb_typeof(p_pagos_diferencia) = 'array'
     AND jsonb_array_length(p_pagos_diferencia) > 0 THEN
    v_cobro := public.registrar_cobro_diferencia_devolucion(
      p_cuenta_id, p_despacho_id, p_usuario_id, p_usuario_nombre,
      p_total_devuelto_usd, p_total_intercambio_usd, p_pagos_diferencia
    );
    v_resultado := v_resultado || v_cobro;
  END IF;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_pagos_diferencia_devolucion(UUID, UUID, NUMERIC, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_cobro_diferencia_devolucion(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validar_pagos_diferencia_devolucion(UUID, UUID, NUMERIC, NUMERIC, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_diferencia_devolucion(UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
