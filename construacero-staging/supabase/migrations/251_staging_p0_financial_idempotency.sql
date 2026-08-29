-- 251_staging_p0_financial_idempotency.sql
--
-- Staging-only validation of P0-B/P0-C before promotion to the main project.
-- This migration deliberately uses the existing *_staging operation registry
-- and the real staging contracts from migrations 225/226/232/245.
--
-- It must never be pointed at the principal project.

BEGIN;

-- The previous staging helper treated NULL as a new operation. That made a
-- missing key indistinguishable from a fresh operation. Make the key and
-- tenant mandatory before any reservation or mutation.
CREATE OR REPLACE FUNCTION public.staging_reservar_operacion(
  p_cuenta_id       UUID,
  p_idempotency_key UUID,
  p_operacion_tipo  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resultado JSONB;
  v_tipo      TEXT;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_operacion_tipo IS NULL
     OR btrim(p_operacion_tipo) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  SELECT resultado, operacion_tipo
  INTO v_resultado, v_tipo
  FROM public.inventario_operaciones_staging
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_tipo <> p_operacion_tipo THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUTILIZADA';
    END IF;
    IF v_resultado IS NULL THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
    END IF;
    RETURN jsonb_build_object('existente', TRUE, 'resultado', v_resultado);
  END IF;

  INSERT INTO public.inventario_operaciones_staging
    (idempotency_key, cuenta_id, operacion_tipo)
  VALUES
    (p_idempotency_key, p_cuenta_id, p_operacion_tipo);

  RETURN jsonb_build_object('existente', FALSE);
END;
$$;

-- ── P0-B: delivery + CxC + commission in one transaction ────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_entrega_finanzas_atomica_staging(
  p_cuenta_id          UUID,
  p_despacho_id        UUID,
  p_idempotency_key    UUID,
  p_usuario_id         UUID,
  p_usuario_nombre     TEXT,
  p_usuario_color      TEXT DEFAULT NULL,
  p_tasa_snapshot      NUMERIC DEFAULT NULL,
  p_permitir_negativo  BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho        RECORD;
  v_cliente         RECORD;
  v_guard           JSONB;
  v_inventario      JSONB;
  v_resultado       JSONB;
  v_forma_pago      JSONB := '[]'::JSONB;
  v_forma_pago_text TEXT;
  v_pago            JSONB;
  v_cliente_id      UUID;
  v_metodo          TEXT;
  v_metodo_cxc      TEXT;
  v_monto           NUMERIC(12,4);
  v_saldo           NUMERIC(12,4) := 0;
  v_usuario_fk      UUID;
  v_total_asignado NUMERIC(12,4) := 0;
  v_excedente       NUMERIC(12,4) := 0;
  v_vuelto_a_favor  BOOLEAN := FALSE;
  v_cxc_creados     INTEGER := 0;
  v_comision_id     UUID;
  v_saldo_pendiente NUMERIC(12,4) := 0;
  v_saldo_favor     NUMERIC(12,4) := 0;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL
     OR p_usuario_id IS NULL OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_ENTREGA_FINANCIERA_INVALIDOS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_usuario_id AND cuenta_id = p_cuenta_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'USUARIO_FUERA_DE_TENANT';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_EN_TENANT';
  END IF;

  v_guard := public.staging_reservar_operacion(
    p_cuenta_id, p_idempotency_key, 'dispatch_delivery_financial'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  v_inventario := public.confirmar_entrega_inventario_atomica(
    p_despacho_id,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color,
    p_tasa_snapshot,
    p_permitir_negativo
  );
  PERFORM public.staging_etiquetar_lote(
    p_cuenta_id,
    NULLIF(v_inventario->>'lote_id', '')::UUID,
    p_idempotency_key
  );

  v_forma_pago_text := COALESCE(
    NULLIF(btrim(v_despacho.forma_pago_cliente::TEXT), ''),
    NULLIF(btrim(v_despacho.forma_pago::TEXT), ''),
    '[]'
  );

  BEGIN
    IF lower(v_forma_pago_text) = lower('Cta por cobrar') THEN
      v_forma_pago := jsonb_build_array(
        jsonb_build_object('metodo', 'Cta por cobrar', 'monto', COALESCE(v_despacho.total_usd, 0))
      );
    ELSE
      v_forma_pago := v_forma_pago_text::JSONB;
    END IF;
  EXCEPTION WHEN others THEN
    v_forma_pago := '[]'::JSONB;
  END;

  IF jsonb_typeof(v_forma_pago) <> 'array' THEN
    v_forma_pago := '[]'::JSONB;
  END IF;

  v_cliente_id := COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);

  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND u.cuenta_id = p_cuenta_id
  LIMIT 1;
  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_CXC_NO_ENCONTRADO';
  END IF;

  IF v_cliente_id IS NOT NULL THEN
    SELECT *
    INTO v_cliente
    FROM public.clientes
    WHERE id = v_cliente_id AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLIENTE_CXC_NO_ENCONTRADO_EN_TENANT';
    END IF;
    v_saldo := COALESCE(v_cliente.saldo_pendiente, 0);
  END IF;

  FOR v_pago IN SELECT value FROM jsonb_array_elements(v_forma_pago)
  LOOP
    v_metodo := btrim(COALESCE(v_pago->>'metodo', ''));
    v_monto := COALESCE(NULLIF(v_pago->>'monto', '')::NUMERIC, 0);
    IF v_monto < 0 THEN
      RAISE EXCEPTION 'MONTO_FORMA_PAGO_INVALIDO';
    END IF;
    IF v_monto = 0 THEN CONTINUE; END IF;

    v_total_asignado := v_total_asignado + v_monto;
    v_vuelto_a_favor := v_vuelto_a_favor
      OR COALESCE((v_pago->>'vuelto_a_favor')::BOOLEAN, FALSE);

    IF lower(v_metodo) IN ('cta por cobrar', 'cobro a destino') AND v_cliente_id IS NOT NULL THEN
      v_metodo_cxc := CASE WHEN lower(v_metodo) = 'cobro a destino' THEN 'cod' ELSE 'cxc' END;
      IF NOT EXISTS (
        SELECT 1
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id
          AND c.tipo = 'cargo'
          AND lower(COALESCE(c.metodo_pago, 'cxc')) = v_metodo_cxc
          AND c.cuenta_id = p_cuenta_id
      ) THEN
        v_saldo := ROUND((v_saldo + v_monto)::NUMERIC, 4);
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          descripcion, registrado_por, cuenta_id, metodo_pago
        ) VALUES (
          v_cliente_id, p_despacho_id, 'cargo', v_monto, v_saldo,
          'Orden de despacho #' || v_despacho.numero ||
            CASE WHEN v_metodo_cxc = 'cod' THEN ' (COD)' ELSE ' (Crédito)' END,
          v_usuario_fk, p_cuenta_id, v_metodo_cxc
        );
        v_cxc_creados := v_cxc_creados + 1;
      END IF;
    ELSIF lower(v_metodo) = 'saldo a favor' AND v_cliente_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id
          AND c.tipo = 'abono'
          AND lower(COALESCE(c.forma_pago_abono, '')) = 'saldo a favor'
          AND c.cuenta_id = p_cuenta_id
      ) THEN
        v_saldo := GREATEST(0, ROUND((v_saldo - v_monto)::NUMERIC, 4));
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id,
          metodo_pago
        ) VALUES (
          v_cliente_id, p_despacho_id, 'abono', v_monto, v_saldo,
          'Saldo a favor', 'Despacho #' || v_despacho.numero,
          'Pago con Saldo a Favor', v_usuario_fk, p_cuenta_id, 'cxc'
        );
        v_cxc_creados := v_cxc_creados + 1;
      END IF;
    END IF;
  END LOOP;

  v_excedente := ROUND((v_total_asignado - COALESCE(v_despacho.total_usd, 0))::NUMERIC, 4);
  IF v_excedente > 0.015 AND v_vuelto_a_favor AND v_cliente_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.cuentas_por_cobrar c
       WHERE c.despacho_id = p_despacho_id
         AND c.tipo = 'credito'
         AND c.cuenta_id = p_cuenta_id
     ) THEN
    INSERT INTO public.cuentas_por_cobrar (
      cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
      referencia, descripcion, registrado_por, cuenta_id, metodo_pago
    ) VALUES (
      v_cliente_id, p_despacho_id, 'credito', v_excedente, v_saldo,
      'Despacho #' || v_despacho.numero,
      'Excedente de pago en Despacho #' || v_despacho.numero,
      v_usuario_fk, p_cuenta_id, 'cxc'
    );
    v_cxc_creados := v_cxc_creados + 1;
  END IF;

  IF v_cliente_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE
        WHEN c.tipo = 'cargo' THEN c.monto_usd
        WHEN c.tipo = 'abono' THEN -c.monto_usd
        ELSE 0 END), 0),
      COALESCE(SUM(CASE
        WHEN c.tipo = 'credito' THEN c.monto_usd
        WHEN c.tipo = 'abono' AND lower(COALESCE(c.forma_pago_abono, '')) = 'saldo a favor' THEN -c.monto_usd
        WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
        ELSE 0 END), 0)
    INTO v_saldo_pendiente, v_saldo_favor
    FROM public.cuentas_por_cobrar c
    WHERE c.cliente_id = v_cliente_id AND c.cuenta_id = p_cuenta_id;

    UPDATE public.clientes
    SET saldo_pendiente = GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
        saldo_a_favor = GREATEST(0, ROUND(v_saldo_favor::NUMERIC, 4))
    WHERE id = v_cliente_id AND cuenta_id = p_cuenta_id;
  END IF;

  SELECT public.calcularcomisiondespacho(p_despacho_id)
  INTO v_comision_id;

  v_resultado := COALESCE(v_inventario, '{}'::JSONB)
    || jsonb_build_object(
      'ok', TRUE,
      'nuevo_estado', 'entregada',
      'finanzas_atomicas', TRUE,
      'frontera_financiera', 'sql_atomic',
      'cxc_movimientos_creados', v_cxc_creados,
      'comision_id', v_comision_id,
      'idempotency_key', p_idempotency_key,
      'idempotent', FALSE
    );
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END;
$$;

-- ── P0-C: partial return + finance + replacement quote ───────────────────────
CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_finanzas_atomica_staging(
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
  p_reemplazo                JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho           RECORD;
  v_guard              JSONB;
  v_inventario         JSONB;
  v_resultado          JSONB;
  v_reemplazo_id       UUID := p_cotizacion_reemplazo_id;
  v_reemplazo_cliente  UUID;
  v_reemplazo_vendedor  UUID;
  v_reemplazo_transportista UUID;
  v_reemplazo_total    NUMERIC(12,4);
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL
     OR p_devoluciones IS NULL
     OR jsonb_typeof(p_devoluciones) <> 'array'
     OR jsonb_array_length(p_devoluciones) = 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_IDEMPOTENTE_INVALIDOS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_usuario_id AND cuenta_id = p_cuenta_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'USUARIO_FUERA_DE_TENANT';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_EN_TENANT';
  END IF;

  v_guard := public.staging_reservar_operacion(
    p_cuenta_id, p_idempotency_key, 'dispatch_partial_return_financial'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  IF p_reemplazo IS NOT NULL AND p_reemplazo <> 'null'::JSONB THEN
    IF jsonb_typeof(p_reemplazo) <> 'object'
       OR jsonb_typeof(p_reemplazo->'items') <> 'array'
       OR jsonb_array_length(p_reemplazo->'items') = 0 THEN
      RAISE EXCEPTION 'COTIZACION_REEMPLAZO_INVALIDA';
    END IF;

    IF v_reemplazo_id IS NOT NULL THEN
      RAISE EXCEPTION 'COTIZACION_REEMPLAZO_ID_DUPLICADO';
    END IF;

    v_reemplazo_cliente := NULLIF(p_reemplazo->>'cliente_id', '')::UUID;
    v_reemplazo_vendedor := NULLIF(p_reemplazo->>'vendedor_id', '')::UUID;
    v_reemplazo_transportista := NULLIF(p_reemplazo->>'transportista_id', '')::UUID;
    v_reemplazo_total := COALESCE(
      NULLIF(p_reemplazo->>'total_usd', '')::NUMERIC,
      p_total_devuelto_usd
    );

    IF v_reemplazo_cliente IS NULL OR v_reemplazo_vendedor IS NULL
       OR v_reemplazo_total IS NULL OR v_reemplazo_total < 0 THEN
      RAISE EXCEPTION 'COTIZACION_REEMPLAZO_PARAMETROS_INVALIDOS';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = v_reemplazo_cliente AND c.cuenta_id = p_cuenta_id
    ) THEN
      RAISE EXCEPTION 'CLIENTE_REEMPLAZO_FUERA_DE_TENANT';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = v_reemplazo_vendedor
        AND u.cuenta_id = p_cuenta_id
        AND u.activo = TRUE
    ) THEN
      RAISE EXCEPTION 'VENDEDOR_REEMPLAZO_FUERA_DE_TENANT';
    END IF;
    IF v_reemplazo_transportista IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.transportistas t
      WHERE t.id = v_reemplazo_transportista AND t.cuenta_id = p_cuenta_id
    ) THEN
      RAISE EXCEPTION 'TRANSPORTISTA_REEMPLAZO_FUERA_DE_TENANT';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_reemplazo->'items') AS x(
        producto_id UUID,
        nombre_snap TEXT,
        cantidad NUMERIC,
        precio_unit_usd NUMERIC,
        total_linea_usd NUMERIC
      )
      WHERE x.nombre_snap IS NULL OR btrim(x.nombre_snap) = ''
         OR x.cantidad IS NULL OR x.cantidad <= 0
         OR x.precio_unit_usd IS NULL OR x.precio_unit_usd < 0
         OR COALESCE(x.total_linea_usd, 0) < 0
         OR (x.producto_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.productos p
           WHERE p.id = x.producto_id AND p.cuenta_id = p_cuenta_id
         ))
    ) THEN
      RAISE EXCEPTION 'ITEM_COTIZACION_REEMPLAZO_INVALIDO';
    END IF;

    INSERT INTO public.cotizaciones (
      version, cliente_id, vendedor_id, transportista_id, estado,
      subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd,
      total_usd, notas_cliente, notas_internas, cuenta_id
    ) VALUES (
      1,
      v_reemplazo_cliente,
      v_reemplazo_vendedor,
      v_reemplazo_transportista,
      'borrador',
      v_reemplazo_total,
      0,
      0,
      0,
      v_reemplazo_total,
      NULLIF(p_reemplazo->>'notas_cliente', ''),
      NULLIF(p_reemplazo->>'notas_internas', ''),
      p_cuenta_id
    )
    RETURNING id INTO v_reemplazo_id;

    INSERT INTO public.cotizacion_items (
      cotizacion_id, producto_id, codigo_snap, nombre_snap,
      unidad_snap, cantidad, precio_unit_usd, descuento_pct,
      total_linea_usd, orden, origen, cuenta_id
    )
    SELECT
      v_reemplazo_id,
      x.producto_id,
      x.codigo_snap,
      btrim(x.nombre_snap),
      COALESCE(NULLIF(btrim(x.unidad_snap), ''), 'und'),
      x.cantidad,
      x.precio_unit_usd,
      COALESCE(x.descuento_pct, 0),
      COALESCE(x.total_linea_usd, ROUND((x.cantidad * x.precio_unit_usd)::NUMERIC, 4)),
      COALESCE(x.orden, row_number() OVER ()::INTEGER - 1),
      COALESCE(NULLIF(btrim(x.origen), ''), 'inventario'),
      p_cuenta_id
    FROM jsonb_to_recordset(p_reemplazo->'items') AS x(
      producto_id UUID,
      codigo_snap TEXT,
      nombre_snap TEXT,
      unidad_snap TEXT,
      cantidad NUMERIC,
      precio_unit_usd NUMERIC,
      descuento_pct NUMERIC,
      total_linea_usd NUMERIC,
      orden INTEGER,
      origen TEXT
    );
  END IF;

  IF v_reemplazo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cotizaciones c
    WHERE c.id = v_reemplazo_id AND c.cuenta_id = p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'COTIZACION_REEMPLAZO_FUERA_DE_TENANT';
  END IF;

  v_inventario := public.registrar_devolucion_parcial_atomica(
    p_despacho_id,
    p_devoluciones,
    p_intercambios,
    p_motivo,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color,
    v_reemplazo_id,
    p_total_devuelto_usd,
    p_total_intercambio_usd
  );
  PERFORM public.staging_etiquetar_lote(
    p_cuenta_id,
    NULLIF(v_inventario->>'lote_id', '')::UUID,
    p_idempotency_key
  );

  v_resultado := COALESCE(v_inventario, '{}'::JSONB)
    || jsonb_build_object(
      'ok', TRUE,
      'transaccion_atomica', TRUE,
      'cotizacion_reemplazo_id', v_reemplazo_id,
      'idempotency_key', p_idempotency_key,
      'idempotent', FALSE
    );
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_entrega_finanzas_atomica_staging(UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_finanzas_atomica_staging(UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_finanzas_atomica_staging(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_finanzas_atomica_staging(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
