CREATE OR REPLACE FUNCTION public.cxc_pagos_en_juego_despacho(p_despacho_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d        record;
  v_cliente  uuid;
  v_fp       jsonb;
  v_anotados jsonb;
  v_total_anotado numeric;
  v_enlazados jsonb;
  v_total_enlazado numeric;
  v_a numeric; v_c numeric; v_cd numeric; v_aj numeric;
  v_exceso_actual numeric; v_exceso_despues numeric;
begin
  select id, numero, estado, cliente_id, cliente_factura_id, forma_pago into v_d
    from public.notas_despacho where id = p_despacho_id;
  if not found then raise exception 'DESPACHO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  v_cliente := coalesce(v_d.cliente_factura_id, v_d.cliente_id);

  begin
    v_fp := case when v_d.forma_pago is null or v_d.forma_pago = '' then '[]'::jsonb else v_d.forma_pago::jsonb end;
  exception when others then v_fp := '[]'::jsonb;
  end;
  if jsonb_typeof(v_fp) <> 'array' then v_fp := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object('metodo', f->>'metodo', 'monto', round((f->>'monto')::numeric, 2),
                                               'referencia', nullif(f->>'referencia', ''))), '[]'::jsonb),
         coalesce(sum(round((f->>'monto')::numeric, 2)), 0)
    into v_anotados, v_total_anotado
    from jsonb_array_elements(v_fp) f
   where public.cxc_es_pago_real(f->>'metodo')
     and coalesce(nullif(f->>'monto', ''), '0') ~ '^-?[0-9]+(\.[0-9]+)?$'
     and (f->>'monto')::numeric > 0;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'monto', monto_usd, 'forma_pago', forma_pago_abono,
                                               'referencia', referencia, 'creado_en', creado_en) order by creado_en), '[]'::jsonb),
         coalesce(sum(monto_usd), 0)
    into v_enlazados, v_total_enlazado
    from public.cuentas_por_cobrar
   where despacho_id = p_despacho_id and tipo = 'abono'
     and coalesce(forma_pago_abono, '') not in ('Saldo a favor', 'Devolución');

  -- "Pagado de más" que aparecería si se borran la deuda del despacho y sus ajustes de devolución
  select coalesce(sum(monto_usd) filter (where tipo = 'abono'), 0),
         coalesce(sum(monto_usd) filter (where tipo = 'cargo'), 0),
         coalesce(sum(monto_usd) filter (where tipo = 'cargo' and despacho_id = p_despacho_id), 0),
         coalesce(sum(monto_usd) filter (where tipo = 'abono' and despacho_id = p_despacho_id
                                          and coalesce(forma_pago_abono, '') in ('Saldo a favor', 'Devolución')), 0)
    into v_a, v_c, v_cd, v_aj
    from public.cuentas_por_cobrar
   where cliente_id = v_cliente and tipo in ('cargo', 'abono');
  v_exceso_actual  := greatest(0, v_a - v_c);
  v_exceso_despues := greatest(0, (v_a - v_aj) - (v_c - v_cd));

  return jsonb_build_object(
    'despacho_id', v_d.id, 'numero', v_d.numero, 'estado', v_d.estado, 'cliente_id', v_cliente,
    'pagos_anotados', v_anotados, 'total_anotado', round(v_total_anotado, 2),
    'abonos_enlazados', v_enlazados, 'total_enlazado', round(v_total_enlazado, 2),
    'deuda_despacho', round(v_cd, 2),
    'pagado_de_mas_nuevo', round(greatest(0, v_exceso_despues - v_exceso_actual), 2),
    'requiere_decision_reabrir', (v_d.estado = 'entregada' and (v_total_enlazado > 0.005 or (v_exceso_despues - v_exceso_actual) > 0.005)),
    'requiere_decision_anular', (v_d.estado = 'pendiente' and v_total_anotado > 0.005)
  );
end;
$function$
