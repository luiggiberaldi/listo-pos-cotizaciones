-- 245_fix_staging_return_commission_base.sql
--
-- La devolución parcial ya ajusta notas_despacho.total_usd, pero la comisión
-- se calcula sobre el valor neto de los artículos, no sobre el encabezado
-- completo (que incluye flete y puede conservar descuento_total_usd separado).
-- La versión 226 usaba total_nuevo / total_original y podía dejar una comisión
-- distinta a la que produciría calcularcomisiondespacho para las líneas netas.
-- Solo staging: validar con el E2E antes de promover a producción.

CREATE OR REPLACE FUNCTION public.ajustar_finanzas_devolucion_atomica(
  p_despacho_id           UUID,
  p_total_devuelto_usd    NUMERIC,
  p_total_intercambio_usd NUMERIC,
  p_usuario_id            UUID DEFAULT NULL,
  p_usuario_nombre        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho           RECORD;
  v_cliente            RECORD;
  v_usuario_fk         UUID;
  v_comision           RECORD;
  v_total_original     NUMERIC(12,4);
  v_total_nuevo        NUMERIC(12,4);
  v_base_original      NUMERIC(12,4);
  v_base_nueva         NUMERIC(12,4);
  v_balance_neto       NUMERIC(12,4);
  v_cxc_despacho       NUMERIC(12,4) := 0;
  v_saldo_pendiente    NUMERIC(12,4) := 0;
  v_saldo_favor        NUMERIC(12,4) := 0;
  v_tiene_cliente      BOOLEAN := FALSE;
  v_abono              NUMERIC(12,4) := 0;
  v_credito            NUMERIC(12,4) := 0;
  v_cargo              NUMERIC(12,4) := 0;
  v_factor             NUMERIC(12,8);
  v_liberada           NUMERIC(12,2);
  v_retenida           NUMERIC(12,2);
  v_comision_nueva     NUMERIC(12,2);
  v_comision_ajustada  BOOLEAN := FALSE;
BEGIN
  IF p_despacho_id IS NULL
     OR p_total_devuelto_usd IS NULL
     OR p_total_intercambio_usd IS NULL
     OR p_total_devuelto_usd < 0
     OR p_total_intercambio_usd < 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_FINANZAS_DEVOLUCION_INVALIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND OR v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'DESPACHO_FINANZAS_NO_DISPONIBLE';
  END IF;

  -- La RPC 225 ya actualizó total_usd dentro de esta misma transacción.
  -- Reconstruimos el total inmediatamente anterior a esta devolución.
  v_total_nuevo := COALESCE(v_despacho.total_usd, 0);
  v_total_original := ROUND((v_total_nuevo
    + p_total_devuelto_usd
    - p_total_intercambio_usd)::NUMERIC, 4);

  IF v_total_original < 0 OR v_total_nuevo < 0 THEN
    RAISE EXCEPTION 'TOTAL_DEVOLUCION_INVALIDO';
  END IF;

  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;

  IF v_usuario_fk IS NULL THEN
    SELECT u.id
    INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
    ORDER BY u.nombre
    LIMIT 1;
  END IF;

  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_CXC_NO_ENCONTRADO';
  END IF;

  -- Bloquear el cliente antes de leer saldos para evitar dos devoluciones que
  -- calculen el mismo saldo y generen abonos/créditos inconsistentes.
  IF COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id) IS NOT NULL THEN
    SELECT *
    INTO v_cliente
    FROM public.clientes
    WHERE id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id)
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLIENTE_CXC_NO_ENCONTRADO';
    END IF;

    v_tiene_cliente := TRUE;
    v_saldo_pendiente := COALESCE(v_cliente.saldo_pendiente, 0);
    v_saldo_favor := COALESCE(v_cliente.saldo_a_favor, 0);

    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);

    IF v_balance_neto > 0 THEN
      v_cargo := v_balance_neto;

      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id,
        p_despacho_id,
        'cargo',
        v_cargo,
        ROUND((v_saldo_pendiente + v_cargo)::NUMERIC, 4),
        'Cargo por diferencia en intercambio — Despacho #' || v_despacho.numero,
        v_usuario_fk,
        v_despacho.cuenta_id
      );
    ELSIF v_balance_neto < 0 THEN
      -- Solo se devuelve contra la deuda originada por este despacho. El
      -- excedente se convierte en crédito a favor del cliente.
      SELECT COALESCE(SUM(
        CASE
          WHEN c.tipo = 'cargo' THEN c.monto_usd
          WHEN c.tipo = 'abono' THEN -c.monto_usd
          ELSE 0
        END
      ), 0)
      INTO v_cxc_despacho
      FROM public.cuentas_por_cobrar c
      WHERE c.despacho_id = p_despacho_id;

      v_cxc_despacho := GREATEST(0, v_cxc_despacho);
      v_abono := ROUND(LEAST(abs(v_balance_neto), v_cxc_despacho)::NUMERIC, 4);

      IF v_abono > 0 THEN
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
        ) VALUES (
          v_cliente.id,
          p_despacho_id,
          'abono',
          v_abono,
          GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
          'Devolución',
          'Despacho #' || v_despacho.numero,
          'Abono por devolución/intercambio — Despacho #' || v_despacho.numero,
          v_usuario_fk,
          v_despacho.cuenta_id
        );
      END IF;

      v_credito := ROUND((abs(v_balance_neto) - v_abono)::NUMERIC, 4);
      IF v_credito > 0 THEN
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
        ) VALUES (
          v_cliente.id,
          p_despacho_id,
          'credito',
          v_credito,
          GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
          'Devolución',
          'Despacho #' || v_despacho.numero,
          'Saldo a favor por excedente en intercambio — Despacho #' || v_despacho.numero,
          v_usuario_fk,
          v_despacho.cuenta_id
        );
      END IF;
    END IF;
  ELSE
    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);
  END IF;

  -- La comisión ya pagada no puede recalcularse silenciosamente después de
  -- devolver mercancía. En ese caso se revierte toda la transacción.
  SELECT *
  INTO v_comision
  FROM public.comisiones c
  WHERE c.despachoid = p_despacho_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_comision.estado = 'pagada' OR COALESCE(v_comision.montopagado, 0) > 0.01 THEN
      RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta el pago antes de registrar la devolución';
    END IF;

    -- La comisión creada al aprobar/entregar parte del valor de artículos
    -- antes del descuento de logística. El encabezado incluye flete/corte y
    -- `descuento_total_usd` se conserva por separado; por eso el denominador
    -- debe ser la base bruta y solo la base nueva debe descontar el descuento.
    -- Así 250 bruto → 207 neto conserva el 3% real ($6.21), en vez de
    -- escalar dos veces el descuento y dejar un saldo incorrecto.
    v_base_original := GREATEST(0, ROUND((v_total_original
      - COALESCE(v_despacho.flete_usd, 0)
      - COALESCE(v_despacho.corte_usd, 0))::NUMERIC, 4));
    v_base_nueva := GREATEST(0, ROUND((v_total_nuevo
      - COALESCE(v_despacho.flete_usd, 0)
      - COALESCE(v_despacho.corte_usd, 0)
      - COALESCE(v_despacho.descuento_total_usd, 0))::NUMERIC, 4));

    IF v_base_original > 0 THEN
      v_factor := v_base_nueva / v_base_original;
      v_comision_nueva := ROUND((COALESCE(v_comision.totalcomision, 0) * v_factor)::NUMERIC, 2);
      v_liberada := ROUND((COALESCE(v_comision.comision_liberada, v_comision.totalcomision) * v_factor)::NUMERIC, 2);
      v_liberada := LEAST(v_comision_nueva, GREATEST(0, v_liberada));
      v_retenida := ROUND((v_comision_nueva - v_liberada)::NUMERIC, 2);

      UPDATE public.comisiones
      SET totalcomision = v_comision_nueva,
          comisioncabilla = ROUND((COALESCE(comisioncabilla, 0) * v_factor)::NUMERIC, 2),
          comisionotros = ROUND((COALESCE(comisionotros, 0) * v_factor)::NUMERIC, 2),
          comision_liberada = v_liberada,
          comision_retenida = v_retenida,
          estado = CASE WHEN v_retenida > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END,
          actualizadoen = now()
      WHERE id = v_comision.id;
      v_comision_ajustada := TRUE;
    END IF;
  END IF;

  -- Los triggers de cuentas_por_cobrar mantienen los saldos denormalizados.
  -- Reforzamos el resultado final bajo el mismo bloqueo para dejarlo explícito.
  IF v_tiene_cliente THEN
    SELECT COALESCE(SUM(CASE
      WHEN c.tipo = 'cargo' THEN c.monto_usd
      WHEN c.tipo = 'abono' THEN -c.monto_usd
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN c.tipo = 'credito' THEN c.monto_usd
      WHEN c.tipo = 'abono' AND c.forma_pago_abono = 'Saldo a favor' THEN -c.monto_usd
      WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
      ELSE 0
    END), 0)
    INTO v_saldo_pendiente, v_saldo_favor
    FROM public.cuentas_por_cobrar c
    WHERE c.cliente_id = v_cliente.id;

    UPDATE public.clientes
    SET saldo_pendiente = GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
        saldo_a_favor = GREATEST(0, ROUND(v_saldo_favor::NUMERIC, 4))
    WHERE id = v_cliente.id;
  END IF;

  RETURN jsonb_build_object(
    'balance_neto_usd', v_balance_neto,
    'cargo_monto', v_cargo,
    'abono_monto', v_abono,
    'credito_monto', v_credito,
    'comision_ajustada', v_comision_ajustada,
    'comision_base_original', v_base_original,
    'comision_base_nueva', v_base_nueva
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajustar_finanzas_devolucion_atomica(UUID, NUMERIC, NUMERIC, UUID, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_finanzas_devolucion_atomica(UUID, NUMERIC, NUMERIC, UUID, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
