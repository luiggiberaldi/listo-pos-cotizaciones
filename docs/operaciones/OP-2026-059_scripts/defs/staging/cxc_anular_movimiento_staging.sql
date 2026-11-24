CREATE OR REPLACE FUNCTION public.cxc_anular_movimiento_staging(p_movimiento_id uuid, p_cuenta_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_usuario_rol text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mov    record;
  v_favor  numeric;
  v_pagado numeric;
  v_accion text;
begin
  if char_length(trim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_mov from public.cuentas_por_cobrar where id = p_movimiento_id for update;
  if not found or (p_cuenta_id is not null and v_mov.cuenta_id is distinct from p_cuenta_id) then
    raise exception 'MOVIMIENTO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  perform 1 from public.clientes where id = v_mov.cliente_id for update;

  if v_mov.tipo not in ('abono', 'credito', 'devolucion_credito', 'consumo_credito') then
    raise exception 'TIPO_NO_ANULABLE' using errcode = 'P0001';
  end if;

  -- Movimientos que nacen de una devolución: se corrigen desde la devolución, no se anulan sueltos
  if (v_mov.tipo = 'abono' and (coalesce(v_mov.forma_pago_abono, '') = 'Devolución' or coalesce(v_mov.descripcion, '') ilike 'Abono por devoluci%'))
     or (v_mov.tipo = 'credito' and (coalesce(v_mov.descripcion, '') ilike 'Saldo a favor por excedente en intercambio%'
                                     or coalesce(v_mov.descripcion, '') ilike 'Saldo a favor para reembolso%'))
     or (v_mov.tipo = 'devolucion_credito' and coalesce(v_mov.descripcion, '') ilike 'Reembolso por devoluci%') then
    raise exception 'MOVIMIENTO_DE_DEVOLUCION' using errcode = 'P0001';
  end if;

  -- Un consumo de saldo a favor no se anula si el despacho ya tiene cobros
  if v_mov.tipo = 'consumo_credito' and v_mov.despacho_id is not null then
    select coalesce(sum(monto_usd), 0) into v_pagado from public.cuentas_por_cobrar
     where despacho_id = v_mov.despacho_id and tipo = 'abono';
    if v_pagado > 0 then raise exception 'CONSUMO_CONCILIADO' using errcode = 'P0001'; end if;
  end if;

  -- Un saldo a favor ya usado no se puede anular
  if v_mov.tipo = 'credito' then
    select greatest(0, coalesce(sum(case when tipo = 'credito' then monto_usd
                                         when tipo = 'abono' and forma_pago_abono = 'Saldo a favor' then -monto_usd
                                         when tipo in ('devolucion_credito', 'consumo_credito') then -monto_usd else 0 end), 0))
      into v_favor from public.cuentas_por_cobrar where cliente_id = v_mov.cliente_id;
    if v_favor < v_mov.monto_usd - 0.005 then raise exception 'CREDITO_YA_USADO' using errcode = 'P0001'; end if;
  end if;

  -- El disparador guarda la copia con estos datos
  perform set_config('cxc.motivo', trim(p_motivo), true);
  perform set_config('cxc.usuario_id', p_usuario_id::text, true);
  perform set_config('cxc.usuario_nombre', coalesce(p_usuario_nombre, ''), true);
  perform set_config('cxc.origen', 'anular_movimiento', true);
  delete from public.cuentas_por_cobrar where id = p_movimiento_id;

  v_accion := case v_mov.tipo when 'credito' then 'REVERTIR_CREDITO' when 'devolucion_credito' then 'REVERTIR_DEVOLUCION_CREDITO'
                              when 'consumo_credito' then 'REVERTIR_CONSUMO_CREDITO' else 'REVERTIR_ABONO' end;
  insert into public.auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
  values (p_usuario_id, p_usuario_nombre, p_usuario_rol, 'FINANZAS', v_accion,
          format('%s de $%s anulado. Motivo: %s', v_mov.tipo, round(v_mov.monto_usd, 2), trim(p_motivo)),
          'cliente', v_mov.cliente_id,
          jsonb_build_object('abonoId', v_mov.id, 'monto', v_mov.monto_usd, 'tipo', v_mov.tipo,
                             'forma_pago', v_mov.forma_pago_abono, 'referencia', v_mov.referencia,
                             'despacho_id', v_mov.despacho_id, 'motivo', trim(p_motivo), 'copia', to_jsonb(v_mov), 'atomico', true));

  return jsonb_build_object('ok', true, 'tipo', v_mov.tipo, 'monto', v_mov.monto_usd, 'cliente_id', v_mov.cliente_id);
end;
$function$
