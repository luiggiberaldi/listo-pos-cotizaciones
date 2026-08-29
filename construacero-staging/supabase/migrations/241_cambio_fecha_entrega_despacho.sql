-- 241_cambio_fecha_entrega_despacho.sql
-- STAGING ONLY durante esta fase.
-- No cambia números/correlativos, montos, pagos ni timestamps financieros.

BEGIN;

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS entregada_en_ajustada TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_nd_entregada_en_ajustada
  ON public.notas_despacho (entregada_en_ajustada DESC)
  WHERE entregada_en_ajustada IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.despacho_fecha_entrega_cambios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         UUID NOT NULL,
  despacho_id       UUID NOT NULL REFERENCES public.notas_despacho(id) ON DELETE RESTRICT,
  fecha_anterior    TIMESTAMPTZ NOT NULL,
  fecha_nueva       TIMESTAMPTZ NOT NULL,
  motivo            TEXT NOT NULL CHECK (char_length(btrim(motivo)) >= 5),
  actor_id          UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  actor_rol         TEXT NOT NULL,
  ip_origen         TEXT,
  idempotency_key   TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dfe_cambios_cuenta
  ON public.despacho_fecha_entrega_cambios (cuenta_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_dfe_cambios_despacho
  ON public.despacho_fecha_entrega_cambios (despacho_id, creado_en DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dfe_cambios_idempotency
  ON public.despacho_fecha_entrega_cambios (cuenta_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.despacho_fecha_entrega_cambios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.despacho_fecha_entrega_cambios FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cambiar_fecha_entrega_despacho(
  p_cuenta_id       UUID,
  p_actor_id        UUID,
  p_despacho_id     UUID,
  p_nueva_fecha     TIMESTAMPTZ,
  p_motivo          TEXT,
  p_ip_origen       TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_virtual_dev CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  v_actor_id UUID;
  v_actor_nombre TEXT;
  v_actor_rol TEXT;
  v_despacho RECORD;
  v_comision_id UUID;
  v_comision_estado TEXT;
  v_montopagado NUMERIC;
  v_fecha_anterior TIMESTAMPTZ;
  v_existing RECORD;
  v_cambio_id UUID;
  v_audit_id UUID;
BEGIN
  IF p_cuenta_id IS NULL OR p_actor_id IS NULL OR p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_DATOS_REQUERIDOS';
  END IF;

  IF p_nueva_fecha IS NULL THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_FECHA_REQUERIDA';
  END IF;

  IF char_length(btrim(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_MOTIVO_INVALIDO';
  END IF;

  IF char_length(COALESCE(p_motivo, '')) > 1000 THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_MOTIVO_DEMASIADO_LARGO';
  END IF;

  IF char_length(COALESCE(p_idempotency_key, '')) > 128 THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_IDEMPOTENCY_INVALIDA';
  END IF;

  -- El desarrollador virtual no tiene fila en public.usuarios.
  IF p_actor_id = v_virtual_dev THEN
    v_actor_id := NULL;
    v_actor_nombre := 'Desarrollador';
    v_actor_rol := 'desarrollador';
  ELSE
    SELECT u.id, u.nombre, u.rol
      INTO v_actor_id, v_actor_nombre, v_actor_rol
      FROM public.usuarios u
     WHERE u.id = p_actor_id
       AND u.cuenta_id = p_cuenta_id
       AND u.activo = TRUE
     FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FECHA_ENTREGA_ACTOR_NO_VALIDO';
    END IF;
  END IF;

  IF v_actor_rol NOT IN ('administracion', 'jefe', 'logistica', 'desarrollador') THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_ROL_NO_PERMITIDO';
  END IF;

  -- Idempotencia: una repetición conocida devuelve el resultado existente.
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT h.*
      INTO v_existing
      FROM public.despacho_fecha_entrega_cambios h
     WHERE h.cuenta_id = p_cuenta_id
       AND h.idempotency_key = btrim(p_idempotency_key)
     LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', TRUE,
        'idempotent', TRUE,
        'cambio_id', v_existing.id,
        'despacho_id', v_existing.despacho_id,
        'fecha_anterior', v_existing.fecha_anterior,
        'fecha_nueva', v_existing.fecha_nueva,
        'motivo', v_existing.motivo
      );
    END IF;
  END IF;

  -- Bloqueo de la fila principal: evita dos correcciones simultáneas.
  SELECT nd.id,
         nd.numero,
         nd.cuenta_id,
         nd.estado,
         nd.creado_en,
         nd.despachada_en,
         nd.entregada_en,
         nd.entregada_en_ajustada
    INTO v_despacho
    FROM public.notas_despacho nd
   WHERE nd.id = p_despacho_id
     AND nd.cuenta_id = p_cuenta_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_ESTADO_INVALIDO';
  END IF;

  IF v_despacho.entregada_en IS NULL THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_ORIGINAL_AUSENTE';
  END IF;

  IF p_nueva_fecha > clock_timestamp() THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_FUTURA';
  END IF;

  IF p_nueva_fecha < v_despacho.creado_en THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_ANTERIOR_A_CREACION';
  END IF;

  IF v_despacho.despachada_en IS NOT NULL
     AND p_nueva_fecha < v_despacho.despachada_en THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_ANTERIOR_A_APROBACION';
  END IF;

  v_fecha_anterior := COALESCE(v_despacho.entregada_en_ajustada, v_despacho.entregada_en);

  IF p_nueva_fecha = v_fecha_anterior THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_SIN_CAMBIO';
  END IF;

  -- La comisión se bloquea solo para verificar que no esté pagada.
  -- Sus importes y timestamps nunca se actualizan aquí.
  SELECT c.id, c.estado, c.montopagado
    INTO v_comision_id, v_comision_estado, v_montopagado
    FROM public.comisiones c
   WHERE c.despachoid = p_despacho_id
   FOR UPDATE;

  IF v_comision_id IS NOT NULL
     AND (v_comision_estado = 'pagada' OR COALESCE(v_montopagado, 0) > 0) THEN
    RAISE EXCEPTION 'FECHA_ENTREGA_COMISION_PAGADA';
  END IF;

  UPDATE public.notas_despacho
     SET entregada_en_ajustada = p_nueva_fecha,
         actualizado_en = now()
   WHERE id = p_despacho_id
     AND cuenta_id = p_cuenta_id;

  INSERT INTO public.despacho_fecha_entrega_cambios (
    cuenta_id,
    despacho_id,
    fecha_anterior,
    fecha_nueva,
    motivo,
    actor_id,
    actor_rol,
    ip_origen,
    idempotency_key
  ) VALUES (
    p_cuenta_id,
    p_despacho_id,
    v_fecha_anterior,
    p_nueva_fecha,
    btrim(p_motivo),
    v_actor_id,
    v_actor_rol,
    NULLIF(btrim(p_ip_origen), ''),
    NULLIF(btrim(p_idempotency_key), '')
  )
  RETURNING id INTO v_cambio_id;

  v_audit_id := gen_random_uuid();

  INSERT INTO public.auditoria (
    id,
    cuenta_id,
    usuario_id,
    usuario_nombre,
    usuario_rol,
    categoria,
    accion,
    descripcion,
    entidad_tipo,
    entidad_id,
    meta,
    ip_origen
  ) VALUES (
    v_audit_id,
    p_cuenta_id,
    v_actor_id,
    COALESCE(v_actor_nombre, 'Desarrollador'),
    v_actor_rol,
    'COTIZACION'::categoria_auditoria,
    'CAMBIO_FECHA_ENTREGA',
    'Corrección auditada de la fecha efectiva de entrega del despacho',
    'nota_despacho',
    p_despacho_id,
    jsonb_build_object(
      'despacho_numero', v_despacho.numero,
      'fecha_registrada_original', v_despacho.entregada_en,
      'fecha_efectiva_anterior', v_fecha_anterior,
      'fecha_nueva', p_nueva_fecha,
      'motivo', btrim(p_motivo),
      'comision_id', v_comision_id,
      'idempotency_key', NULLIF(btrim(p_idempotency_key), ''),
      'actor_id', p_actor_id
    ),
    NULLIF(btrim(p_ip_origen), '')
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'idempotent', FALSE,
    'cambio_id', v_cambio_id,
    'auditoria_id', v_audit_id,
    'despacho_id', p_despacho_id,
    'despacho_numero', v_despacho.numero,
    'fecha_anterior', v_fecha_anterior,
    'fecha_nueva', p_nueva_fecha,
    'comision_id', v_comision_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cambiar_fecha_entrega_despacho(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_fecha_entrega_despacho(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.cambiar_fecha_entrega_despacho(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  IS 'Corrige de forma atómica la fecha efectiva de entrega en un despacho de staging/proyecto autorizado; no modifica correlativos ni historial financiero.';

NOTIFY pgrst, 'reload schema';

COMMIT;
