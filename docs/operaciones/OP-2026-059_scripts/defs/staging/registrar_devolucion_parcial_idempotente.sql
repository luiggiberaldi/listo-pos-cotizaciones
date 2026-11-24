CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_devoluciones jsonb, p_intercambios jsonb DEFAULT '[]'::jsonb, p_motivo text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid, p_total_devuelto_usd numeric DEFAULT 0, p_total_intercambio_usd numeric DEFAULT 0, p_reemplazo jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho          RECORD;
  v_guard             JSONB;
  v_inventario        JSONB;
  v_finanzas          JSONB;
  v_resultado         JSONB;
  v_reemplazo_id      UUID := p_cotizacion_reemplazo_id;
  v_reemplazo_cliente UUID;
  v_reemplazo_vendedor UUID;
  v_reemplazo_transportista UUID;
  v_reemplazo_total   NUMERIC(12,4);
  v_item              RECORD;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL
     OR p_devoluciones IS NULL OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_IDEMPOTENTE_INVALIDOS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_usuario_id AND cuenta_id = p_cuenta_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'USUARIO_FUERA_DE_TENANT';
  END IF;

  SELECT id, cuenta_id INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_EN_TENANT'; END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'dispatch_partial_return'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
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

  v_inventario := public.registrar_devolucion_inventario_atomica(
    p_despacho_id, p_devoluciones, p_intercambios, p_motivo,
    p_usuario_id, p_usuario_nombre, p_usuario_color,
    v_reemplazo_id, p_total_devuelto_usd, p_total_intercambio_usd
  );

  v_finanzas := public.ajustar_finanzas_devolucion_neta(
    p_despacho_id, p_total_devuelto_usd, p_total_intercambio_usd,
    p_usuario_id, p_usuario_nombre
  );

  v_resultado := COALESCE(v_inventario, '{}'::JSONB)
    || COALESCE(v_finanzas, '{}'::JSONB)
    || jsonb_build_object(
      'ok', TRUE,
      'transaccion_atomica', TRUE,
      'cotizacion_reemplazo_id', v_reemplazo_id,
      'idempotency_key', p_idempotency_key
    );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$
