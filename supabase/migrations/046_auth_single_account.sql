-- 046_auth_single_account.sql
-- Refactor: cuenta Supabase Auth única para el negocio.
-- Los operadores (vendedor/supervisor) se identifican con PIN almacenado
-- en la tabla usuarios. El JWT lleva app_metadata con operator_id/operator_rol.
--
-- IMPORTANTE: Ejecutar en ventana de mantenimiento.
-- Después de esta migración, los supervisores deben re-asignar PINs
-- a todos los operadores.

-- ============================================================
-- 1. Agregar columnas PIN a usuarios
-- ============================================================
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_salt TEXT;

-- ============================================================
-- 2. Eliminar FK de usuarios.id → auth.users(id)
--    Mantiene el PK y todos los FKs que apuntan A usuarios(id)
-- ============================================================
DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  SELECT c.conname INTO v_fk_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'usuarios'
    AND c.contype = 'f'  -- foreign key
    AND c.confrelid = (SELECT oid FROM pg_class WHERE relname = 'users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth'));

  IF v_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.usuarios DROP CONSTRAINT %I', v_fk_name);
    RAISE NOTICE 'Eliminado FK constraint: %', v_fk_name;
  ELSE
    RAISE NOTICE 'No se encontró FK de usuarios a auth.users (puede que ya fue eliminado)';
  END IF;
END$$;

-- Agregar default para nuevos usuarios (ya no vienen de auth.users)
ALTER TABLE public.usuarios ALTER COLUMN id SET DEFAULT gen_random_uuid();


-- ============================================================
-- 3. Nuevas funciones helper para identidad del operador
-- ============================================================

-- Extraer operator_id del JWT app_metadata
CREATE OR REPLACE FUNCTION public.get_operador_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt()->'app_metadata'->>'operator_id')::uuid;
$$;

-- Reemplazar get_rol_actual para leer del JWT app_metadata
CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.jwt()->'app_metadata'->>'operator_rol',
    (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
  );
$$;


-- ============================================================
-- 4. Reescribir políticas RLS: auth.uid() → get_operador_id()
-- ============================================================

-- ── TABLA: usuarios ──
DROP POLICY IF EXISTS usuarios_ver_propio ON public.usuarios;
CREATE POLICY usuarios_ver_propio ON public.usuarios
  FOR SELECT
  USING (id = public.get_operador_id());

DROP POLICY IF EXISTS usuarios_supervisor_update ON public.usuarios;
CREATE POLICY usuarios_supervisor_update ON public.usuarios
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor')
  WITH CHECK (
    NOT (id = public.get_operador_id() AND rol <> 'supervisor')
  );

-- ── TABLA: clientes ──
DROP POLICY IF EXISTS clientes_vendedor_select ON public.clientes;
CREATE POLICY clientes_vendedor_select ON public.clientes
  FOR SELECT
  USING (vendedor_id = public.get_operador_id() AND activo = true);

DROP POLICY IF EXISTS clientes_vendedor_insert ON public.clientes;
CREATE POLICY clientes_vendedor_insert ON public.clientes
  FOR INSERT
  WITH CHECK (
    vendedor_id = public.get_operador_id()
    AND public.get_rol_actual() = 'vendedor'
  );

DROP POLICY IF EXISTS clientes_vendedor_update ON public.clientes;
CREATE POLICY clientes_vendedor_update ON public.clientes
  FOR UPDATE
  USING (
    vendedor_id = public.get_operador_id()
    AND public.get_rol_actual() = 'vendedor'
  )
  WITH CHECK (
    vendedor_id = public.get_operador_id()
  );

-- ── TABLA: cotizaciones ──
DROP POLICY IF EXISTS cotizaciones_vendedor_select ON public.cotizaciones;
CREATE POLICY cotizaciones_vendedor_select ON public.cotizaciones
  FOR SELECT
  USING (vendedor_id = public.get_operador_id());

DROP POLICY IF EXISTS cotizaciones_vendedor_insert ON public.cotizaciones;
CREATE POLICY cotizaciones_vendedor_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (
    vendedor_id = public.get_operador_id()
    AND EXISTS (
      SELECT 1 FROM public.clientes
      WHERE id = cliente_id AND vendedor_id = public.get_operador_id()
    )
  );

DROP POLICY IF EXISTS cotizaciones_vendedor_update ON public.cotizaciones;
CREATE POLICY cotizaciones_vendedor_update ON public.cotizaciones
  FOR UPDATE
  USING (
    vendedor_id = public.get_operador_id()
    AND estado = 'borrador'
  )
  WITH CHECK (
    vendedor_id = public.get_operador_id()
    AND estado IN ('borrador', 'enviada', 'anulada')
  );

-- ── TABLA: cotizacion_items ──
DROP POLICY IF EXISTS items_vendedor_select ON public.cotizacion_items;
CREATE POLICY items_vendedor_select ON public.cotizacion_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id AND c.vendedor_id = public.get_operador_id()
    )
  );

DROP POLICY IF EXISTS items_vendedor_insert ON public.cotizacion_items;
CREATE POLICY items_vendedor_insert ON public.cotizacion_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = public.get_operador_id()
        AND c.estado = 'borrador'
    )
  );

DROP POLICY IF EXISTS items_vendedor_update ON public.cotizacion_items;
CREATE POLICY items_vendedor_update ON public.cotizacion_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = public.get_operador_id()
        AND c.estado = 'borrador'
    )
  );

DROP POLICY IF EXISTS items_vendedor_delete ON public.cotizacion_items;
CREATE POLICY items_vendedor_delete ON public.cotizacion_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = public.get_operador_id()
        AND c.estado = 'borrador'
    )
  );

-- ── TABLA: notas_despacho ──
DROP POLICY IF EXISTS despachos_vendedor_select ON public.notas_despacho;
CREATE POLICY despachos_vendedor_select ON public.notas_despacho
  FOR SELECT
  USING (vendedor_id = public.get_operador_id());

-- ── TABLA: comisiones ──
DROP POLICY IF EXISTS comisiones_select ON public.comisiones;
CREATE POLICY comisiones_select ON public.comisiones
  FOR SELECT USING (
    vendedor_id = public.get_operador_id()
    OR EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = public.get_operador_id() AND rol = 'supervisor' AND activo = true
    )
  );

-- ── TABLA: auditoria ──
DROP POLICY IF EXISTS auditoria_insert ON public.auditoria;
CREATE POLICY auditoria_insert ON public.auditoria
  FOR INSERT
  WITH CHECK (usuario_id = public.get_operador_id());


-- ============================================================
-- 5. Reescribir RPCs que usan auth.uid()
-- ============================================================

-- ── registrar_auditoria (017) ──
CREATE OR REPLACE FUNCTION public.registrar_auditoria(
  p_accion TEXT,
  p_entidad TEXT,
  p_entidad_id UUID DEFAULT NULL,
  p_detalle JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID;
  v_usuario_nombre TEXT;
  v_usuario_rol TEXT;
BEGIN
  v_usuario_id := public.get_operador_id();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'USUARIO_NO_AUTENTICADO';
  END IF;

  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo = true;

  IF v_usuario_nombre IS NULL THEN
    RAISE EXCEPTION 'USUARIO_NO_ENCONTRADO';
  END IF;

  INSERT INTO public.auditoria (
    usuario_id, usuario_nombre, usuario_rol,
    accion, entidad, entidad_id, detalle
  ) VALUES (
    v_usuario_id, v_usuario_nombre, v_usuario_rol,
    p_accion, p_entidad, p_entidad_id, p_detalle
  );
END;
$$;

-- ── reasignar_cliente (014) ──
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
  v_supervisor_id   UUID := public.get_operador_id();
  v_supervisor_nombre TEXT;
  v_vendedor_origen UUID;
  v_cliente_nombre  TEXT;
BEGIN
  SELECT nombre INTO v_supervisor_nombre
  FROM public.usuarios
  WHERE id = v_supervisor_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo un supervisor activo puede reasignar clientes';
  END IF;

  IF p_motivo IS NULL OR char_length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO: El motivo debe tener al menos 10 caracteres';
  END IF;

  SELECT vendedor_id, nombre INTO v_vendedor_origen, v_cliente_nombre
  FROM public.clientes
  WHERE id = p_cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO: El cliente no existe o está inactivo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_nuevo_vendedor AND activo = true
  ) THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  IF v_vendedor_origen = p_nuevo_vendedor THEN
    RAISE EXCEPTION 'SIN_CAMBIO: El cliente ya pertenece a ese vendedor';
  END IF;

  UPDATE public.clientes
  SET
    vendedor_id          = p_nuevo_vendedor,
    ultima_reasig_por    = v_supervisor_id,
    ultima_reasig_motivo = p_motivo,
    ultima_reasig_en     = now(),
    actualizado_en       = now()
  WHERE id = p_cliente_id;

  INSERT INTO public.reasignaciones_clientes
    (cliente_id, vendedor_origen, vendedor_destino, supervisor_id, motivo)
  VALUES
    (p_cliente_id, v_vendedor_origen, p_nuevo_vendedor, v_supervisor_id, p_motivo);

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

-- ── enviar_cotizacion (014) ──
CREATE OR REPLACE FUNCTION public.enviar_cotizacion(
  p_cotizacion_id  UUID,
  p_tasa_bcv       NUMERIC
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id    UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_rol   TEXT;
  v_cotizacion    RECORD;
BEGIN
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USUARIO_INVALIDO';
  END IF;

  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  IF v_cotizacion.vendedor_id <> v_usuario_id
     AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  IF v_cotizacion.estado <> 'borrador' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar en borrador para enviar';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id
  ) THEN
    RAISE EXCEPTION 'SIN_ITEMS: No se puede enviar una cotización sin productos';
  END IF;

  UPDATE public.cotizaciones
  SET
    estado             = 'enviada',
    enviada_en         = now(),
    tasa_bcv_snapshot  = p_tasa_bcv,
    total_bs_snapshot  = total_usd * p_tasa_bcv,
    actualizado_en     = now()
  WHERE id = p_cotizacion_id;

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

-- ── crear_version_cotizacion (014) ──
CREATE OR REPLACE FUNCTION public.crear_version_cotizacion(
  p_cotizacion_id  UUID,
  p_notas_cambio   TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_original       RECORD;
  v_raiz_id        UUID;
  v_nueva_version  INTEGER;
  v_nueva_cot_id   UUID;
BEGIN
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_INVALIDO'; END IF;

  SELECT * INTO v_original
  FROM public.cotizaciones WHERE id = p_cotizacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA'; END IF;

  IF v_original.estado NOT IN ('enviada', 'rechazada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se versionan cotizaciones enviadas o rechazadas';
  END IF;

  IF v_original.vendedor_id <> v_usuario_id AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  v_raiz_id := COALESCE(v_original.cotizacion_raiz_id, v_original.id);

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_nueva_version
  FROM public.cotizaciones
  WHERE cotizacion_raiz_id = v_raiz_id OR id = v_raiz_id;

  INSERT INTO public.cotizaciones (
    numero, version, cotizacion_raiz_id,
    cliente_id, vendedor_id, transportista_id,
    estado, valida_hasta,
    notas_cliente, notas_internas
  )
  VALUES (
    DEFAULT, v_nueva_version, v_raiz_id,
    v_original.cliente_id, v_original.vendedor_id, v_original.transportista_id,
    'borrador', v_original.valida_hasta,
    v_original.notas_cliente, COALESCE(p_notas_cambio, v_original.notas_internas)
  )
  RETURNING id INTO v_nueva_cot_id;

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

  UPDATE public.cotizaciones
  SET
    subtotal_usd         = v_original.subtotal_usd,
    descuento_global_pct = v_original.descuento_global_pct,
    descuento_usd        = v_original.descuento_usd,
    costo_envio_usd      = v_original.costo_envio_usd,
    total_usd            = v_original.total_usd
  WHERE id = v_nueva_cot_id;

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

-- ── crear_nota_despacho (037) ──
CREATE OR REPLACE FUNCTION public.crear_nota_despacho(
  p_cotizacion_id  UUID,
  p_notas          TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_cotizacion     RECORD;
  v_item           RECORD;
  v_stock_actual   NUMERIC;
  v_despacho_id    UUID;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden crear notas de despacho';
  END IF;

  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  IF v_cotizacion.estado NOT IN ('enviada', 'aceptada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar enviada o aceptada para despachar';
  END IF;

  IF v_cotizacion.estado = 'enviada' THEN
    UPDATE public.cotizaciones SET estado = 'aceptada' WHERE id = p_cotizacion_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id) THEN
    RAISE EXCEPTION 'DESPACHO_EXISTENTE: Ya existe una nota de despacho para esta cotización';
  END IF;

  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_item.producto_id AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO: El producto "%" ya no existe o está inactivo', v_item.nombre_snap;
    END IF;

    IF v_stock_actual < v_item.cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" requiere % pero solo hay % disponible',
        v_item.nombre_snap, v_item.cantidad, v_stock_actual;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    UPDATE public.productos
    SET stock_actual = stock_actual - v_item.cantidad
    WHERE id = v_item.producto_id;
  END LOOP;

  INSERT INTO public.notas_despacho (
    numero, cotizacion_id, cliente_id, vendedor_id, transportista_id,
    estado, total_usd, notas, creado_por
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_cotizacion.numero,
    p_cotizacion_id, v_cotizacion.cliente_id, v_cotizacion.vendedor_id,
    v_cotizacion.transportista_id,
    'pendiente', v_cotizacion.total_usd, p_notas, v_usuario_id
  )
  RETURNING id INTO v_despacho_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := v_despacho_id,
    p_meta           := jsonb_build_object(
      'cotizacion_id', p_cotizacion_id,
      'total_usd', v_cotizacion.total_usd
    )
  );

  RETURN v_despacho_id;
END;
$$;

-- ── actualizar_estado_despacho (036 — versión con comisiones) ──
CREATE OR REPLACE FUNCTION public.actualizar_estado_despacho(
  p_despacho_id   UUID,
  p_nuevo_estado  TEXT
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_despacho       RECORD;
  v_item           RECORD;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden actualizar despachos';
  END IF;

  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF NOT (
    (v_despacho.estado = 'pendiente'  AND p_nuevo_estado IN ('despachada', 'anulada'))
    OR
    (v_despacho.estado = 'despachada' AND p_nuevo_estado IN ('entregada', 'anulada'))
  ) THEN
    RAISE EXCEPTION 'TRANSICION_INVALIDA: No se puede pasar de "%" a "%"',
      v_despacho.estado, p_nuevo_estado;
  END IF;

  IF p_nuevo_estado = 'anulada' AND v_despacho.estado IN ('pendiente', 'despachada') THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.cotizacion_items ci
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
        AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.productos
      SET stock_actual = stock_actual + v_item.cantidad
      WHERE id = v_item.producto_id;
    END LOOP;
  END IF;

  UPDATE public.notas_despacho
  SET
    estado = p_nuevo_estado,
    despachada_en = CASE WHEN p_nuevo_estado = 'despachada' THEN now() ELSE despachada_en END,
    entregada_en  = CASE WHEN p_nuevo_estado = 'entregada'  THEN now() ELSE entregada_en END
  WHERE id = p_despacho_id;

  IF p_nuevo_estado = 'entregada' THEN
    PERFORM public.calcular_comision_despacho(p_despacho_id);
  END IF;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'ACTUALIZAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'estado_anterior', v_despacho.estado,
      'estado_nuevo', p_nuevo_estado,
      'cotizacion_id', v_despacho.cotizacion_id
    )
  );
END;
$$;

-- ── reciclar_despacho (022) ──
CREATE OR REPLACE FUNCTION public.reciclar_despacho(
  p_despacho_id  UUID
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id      UUID := public.get_operador_id();
  v_usuario_nombre  TEXT;
  v_despacho        RECORD;
  v_cotizacion_orig RECORD;
  v_nueva_id        UUID;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden reciclar despachos';
  END IF;

  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'anulada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden reciclar despachos anulados';
  END IF;

  SELECT * INTO v_cotizacion_orig
  FROM public.cotizaciones
  WHERE id = v_despacho.cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  INSERT INTO public.cotizaciones (
    version, cliente_id, vendedor_id, transportista_id,
    estado, subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd,
    notas_cliente, notas_internas
  ) VALUES (
    1, v_cotizacion_orig.cliente_id, v_cotizacion_orig.vendedor_id,
    v_cotizacion_orig.transportista_id,
    'borrador', v_cotizacion_orig.subtotal_usd, v_cotizacion_orig.descuento_global_pct,
    v_cotizacion_orig.descuento_usd, v_cotizacion_orig.costo_envio_usd,
    v_cotizacion_orig.total_usd,
    v_cotizacion_orig.notas_cliente, v_cotizacion_orig.notas_internas
  )
  RETURNING id INTO v_nueva_id;

  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_id, ci.producto_id, ci.codigo_snap, ci.nombre_snap,
    ci.unidad_snap, ci.cantidad, ci.precio_unit_usd, ci.descuento_pct,
    ci.total_linea_usd, ci.orden
  FROM public.cotizacion_items ci
  WHERE ci.cotizacion_id = v_despacho.cotizacion_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'RECICLAR_DESPACHO',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_id,
    p_meta           := jsonb_build_object(
      'despacho_id', p_despacho_id,
      'cotizacion_original_id', v_despacho.cotizacion_id,
      'total_usd', v_cotizacion_orig.total_usd
    )
  );

  RETURN v_nueva_id;
END;
$$;

-- ── reciclar_cotizacion (034) ──
CREATE OR REPLACE FUNCTION public.reciclar_cotizacion(
  p_cotizacion_id       UUID,
  p_vendedor_destino_id UUID
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id         UUID := public.get_operador_id();
  v_usuario_nombre     TEXT;
  v_cotizacion_orig    RECORD;
  v_vendedor_orig_name TEXT;
  v_vendedor_dest_name TEXT;
  v_nueva_id           UUID;
  v_nuevo_numero       BIGINT;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden reciclar cotizaciones';
  END IF;

  SELECT * INTO v_cotizacion_orig
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  IF v_cotizacion_orig.estado NOT IN ('rechazada', 'anulada', 'vencida') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden reciclar cotizaciones rechazadas, anuladas o vencidas';
  END IF;

  SELECT nombre INTO v_vendedor_dest_name
  FROM public.usuarios
  WHERE id = p_vendedor_destino_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  SELECT nombre INTO v_vendedor_orig_name
  FROM public.usuarios
  WHERE id = v_cotizacion_orig.vendedor_id;

  INSERT INTO public.cotizaciones (
    version, cliente_id, vendedor_id, transportista_id,
    estado, subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd,
    notas_cliente, notas_internas
  ) VALUES (
    1, v_cotizacion_orig.cliente_id, p_vendedor_destino_id,
    v_cotizacion_orig.transportista_id,
    'borrador', v_cotizacion_orig.subtotal_usd, v_cotizacion_orig.descuento_global_pct,
    v_cotizacion_orig.descuento_usd, v_cotizacion_orig.costo_envio_usd,
    v_cotizacion_orig.total_usd,
    v_cotizacion_orig.notas_cliente, v_cotizacion_orig.notas_internas
  )
  RETURNING id, numero INTO v_nueva_id, v_nuevo_numero;

  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_id, ci.producto_id, ci.codigo_snap, ci.nombre_snap,
    ci.unidad_snap, ci.cantidad, ci.precio_unit_usd, ci.descuento_pct,
    ci.total_linea_usd, ci.orden
  FROM public.cotizacion_items ci
  WHERE ci.cotizacion_id = p_cotizacion_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'RECICLAR_COTIZACION',
    p_descripcion    := format(
      'Cotización COT-%s reciclada → COT-%s. Vendedor: %s → %s',
      lpad(v_cotizacion_orig.numero::text, 5, '0'),
      lpad(v_nuevo_numero::text, 5, '0'),
      coalesce(v_vendedor_orig_name, '—'),
      v_vendedor_dest_name
    ),
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_id,
    p_meta           := jsonb_build_object(
      'cotizacion_original_id', p_cotizacion_id,
      'cotizacion_original_numero', v_cotizacion_orig.numero,
      'estado_original', v_cotizacion_orig.estado,
      'vendedor_origen_id', v_cotizacion_orig.vendedor_id,
      'vendedor_origen_nombre', coalesce(v_vendedor_orig_name, '—'),
      'vendedor_destino_id', p_vendedor_destino_id,
      'vendedor_destino_nombre', v_vendedor_dest_name,
      'total_usd', v_cotizacion_orig.total_usd,
      'nuevo_numero', v_nuevo_numero
    )
  );

  RETURN v_nueva_id;
END;
$$;

-- ── marcar_comision_pagada (036) ──
CREATE OR REPLACE FUNCTION public.marcar_comision_pagada(
  p_comision_id UUID
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_comision       RECORD;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden marcar comisiones como pagadas';
  END IF;

  SELECT * INTO v_comision
  FROM public.comisiones
  WHERE id = p_comision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMISION_NO_ENCONTRADA';
  END IF;

  IF v_comision.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: Esta comisión ya fue marcada como pagada';
  END IF;

  UPDATE public.comisiones
  SET
    estado = 'pagada',
    pagada_en = now(),
    pagada_por = v_usuario_id,
    actualizado_en = now()
  WHERE id = p_comision_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'PAGAR_COMISION',
    p_entidad_tipo   := 'comision',
    p_entidad_id     := p_comision_id,
    p_meta           := jsonb_build_object(
      'vendedor_id', v_comision.vendedor_id,
      'total_comision', v_comision.total_comision,
      'despacho_id', v_comision.despacho_id
    )
  );
END;
$$;

-- ── aplicar_movimiento_lote (044) ──
CREATE OR REPLACE FUNCTION public.aplicar_movimiento_lote(
  p_tipo   tipo_movimiento,
  p_motivo TEXT,
  p_items  JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lote_id        UUID := gen_random_uuid();
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_item           JSONB;
  v_producto       RECORD;
  v_cantidad       NUMERIC(10,2);
  v_nuevo_stock    NUMERIC(10,2);
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo = true AND rol = 'supervisor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo supervisores pueden ejecutar movimientos de inventario';
  END IF;

  IF p_motivo IS NULL OR char_length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC(10,2);

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = (v_item->>'producto_id')::UUID AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado o inactivo';
    END IF;

    IF p_tipo = 'egreso' THEN
      v_nuevo_stock := v_producto.stock_actual - v_cantidad;
      IF v_nuevo_stock < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": tiene % y se intenta retirar %',
          v_producto.nombre, v_producto.stock_actual, v_cantidad;
      END IF;
    ELSE
      v_nuevo_stock := v_producto.stock_actual + v_cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock, actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, producto_id, producto_nombre, cantidad,
       stock_anterior, stock_nuevo, usuario_id, usuario_nombre)
    VALUES
      (v_lote_id, p_tipo, trim(p_motivo), v_producto.id, v_producto.nombre, v_cantidad,
       v_producto.stock_actual, v_nuevo_stock, v_usuario_id, v_usuario_nombre);
  END LOOP;

  RETURN v_lote_id;
END;
$$;


-- ============================================================
-- 6. Actualizar listar_usuarios_login (sin JOIN a auth.users)
-- ============================================================
DROP FUNCTION IF EXISTS public.listar_usuarios_login();
CREATE FUNCTION public.listar_usuarios_login()
  RETURNS TABLE(id uuid, nombre text, rol text, color text, imagen_url text)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::text AS imagen_url
  FROM public.usuarios u
  WHERE u.activo = true
    AND u.nombre <> 'Super Admin'
  ORDER BY u.nombre;
$$;

GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_operador_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rol_actual() TO authenticated;
