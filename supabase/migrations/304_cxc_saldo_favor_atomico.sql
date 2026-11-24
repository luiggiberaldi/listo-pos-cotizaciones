-- 304_cxc_saldo_favor_atomico.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)
-- OP-2026-059: versión para producción de la migración de staging 303_staging_cxc_saldo_favor_atomico.sql (OP-2026-051).
-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de
-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: 304_cxc_saldo_favor_atomico_rollback.sql
--
-- ── Texto de staging, adaptado (nombres sin "_staging") ──

begin;
-- OP-2026-051 
--
-- "Cargar saldo a favor", "Devolver saldo a favor" y "Cruzar saldo a favor contra deuda" en UN SOLO PASO
-- dentro de la base, igual que el abono (migración 302):
--   - turno por cliente (bloqueo de su fila): dos operaciones al mismo cliente se hacen una detrás de otra;
--   - saldo a favor y deuda se calculan y se comparan dentro del mismo turno;
--   - huella única por operación (reintentos y doble clic no duplican);
--   - aviso de movimiento igual en los últimos 15 minutos (carga y devolución);
--   - el movimiento y su anotación de auditoría se guardan juntos: o quedan los dos o ninguno.
--
-- p_operacion: 'credito' (cargar saldo a favor) | 'devolucion_credito' (devolver) | 'cruce' (cruzar contra deuda)

create or replace function public.cxc_saldo_favor_atomico(
  p_operacion           text,
  p_cliente_id          uuid,
  p_monto               numeric,
  p_forma_pago          text,
  p_referencia          text,
  p_descripcion         text,
  p_registrado_por      uuid,
  p_usuario_nombre      text,
  p_usuario_rol         text,
  p_idempotency_key     text    default null,
  p_confirmar_duplicado boolean default false,
  p_ip                  text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta   uuid;
  v_prev     record;
  v_igual    record;
  v_favor    numeric;
  v_deuda    numeric;
  v_monto    numeric := round(p_monto, 4);
  v_tipo     text;
  v_forma    text := p_forma_pago;
  v_ref      text := p_referencia;
  v_desc     text;
  v_saldo_fila numeric;
  v_favor_nuevo numeric;
  v_deuda_nueva numeric;
  v_accion   text;
  v_id       uuid;
begin
  if p_operacion not in ('credito', 'devolucion_credito', 'cruce') then
    raise exception 'OPERACION_INVALIDA' using errcode = 'P0001';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;

  -- Turno por cliente
  select cuenta_id into v_cuenta from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  v_tipo := case p_operacion when 'cruce' then 'abono' else p_operacion end;

  -- Huella de la operación: reintento o doble clic → devolver lo ya guardado
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, cliente_id, tipo into v_prev
      from public.cuentas_por_cobrar
     where cuenta_id is not distinct from v_cuenta and idempotency_key = p_idempotency_key
     limit 1;
    if found then
      if v_prev.cliente_id <> p_cliente_id or v_prev.tipo <> v_tipo then
        raise exception 'CLAVE_DE_OTRO_MOVIMIENTO' using errcode = 'P0001';
      end if;
      select saldo_pendiente, saldo_a_favor into v_deuda, v_favor from public.clientes where id = p_cliente_id;
      return jsonb_build_object('id', v_prev.id, 'nuevo_saldo_favor', v_favor, 'nuevo_saldo_pendiente', v_deuda, 'idempotent', true);
    end if;
  end if;

  -- Movimiento igual reciente (solo carga y devolución: entran o salen de caja)
  if p_operacion <> 'cruce' and not coalesce(p_confirmar_duplicado, false) then
    select id, creado_en, referencia into v_igual
      from public.cuentas_por_cobrar
     where cliente_id = p_cliente_id and tipo = v_tipo
       and round(monto_usd, 2) = round(p_monto, 2)
       and creado_en >= now() - interval '15 minutes'
     order by creado_en desc
     limit 1;
    if found then
      return jsonb_build_object('posible_duplicado', jsonb_build_object(
        'id', v_igual.id, 'creado_en', v_igual.creado_en, 'referencia', v_igual.referencia));
    end if;
  end if;

  -- Saldos reales (misma fórmula que el disparador trg_recalcular_saldo_pendiente)
  select greatest(0, coalesce(sum(case when tipo = 'cargo' then monto_usd
                                       when tipo = 'abono' then -monto_usd else 0 end), 0)),
         greatest(0, coalesce(sum(case when tipo = 'credito' then monto_usd
                                       when tipo = 'abono' and forma_pago_abono = 'Saldo a favor' then -monto_usd
                                       when tipo in ('devolucion_credito', 'consumo_credito') then -monto_usd
                                       else 0 end), 0))
    into v_deuda, v_favor
    from public.cuentas_por_cobrar
   where cliente_id = p_cliente_id;

  if p_operacion = 'credito' then
    v_favor_nuevo := round(v_favor + v_monto, 4);
    v_deuda_nueva := v_deuda;
    v_saldo_fila  := v_favor_nuevo;
    v_desc   := coalesce(nullif(p_descripcion, ''), 'Saldo a favor registrado');
    v_accion := 'REGISTRAR_SALDO_FAVOR';

  elsif p_operacion = 'devolucion_credito' then
    if v_favor <= 0 then
      raise exception 'SIN_SALDO_FAVOR' using errcode = 'P0001';
    end if;
    if abs(v_monto - v_favor) < 0.015 then
      v_monto := v_favor;
    elsif v_monto > v_favor then
      raise exception 'MONTO_SUPERA_SALDO_FAVOR:%', round(v_favor, 2) using errcode = 'P0001';
    end if;
    v_favor_nuevo := greatest(0, round(v_favor - v_monto, 4));
    v_deuda_nueva := v_deuda;
    v_saldo_fila  := v_favor_nuevo;
    v_desc   := coalesce(nullif(p_descripcion, ''), 'Devolución de saldo a favor registrada');
    v_accion := 'REGISTRAR_DEVOLUCION_CREDITO';

  else -- cruce
    if v_favor <= 0 then
      raise exception 'SIN_SALDO_FAVOR' using errcode = 'P0001';
    end if;
    if v_deuda <= 0 then
      raise exception 'SIN_DEUDA' using errcode = 'P0001';
    end if;
    if v_monto > v_favor then
      if v_monto - v_favor < 0.015 then v_monto := v_favor;
      else raise exception 'MONTO_SUPERA_SALDO_FAVOR:%', round(v_favor, 2) using errcode = 'P0001'; end if;
    end if;
    if v_monto > v_deuda then
      if v_monto - v_deuda < 0.015 then v_monto := v_deuda;
      else raise exception 'MONTO_SUPERA_SALDO:%', round(v_deuda, 2) using errcode = 'P0001'; end if;
    end if;
    v_favor_nuevo := greatest(0, round(v_favor - v_monto, 4));
    v_deuda_nueva := greatest(0, round(v_deuda - v_monto, 4));
    v_saldo_fila  := v_deuda_nueva;
    v_forma  := 'Saldo a favor';
    v_ref    := coalesce(nullif(p_referencia, ''), 'Cruce interno');
    v_desc   := coalesce(nullif(p_descripcion, ''), 'Cruce de saldo a favor contra deuda');
    v_accion := 'CRUZAR_SALDO_FAVOR';
  end if;

  insert into public.cuentas_por_cobrar (
    cliente_id, tipo, monto_usd, forma_pago_abono, referencia, saldo_usd, descripcion,
    registrado_por, idempotency_key
  ) values (
    p_cliente_id, v_tipo, v_monto, v_forma, v_ref, v_saldo_fila, v_desc,
    p_registrado_por, nullif(p_idempotency_key, '')
  ) returning id into v_id;

  -- Anotación de auditoría en el MISMO paso
  insert into public.auditoria (
    usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion,
    entidad_tipo, entidad_id, meta, ip_origen
  ) values (
    p_registrado_por, p_usuario_nombre, p_usuario_rol, 'FINANZAS', v_accion,
    format('%s de $%s para cliente %s',
           case p_operacion when 'credito' then 'Saldo a favor' when 'devolucion_credito' then 'Devolución de saldo a favor' else 'Cruce de saldo a favor' end,
           round(v_monto, 2), p_cliente_id),
    'cliente', p_cliente_id,
    jsonb_build_object(
      'movimiento_id', v_id, 'operacion', p_operacion, 'monto', v_monto,
      'forma_pago', v_forma, 'referencia', v_ref, 'descripcion', v_desc,
      'saldo_favor_anterior', v_favor, 'saldo_favor_nuevo', v_favor_nuevo,
      'saldo_pendiente_anterior', v_deuda, 'saldo_pendiente_nuevo', v_deuda_nueva,
      'idempotency_key', nullif(p_idempotency_key, ''), 'atomico', true),
    p_ip
  );

  return jsonb_build_object('id', v_id, 'monto', v_monto,
                            'nuevo_saldo_favor', v_favor_nuevo, 'nuevo_saldo_pendiente', v_deuda_nueva,
                            'idempotent', false);
end;
$$;

revoke all on function public.cxc_saldo_favor_atomico(text, uuid, numeric, text, text, text, uuid, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.cxc_saldo_favor_atomico(text, uuid, numeric, text, text, text, uuid, text, text, text, boolean, text) to service_role;

notify pgrst, 'reload schema';

commit;
