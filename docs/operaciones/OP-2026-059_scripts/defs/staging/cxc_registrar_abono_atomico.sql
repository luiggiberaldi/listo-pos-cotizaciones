CREATE OR REPLACE FUNCTION public.cxc_registrar_abono_atomico(p_cliente_id uuid, p_monto numeric, p_forma_pago text, p_referencia text, p_descripcion text, p_despacho_id uuid, p_registrado_por uuid, p_usuario_nombre text, p_usuario_rol text, p_idempotency_key text DEFAULT NULL::text, p_confirmar_duplicado boolean DEFAULT false, p_ip text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta  uuid;
  v_prev    record;
  v_igual   record;
  v_saldo   numeric;
  v_monto   numeric := round(p_monto, 4);
  v_nuevo   numeric;
  v_id      uuid;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;

  -- Turno por cliente: cualquier otro abono a este cliente espera aquí hasta que este termine.
  select cuenta_id into v_cuenta from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  -- Huella de la operación: si ya existe, es un reintento o doble clic → devolver el ya guardado.
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, cliente_id, saldo_usd into v_prev
      from public.cuentas_por_cobrar
     where cuenta_id is not distinct from v_cuenta and idempotency_key = p_idempotency_key
     limit 1;
    if found then
      if v_prev.cliente_id <> p_cliente_id then
        raise exception 'CLAVE_DE_OTRO_CLIENTE' using errcode = 'P0001';
      end if;
      return jsonb_build_object('id', v_prev.id, 'nuevo_saldo', v_prev.saldo_usd, 'idempotent', true);
    end if;
  end if;

  -- Abono igual (mismo cliente y monto) en los últimos 15 minutos → preguntar antes de guardar.
  if not coalesce(p_confirmar_duplicado, false) then
    select id, creado_en, referencia into v_igual
      from public.cuentas_por_cobrar
     where cliente_id = p_cliente_id and tipo = 'abono'
       and round(monto_usd, 2) = round(p_monto, 2)
       and creado_en >= now() - interval '15 minutes'
     order by creado_en desc
     limit 1;
    if found then
      return jsonb_build_object('posible_duplicado', jsonb_build_object(
        'id', v_igual.id, 'creado_en', v_igual.creado_en, 'referencia', v_igual.referencia));
    end if;
  end if;

  -- Deuda real del cliente (misma fórmula que el disparador trg_recalcular_saldo_pendiente).
  select greatest(0, coalesce(sum(case when tipo = 'cargo' then monto_usd
                                       when tipo = 'abono' then -monto_usd else 0 end), 0))
    into v_saldo
    from public.cuentas_por_cobrar
   where cliente_id = p_cliente_id;

  if round(v_monto, 2) = round(v_saldo, 2) then
    v_monto := v_saldo;                       -- salda exacto, sin residuos de centavos
  elsif v_monto > v_saldo then
    if v_monto - v_saldo < 0.015 then
      v_monto := v_saldo;
    else
      raise exception 'MONTO_SUPERA_SALDO:%', round(v_saldo, 2) using errcode = 'P0001';
    end if;
  end if;
  if v_monto <= 0 then
    raise exception 'MONTO_SUPERA_SALDO:%', round(v_saldo, 2) using errcode = 'P0001';
  end if;

  v_nuevo := greatest(0, round(v_saldo - v_monto, 4));

  insert into public.cuentas_por_cobrar (
    cliente_id, despacho_id, tipo, monto_usd, forma_pago_abono, referencia,
    saldo_usd, descripcion, registrado_por, idempotency_key
  ) values (
    p_cliente_id, p_despacho_id, 'abono', v_monto, p_forma_pago, p_referencia,
    v_nuevo, coalesce(nullif(p_descripcion, ''), 'Abono recibido'), p_registrado_por,
    nullif(p_idempotency_key, '')
  ) returning id into v_id;

  -- Anotación de auditoría en el MISMO paso: si no se puede anotar, el abono tampoco se guarda.
  insert into public.auditoria (
    usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion,
    entidad_tipo, entidad_id, meta, ip_origen
  ) values (
    p_registrado_por, p_usuario_nombre, p_usuario_rol, 'FINANZAS', 'REGISTRAR_ABONO',
    format('Abono de $%s registrado para cliente %s', round(v_monto, 2), p_cliente_id),
    'cliente', p_cliente_id,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
      'abono_id', v_id, 'monto', v_monto, 'forma_pago', p_forma_pago, 'referencia', p_referencia,
      'despacho_id', p_despacho_id, 'saldo_anterior', v_saldo, 'saldo_nuevo', v_nuevo,
      'idempotency_key', nullif(p_idempotency_key, ''), 'atomico', true),
    p_ip
  );

  return jsonb_build_object('id', v_id, 'nuevo_saldo', v_nuevo, 'saldo_anterior', v_saldo,
                            'monto', v_monto, 'idempotent', false);
end;
$function$
