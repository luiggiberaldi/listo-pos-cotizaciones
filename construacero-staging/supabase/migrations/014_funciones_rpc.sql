-- 014_funciones_rpc.sql
-- IMPORTANTE: Todas las funciones SECURITY DEFINER deben tener SET search_path
-- para prevenir ataques de search_path injection.


-- ============================================================
-- RPC 1: registrar_auditoria
-- Usada internamente por otras RPCs para insertar en auditoria
-- sin necesidad de que el usuario_id = auth.uid() (las RPCs corren como postgres)
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_auditoria(
  p_usuario_id    UUID,
  p_usuario_nombre TEXT,
  p_usuario_rol   TEXT,
  p_categoria     categoria_auditoria,
  p_accion        TEXT,
  p_descripcion   TEXT DEFAULT NULL,
  p_entidad_tipo  TEXT DEFAULT NULL,
  p_entidad_id    UUID DEFAULT NULL,
  p_meta          JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.auditoria (
    usuario_id, usuario_nombre, usuario_rol,
    categoria, accion, descripcion,
    entidad_tipo, entidad_id, meta
  ) VALUES (
    p_usuario_id, p_usuario_nombre, p_usuario_rol,
    p_categoria, p_accion, p_descripcion,
    p_entidad_tipo, p_entidad_id, p_meta
  );
END;
$$;


-- ============================================================
-- RPC 2: reasignar_cliente
-- ============================================================
CREATE OR REPLACE FUNCTION public.reasignar_cliente(
  p_cliente_id      UUID,
  p_nuevo_vendedor  UUID,
  p_motivo          TEXT
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_supervisor_id   UUID := auth.uid();
  v_supervisor_nombre TEXT;
  v_vendedor_origen UUID;
  v_cliente_nombre  TEXT;
BEGIN
  -- 1. Verificar que el caller es supervisor activo
  SELECT nombre INTO v_supervisor_nombre
  FROM public.usuarios
  WHERE id = v_supervisor_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo un supervisor activo puede reasignar clientes';
  END IF;

  -- 2. Motivo obligatorio y mínimo
  IF p_motivo IS NULL OR char_length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO: El motivo debe tener al menos 10 caracteres';
  END IF;

  -- 3. Verificar que el cliente existe y está activo
  SELECT vendedor_id, nombre INTO v_vendedor_origen, v_cliente_nombre
  FROM public.clientes
  WHERE id = p_cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO: El cliente no existe o está inactivo';
  END IF;

  -- 4. Verificar que el destino es un vendedor activo (o supervisor)
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_nuevo_vendedor AND activo = true
  ) THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  -- 5. No reasignar al mismo vendedor
  IF v_vendedor_origen = p_nuevo_vendedor THEN
    RAISE EXCEPTION 'SIN_CAMBIO: El cliente ya pertenece a ese vendedor';
  END IF;

  -- 6. Actualizar el cliente
  UPDATE public.clientes
  SET
    vendedor_id          = p_nuevo_vendedor,
    ultima_reasig_por    = v_supervisor_id,
    ultima_reasig_motivo = p_motivo,
    ultima_reasig_en     = now(),
    actualizado_en       = now()
  WHERE id = p_cliente_id;

  -- 7. Insertar en historial de reasignaciones
  INSERT INTO public.reasignaciones_clientes
    (cliente_id, vendedor_origen, vendedor_destino, supervisor_id, motivo)
  VALUES
    (p_cliente_id, v_vendedor_origen, p_nuevo_vendedor, v_supervisor_id, p_motivo);

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id    := v_supervisor_id,
    p_usuario_nombre := v_supervisor_nombre,
    p_usuario_rol   := 'supervisor',
    p_categoria     := 'REASIGNACION',
    p_accion        := 'REASIGNAR_CLIENTE',
    p_descripcion   := 'Cliente "' || v_cliente_nombre || '" reasignado. Motivo: ' || p_motivo,
    p_entidad_tipo  := 'cliente',
    p_entidad_id    := p_cliente_id,
    p_meta          := jsonb_build_object(
      'vendedor_origen', v_vendedor_origen,
      'vendedor_destino', p_nuevo_vendedor,
      'motivo', p_motivo
    )
  );
END;
$$;


-- ============================================================
-- RPC 3: enviar_cotizacion
-- Cierra una cotización: estado borrador → enviada
-- ============================================================
CREATE OR REPLACE FUNCTION public.enviar_cotizacion(
  p_cotizacion_id  UUID,
  p_tasa_bcv       NUMERIC  -- Tasa BCV del momento del envío
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id    UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol   TEXT;
  v_cotizacion    RECORD;
BEGIN
  -- 1. Obtener datos del usuario
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USUARIO_INVALIDO';
  END IF;

  -- 2. Obtener y validar la cotización
  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Solo el vendedor dueño o un supervisor puede enviar
  IF v_cotizacion.vendedor_id <> v_usuario_id
     AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  -- 4. Solo se puede enviar desde borrador
  IF v_cotizacion.estado <> 'borrador' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar en borrador para enviar';
  END IF;

  -- 5. Validar que tiene al menos un ítem
  IF NOT EXISTS (
    SELECT 1 FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id
  ) THEN
    RAISE EXCEPTION 'SIN_ITEMS: No se puede enviar una cotización sin productos';
  END IF;

  -- 6. Actualizar la cotización
  UPDATE public.cotizaciones
  SET
    estado             = 'enviada',
    enviada_en         = now(),
    tasa_bcv_snapshot  = p_tasa_bcv,
    total_bs_snapshot  = total_usd * p_tasa_bcv,
    actualizado_en     = now()
  WHERE id = p_cotizacion_id;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := v_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'ENVIAR_COTIZACION',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := p_cotizacion_id,
    p_meta           := jsonb_build_object('tasa_bcv', p_tasa_bcv)
  );
END;
$$;


-- ============================================================
-- RPC 4: crear_version_cotizacion
-- Crea una nueva versión de una cotización enviada
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_version_cotizacion(
  p_cotizacion_id  UUID,
  p_notas_cambio   TEXT DEFAULT NULL
)
RETURNS UUID  -- Retorna el ID de la nueva versión
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_original       RECORD;
  v_raiz_id        UUID;
  v_nueva_version  INTEGER;
  v_nueva_cot_id   UUID;
BEGIN
  -- 1. Validar usuario
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_INVALIDO'; END IF;

  -- 2. Obtener cotización original
  SELECT * INTO v_original
  FROM public.cotizaciones WHERE id = p_cotizacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA'; END IF;

  -- 3. Solo se puede versionar desde 'enviada' o 'rechazada'
  IF v_original.estado NOT IN ('enviada', 'rechazada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se versionan cotizaciones enviadas o rechazadas';
  END IF;

  -- 4. Solo el dueño o supervisor
  IF v_original.vendedor_id <> v_usuario_id AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  -- 5. Determinar la raíz y la nueva versión
  v_raiz_id := COALESCE(v_original.cotizacion_raiz_id, v_original.id);

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_nueva_version
  FROM public.cotizaciones
  WHERE cotizacion_raiz_id = v_raiz_id OR id = v_raiz_id;

  -- 6. Crear nueva cotización (copia del header)
  INSERT INTO public.cotizaciones (
    numero, version, cotizacion_raiz_id,
    cliente_id, vendedor_id, transportista_id,
    estado, valida_hasta,
    notas_cliente, notas_internas
  )
  VALUES (
    -- numero usa GENERATED ALWAYS AS IDENTITY — necesitamos override
    -- Las versiones usan el número del original
    DEFAULT,            -- nuevo numero propio (para INDEX)
    v_nueva_version,
    v_raiz_id,
    v_original.cliente_id,
    v_original.vendedor_id,
    v_original.transportista_id,
    'borrador',
    v_original.valida_hasta,
    v_original.notas_cliente,
    COALESCE(p_notas_cambio, v_original.notas_internas)
  )
  RETURNING id INTO v_nueva_cot_id;

  -- 7. Copiar los ítems de la cotización original
  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_cot_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id;

  -- 8. Recalcular totales en la nueva cotización (heredados del original)
  UPDATE public.cotizaciones
  SET
    subtotal_usd         = v_original.subtotal_usd,
    descuento_global_pct = v_original.descuento_global_pct,
    descuento_usd        = v_original.descuento_usd,
    costo_envio_usd      = v_original.costo_envio_usd,
    total_usd            = v_original.total_usd
  WHERE id = v_nueva_cot_id;

  -- 8b. Anular la cotización original automáticamente
  UPDATE public.cotizaciones
  SET estado = 'anulada'
  WHERE id = p_cotizacion_id;

  -- 9. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := v_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_VERSION',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_cot_id,
    p_meta           := jsonb_build_object(
      'cotizacion_origen', p_cotizacion_id,
      'nueva_version', v_nueva_version
    )
  );

  RETURN v_nueva_cot_id;
END;
$$;
