CREATE OR REPLACE FUNCTION public.reabrir_despacho_con_pagos_staging(p_despacho_id uuid, p_nuevo_estado text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_rol text, p_usuario_color text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_destino_pagos text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_juego      jsonb;
  v_cliente    uuid;
  v_numero     integer;
  v_desenlazados jsonb := '[]'::jsonb;
  v_reclasif   jsonb := '[]'::jsonb;
  v_falta      numeric;
  v_ab         record;
  v_parte      numeric;
  v_res        jsonb;
begin
  -- Turno: despacho y cliente bloqueados durante toda la operación
  perform 1 from public.notas_despacho where id = p_despacho_id for update;
  v_juego   := public.cxc_pagos_en_juego_despacho(p_despacho_id);
  v_cliente := (v_juego->>'cliente_id')::uuid;
  v_numero  := (v_juego->>'numero')::integer;
  perform 1 from public.clientes where id = v_cliente for update;
  v_juego   := public.cxc_pagos_en_juego_despacho(p_despacho_id);  -- recalculado dentro del turno

  if (v_juego->>'requiere_decision_reabrir')::boolean then
    if coalesce(p_destino_pagos, '') not in ('mantener', 'saldo_favor') then
      raise exception 'DECISION_PAGOS_REQUERIDA' using errcode = 'P0001';
    end if;

    -- 1) Los abonos reales enlazados NO se borran: quedan como pagos del cliente sin despacho
    select coalesce(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb) into v_desenlazados
      from public.cuentas_por_cobrar c
     where c.despacho_id = p_despacho_id and c.tipo = 'abono'
       and coalesce(c.forma_pago_abono, '') not in ('Saldo a favor', 'Devolución');
    update public.cuentas_por_cobrar
       set despacho_id = null,
           descripcion = left(coalesce(descripcion, '') || format(' [despacho #%s reabierto]', v_numero), 500)
     where despacho_id = p_despacho_id and tipo = 'abono'
       and coalesce(forma_pago_abono, '') not in ('Saldo a favor', 'Devolución');

    -- 2) Si se eligió saldo a favor, el sobrante pasa de "abono" a "saldo a favor" (de los pagos sueltos más recientes)
    v_falta := (v_juego->>'pagado_de_mas_nuevo')::numeric;
    if p_destino_pagos = 'saldo_favor' and v_falta > 0.005 then
      for v_ab in
        select * from public.cuentas_por_cobrar
         where cliente_id = v_cliente and tipo = 'abono' and despacho_id is null
           and coalesce(forma_pago_abono, '') not in ('Saldo a favor', 'Devolución')
         order by creado_en desc, id desc
      loop
        exit when v_falta <= 0.005;
        v_parte := least(v_ab.monto_usd, v_falta);
        v_reclasif := v_reclasif || jsonb_build_array(jsonb_build_object('original', to_jsonb(v_ab), 'pasado_a_saldo_favor', v_parte));
        if v_parte >= v_ab.monto_usd - 0.00005 then
          update public.cuentas_por_cobrar
             set tipo = 'credito',
                 descripcion = left(coalesce(descripcion, '') || format(' [pasado a saldo a favor al reabrir despacho #%s]', v_numero), 500)
           where id = v_ab.id;
        else
          update public.cuentas_por_cobrar set monto_usd = round(monto_usd - v_parte, 4) where id = v_ab.id;
          insert into public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia,
                                                 descripcion, registrado_por, creado_en)
          values (v_cliente, 'credito', v_parte, 0, v_ab.forma_pago_abono, v_ab.referencia,
                  left(format('Parte de un pago (%s) pasada a saldo a favor al reabrir despacho #%s', coalesce(v_ab.descripcion, 'abono'), v_numero), 500),
                  p_usuario_id, v_ab.creado_en);
        end if;
        v_falta := round(v_falta - v_parte, 4);
      end loop;
    end if;
  end if;

  -- 3) Reversión de siempre (inventario, deuda y ajustes del despacho, comisión), en la misma transacción
  v_res := public.revertir_entrega_finanzas_atomica_staging(p_despacho_id, p_nuevo_estado, p_usuario_id,
                                                           p_usuario_nombre, p_usuario_color, p_idempotency_key);

  -- 4) Auditoría en el mismo paso
  insert into public.auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion,
                                entidad_tipo, entidad_id, meta)
  values (p_usuario_id, p_usuario_nombre, p_usuario_rol, 'FINANZAS', 'REABRIR_DESPACHO_PAGOS',
          format('Despacho #%s reabierto (%s). Pagos: %s', v_numero, p_nuevo_estado,
                 case when (v_juego->>'requiere_decision_reabrir')::boolean
                      then case p_destino_pagos when 'saldo_favor' then 'pasados a saldo a favor' else 'se quedan en la cuenta del cliente' end
                      else 'no había pagos en juego' end),
          'nota_despacho', p_despacho_id,
          jsonb_build_object('destino_pagos', p_destino_pagos, 'motivo', p_motivo, 'en_juego', v_juego,
                             'abonos_desenlazados', v_desenlazados, 'reclasificados_a_saldo_favor', v_reclasif,
                             'cliente_id', v_cliente, 'nuevo_estado', p_nuevo_estado));

  return v_res || jsonb_build_object('pagos', jsonb_build_object(
    'destino', p_destino_pagos, 'abonos_desenlazados', jsonb_array_length(v_desenlazados),
    'pasado_a_saldo_favor', (select coalesce(sum((x->>'pasado_a_saldo_favor')::numeric), 0) from jsonb_array_elements(v_reclasif) x),
    'pagado_de_mas_nuevo', v_juego->'pagado_de_mas_nuevo'));
end;
$function$
