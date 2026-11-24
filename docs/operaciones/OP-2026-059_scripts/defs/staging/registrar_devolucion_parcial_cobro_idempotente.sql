CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_devoluciones jsonb, p_intercambios jsonb DEFAULT '[]'::jsonb, p_motivo text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid, p_total_devuelto_usd numeric DEFAULT 0, p_total_intercambio_usd numeric DEFAULT 0, p_reemplazo jsonb DEFAULT NULL::jsonb, p_pagos_diferencia jsonb DEFAULT NULL::jsonb, p_destino_saldo text DEFAULT 'saldo_a_favor'::text, p_pagos_reembolso jsonb DEFAULT NULL::jsonb, p_anular_abono_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    p_pagos_diferencia,
    p_destino_saldo,
    p_pagos_reembolso,
    p_anular_abono_id
  );
END;
$function$
