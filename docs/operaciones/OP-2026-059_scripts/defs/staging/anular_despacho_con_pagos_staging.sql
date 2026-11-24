CREATE OR REPLACE FUNCTION public.anular_despacho_con_pagos_staging(p_despacho_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_usuario_rol text, p_destino text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_juego   jsonb;
  v_cliente uuid;
  v_numero  integer;
  v_pago    jsonb;
  v_creados jsonb := '[]'::jsonb;
  v_id      uuid;
begin
  perform 1 from public.notas_despacho where id = p_despacho_id for update;
  v_juego := public.cxc_pagos_en_juego_despacho(p_despacho_id);
  if v_juego->>'estado' <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO: solo se anula un despacho pendiente' using errcode = 'P0001';
  end if;
  v_cliente := (v_juego->>'cliente_id')::uuid;
  v_numero  := (v_juego->>'numero')::integer;
  if coalesce(p_destino, '') not in ('saldo_favor', 'otro_despacho', 'no_cobrado') then
    raise exception 'DECISION_PAGOS_REQUERIDA' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  perform 1 from public.clientes where id = v_cliente for update;

  if p_destino = 'saldo_favor' then
    for v_pago in select * from jsonb_array_elements(v_juego->'pagos_anotados') loop
      insert into public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia,
                                             descripcion, registrado_por)
      values (v_cliente, 'credito', (v_pago->>'monto')::numeric, 0, v_pago->>'metodo', v_pago->>'referencia',
              left(format('Pago anotado en despacho #%s anulado: pasa a saldo a favor', v_numero), 500), p_usuario_id)
      returning id into v_id;
      v_creados := v_creados || jsonb_build_array(v_pago || jsonb_build_object('credito_id', v_id));
    end loop;
  end if;

  update public.notas_despacho set estado = 'anulada', motivo_anulacion = p_motivo where id = p_despacho_id;

  insert into public.auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion,
                                entidad_tipo, entidad_id, meta)
  values (p_usuario_id, p_usuario_nombre, p_usuario_rol, 'FINANZAS', 'ANULAR_DESPACHO_PAGOS',
          format('Despacho #%s anulado con $%s en pagos anotados: %s', v_numero, v_juego->>'total_anotado',
                 case p_destino when 'saldo_favor' then 'pasan a saldo a favor del cliente'
                                when 'otro_despacho' then 'se anotarán en el despacho que lo reemplaza'
                                else 'nunca se cobraron' end),
          'nota_despacho', p_despacho_id,
          jsonb_build_object('destino', p_destino, 'motivo', p_motivo, 'pagos_anotados', v_juego->'pagos_anotados',
                             'total_anotado', v_juego->'total_anotado', 'creditos_creados', v_creados, 'cliente_id', v_cliente));

  return jsonb_build_object('ok', true, 'destino', p_destino, 'total_anotado', v_juego->'total_anotado',
                            'creditos_creados', jsonb_array_length(v_creados));
end;
$function$
