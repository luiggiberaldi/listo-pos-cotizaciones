CREATE OR REPLACE FUNCTION public.devolucion_con_donacion_staging(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_devoluciones jsonb, p_intercambios jsonb, p_motivo text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text, p_total_devuelto_usd numeric, p_total_intercambio_usd numeric, p_reemplazo jsonb, p_pagos_diferencia jsonb, p_destino_saldo text, p_pagos_reembolso jsonb, p_anular_abono_id uuid, p_usuario_rol text, p_total_devuelto_real numeric, p_valor_donado numeric, p_fraccion_donada numeric, p_acreditar_donacion boolean DEFAULT false, p_motivo_donacion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res    jsonb;
  v_d      record;
begin
  v_res := public.registrar_devolucion_parcial_cobro_idempotente(
    p_cuenta_id, p_despacho_id, p_idempotency_key, p_devoluciones, p_intercambios, p_motivo,
    p_usuario_id, p_usuario_nombre, p_usuario_color, null, p_total_devuelto_usd, p_total_intercambio_usd,
    p_reemplazo, p_pagos_diferencia, p_destino_saldo, p_pagos_reembolso, p_anular_abono_id);

  -- Repetición de una devolución ya registrada: no se vuelve a ajustar nada
  if coalesce(v_res->>'idempotent', 'false') = 'true' or coalesce(p_fraccion_donada, 0) <= 0 then
    return v_res;
  end if;

  select id, numero, total_usd, forma_pago, forma_pago_cliente into v_d from public.notas_despacho where id = p_despacho_id for update;

  if coalesce(p_valor_donado, 0) > 0.005 then
    update public.notas_despacho
       set total_usd = greatest(0, round(total_usd - p_valor_donado, 4)),
           forma_pago = public.cxc_restar_donacion_fp(forma_pago, p_valor_donado),
           forma_pago_cliente = public.cxc_restar_donacion_fp(forma_pago_cliente, p_valor_donado)
     where id = p_despacho_id;
  end if;

  insert into public.auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
  values (p_usuario_id, p_usuario_nombre, p_usuario_rol, 'FINANZAS',
          case when p_acreditar_donacion then 'DEVOLUCION_DONACION_ACREDITADA' else 'DEVOLUCION_DONACION_SIN_CREDITO' end,
          case when p_acreditar_donacion
               then format('Devolución de mercancía donada en despacho #%s: se AUTORIZÓ dar crédito por $%s. Motivo: %s', v_d.numero, round(p_total_devuelto_real, 2), p_motivo_donacion)
               else format('Devolución de mercancía donada en despacho #%s: $%s volvieron al inventario sin dar crédito (parte donada %s%%)', v_d.numero, round(p_valor_donado, 2), round(p_fraccion_donada * 100, 1)) end,
          'nota_despacho', p_despacho_id,
          jsonb_build_object('total_devuelto_real', p_total_devuelto_real, 'total_acreditado', p_total_devuelto_usd,
                             'valor_donado_sin_credito', p_valor_donado, 'fraccion_donada', p_fraccion_donada,
                             'autorizado', p_acreditar_donacion, 'motivo_autorizacion', p_motivo_donacion,
                             'total_despacho_antes', v_d.total_usd, 'forma_pago_antes', v_d.forma_pago,
                             'idempotency_key', p_idempotency_key));

  return v_res || jsonb_build_object('donacion', jsonb_build_object(
    'fraccion', p_fraccion_donada, 'valor_sin_credito', p_valor_donado, 'autorizado', p_acreditar_donacion));
end;
$function$
