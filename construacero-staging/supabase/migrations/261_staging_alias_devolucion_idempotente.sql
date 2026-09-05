-- 261_staging_alias_devolucion_idempotente.sql
-- Habilita el nombre canónico registrar_devolucion_parcial_cobro_idempotente en staging

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
BEGIN
  RETURN public.registrar_devolucion_parcial_cobro_staging(
    p_cuenta_id,
    p_despacho_id,
    p_idempotency_key,
    p_devoluciones,
    p_intercambios,
    p_motivo,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color,
    p_cotizacion_reemplazo_id,
    p_total_devuelto_usd,
    p_total_intercambio_usd,
    p_reemplazo,
    p_pagos_diferencia
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(
  UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(
  UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
