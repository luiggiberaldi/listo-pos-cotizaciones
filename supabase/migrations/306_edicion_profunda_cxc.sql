-- 306_edicion_profunda_cxc.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)
-- OP-2026-059: versión para producción de la migración de staging 305_staging_edicion_profunda_cxc.sql (OP-2026-053).
-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de
-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: 306_edicion_profunda_cxc_rollback.sql
--
-- Llama a editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text), que es IDÉNTICA en
-- staging y producción (comparado el 2026-11-24).
-- Cambio respecto de staging: cuando la edición CREA una deuda nueva (crédito o cobro a destino),
-- se guarda su fecha de vencimiento (hoy + días indicados en la forma de pago), como hacía el
-- servidor de producción hasta ahora (staging la había omitido).
--
-- ── Texto de staging, adaptado (nombres sin "_staging") ──

begin;
-- OP-2026-053  — G2, parte de la edición profunda.
--
-- Antes, al editar un despacho aprobado ("despachada"), el servidor ajustaba la cuenta del cliente en pasos
-- sueltos y sin auditoría, y:
--   - borraba CUALQUIER crédito del despacho si no había "vuelto a favor" (también los saldos a favor de una
--     devolución o un intercambio);
--   - si la deuda bajaba o desaparecía y el cliente ya había abonado, ese pago quedaba "pagado de más" sin aviso;
--   - podía crear un consumo de saldo a favor mayor que el saldo disponible.
--
-- editar_despacho_profundidad_con_cxc hace TODO en una transacción:
--   1. edita los artículos (función de siempre, editar_despacho_profundidad);
--   2. ajusta SOLO los movimientos propios del despacho:
--        cargos (crédito / cobro a destino), consumo de saldo a favor ("Pago con Saldo a Favor…")
--        y crédito por vuelto ("Excedente de pago en Despacho…").
--      Créditos de devolución/intercambio, abonos de devolución y abonos reales NO se tocan;
--   3. si quedarían pagos del cliente sin deuda, exige decisión: 'mantener' o 'saldo_favor';
--   4. no deja usar más saldo a favor del disponible ni quitar un vuelto que el cliente ya gastó;
--   5. anota en la auditoría el antes y el después (EDICION_PROFUNDA_CXC).
-- Si algo falla, nada se guarda (tampoco los artículos).

create or replace function public.cxc_num(p text)
returns numeric language sql immutable as $$
  select case when coalesce(p, '') ~ '^-?[0-9]+(\.[0-9]+)?$' then p::numeric else 0 end
$$;

create or replace function public.editar_despacho_profundidad_con_cxc(
  p_despacho_id    uuid,
  p_nuevos_items   jsonb,
  p_usuario_id     uuid,
  p_usuario_nombre text,
  p_usuario_rol    text,
  p_forma_pago     text default null,
  p_destino_pagos  text default null    -- 'mantener' | 'saldo_favor' (solo si quedan pagos sin deuda)
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_d        record;
  v_cliente  uuid;
  v_fp_txt   text;
  v_fp       jsonb;
  v_cxc      numeric := 0;
  v_cod      numeric := 0;
  v_sf       numeric := 0;
  v_sf_origen text;
  v_total_asig numeric := 0;
  v_vuelto_flag boolean := false;
  v_vuelto   numeric := 0;
  v_antes    jsonb;
  v_despues  jsonb;
  v_e0       numeric := 0;
  v_e1       numeric := 0;
  v_delta    numeric := 0;
  v_favor    numeric := 0;
  v_met      text;
  v_target   numeric;
  v_row      record;
  v_reclasif jsonb := '[]'::jsonb;
  v_falta    numeric;
  v_parte    numeric;
  v_ab       record;
  v_dias_cxc integer;
  v_dias_cod integer;
begin
  -- Turno: despacho y cliente bloqueados
  select id, cliente_id, cliente_factura_id, cotizacion_id into v_d from public.notas_despacho where id = p_despacho_id for update;
  if not found then raise exception 'DESPACHO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  v_cliente := coalesce(v_d.cliente_factura_id, v_d.cliente_id,
                        (select cliente_id from public.cotizaciones where id = v_d.cotizacion_id));
  if v_cliente is not null then
    perform 1 from public.clientes where id = v_cliente for update;
    select greatest(0, coalesce(sum(case when tipo = 'abono' then monto_usd when tipo = 'cargo' then -monto_usd else 0 end), 0))
      into v_e0 from public.cuentas_por_cobrar where cliente_id = v_cliente and tipo in ('cargo', 'abono');
  end if;

  -- 1) Artículos (función de siempre)
  perform public.editar_despacho_profundidad(p_despacho_id, p_nuevos_items, p_usuario_id, p_usuario_nombre, p_usuario_rol, p_forma_pago);

  select estado, numero, total_usd, forma_pago, forma_pago_cliente into v_d from public.notas_despacho where id = p_despacho_id;
  if v_d.estado <> 'despachada' or v_cliente is null then
    return jsonb_build_object('ok', true, 'cxc_sincronizada', false);
  end if;

  -- 2) Lo que pide la forma de pago nueva
  v_fp_txt := coalesce(nullif(v_d.forma_pago_cliente, ''), v_d.forma_pago, '[]');
  begin v_fp := v_fp_txt::jsonb; exception when others then v_fp := null; end;
  if v_fp is null or jsonb_typeof(v_fp) <> 'array' then
    if trim(v_fp_txt) = 'Cta por cobrar' then v_cxc := v_d.total_usd; end if;
    v_fp := '[]'::jsonb;
  end if;
  select coalesce(sum(public.cxc_num(f->>'monto')) filter (where f->>'metodo' = 'Cta por cobrar'), v_cxc),
         coalesce(sum(public.cxc_num(f->>'monto')) filter (where f->>'metodo' = 'Cobro a destino'), 0),
         coalesce(sum(public.cxc_num(f->>'monto')) filter (where lower(f->>'metodo') = 'saldo a favor'), 0),
         max(f->>'forma_pago_origen') filter (where lower(f->>'metodo') = 'saldo a favor'),
         coalesce(sum(public.cxc_num(f->>'monto')), 0),
         coalesce(bool_or((f->>'vuelto_a_favor')::boolean) filter (where f ? 'vuelto_a_favor'), false)
    into v_cxc, v_cod, v_sf, v_sf_origen, v_total_asig, v_vuelto_flag
    from jsonb_array_elements(v_fp) f;
  -- Días de vencimiento indicados en la forma de pago (para la fecha de una deuda nueva)
  select max(public.cxc_num(f->>'diasVencimiento')) filter (where f->>'metodo' = 'Cta por cobrar'),
         max(public.cxc_num(f->>'diasVencimiento')) filter (where f->>'metodo' = 'Cobro a destino')
    into v_dias_cxc, v_dias_cod
    from jsonb_array_elements(v_fp) f;
  v_vuelto := case when v_vuelto_flag and v_total_asig - v_d.total_usd > 0.015 then round(v_total_asig - v_d.total_usd, 2) else 0 end;

  select coalesce(jsonb_agg(to_jsonb(c.*) order by c.creado_en), '[]'::jsonb) into v_antes
    from public.cuentas_por_cobrar c where c.despacho_id = p_despacho_id;

  -- Saldo a favor disponible (misma fórmula que el disparador)
  select greatest(0, coalesce(sum(case when tipo = 'credito' then monto_usd
                                       when tipo = 'abono' and forma_pago_abono = 'Saldo a favor' then -monto_usd
                                       when tipo in ('devolucion_credito', 'consumo_credito') then -monto_usd else 0 end), 0))
    into v_favor from public.cuentas_por_cobrar where cliente_id = v_cliente;

  -- 2a) Cargos propios (crédito y cobro a destino)
  foreach v_met in array array['cxc', 'cod'] loop
    v_target := case v_met when 'cxc' then v_cxc else v_cod end;
    select * into v_row from public.cuentas_por_cobrar
     where despacho_id = p_despacho_id and tipo = 'cargo' and metodo_pago = v_met order by creado_en limit 1;
    if found then
      if v_target <= 0.005 then
        delete from public.cuentas_por_cobrar where id = v_row.id;
      elsif abs(v_target - v_row.monto_usd) > 0.00005 then
        update public.cuentas_por_cobrar set monto_usd = round(v_target, 4) where id = v_row.id;
      end if;
    elsif v_target > 0.005 then
      insert into public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por, metodo_pago, fecha_vencimiento)
      values (v_cliente, p_despacho_id, 'cargo', round(v_target, 4), round(v_target, 4),
              format('Orden de despacho #%s%s (Creado en edición profunda)', v_d.numero, case v_met when 'cxc' then ' (Crédito)' else ' (COD)' end),
              p_usuario_id, v_met,
              case when coalesce(case v_met when 'cxc' then v_dias_cxc else v_dias_cod end, 0) > 0
                   then current_date + (case v_met when 'cxc' then v_dias_cxc else v_dias_cod end) end);
    end if;
  end loop;

  -- 2b) Consumo de saldo a favor propio ("Pago con Saldo a Favor…")
  select * into v_row from public.cuentas_por_cobrar
   where despacho_id = p_despacho_id and descripcion ilike 'Pago con Saldo a Favor%'
     and (tipo = 'consumo_credito' or (tipo = 'abono' and forma_pago_abono = 'Saldo a favor'))
   order by creado_en limit 1;
  if found then
    if v_sf - v_row.monto_usd > v_favor + 0.005 then
      raise exception 'SALDO_FAVOR_INSUFICIENTE:%', round(v_favor + v_row.monto_usd, 2) using errcode = 'P0001';
    end if;
    if v_sf <= 0.005 then
      delete from public.cuentas_por_cobrar where id = v_row.id;
    elsif abs(v_sf - v_row.monto_usd) > 0.00005 then
      update public.cuentas_por_cobrar set monto_usd = round(v_sf, 4) where id = v_row.id;
    end if;
  elsif v_sf > 0.005 then
    if v_sf > v_favor + 0.005 then
      raise exception 'SALDO_FAVOR_INSUFICIENTE:%', round(v_favor, 2) using errcode = 'P0001';
    end if;
    insert into public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por)
    values (v_cliente, p_despacho_id, 'consumo_credito', round(v_sf, 4), greatest(0, round(v_favor - v_sf, 4)), 'Saldo a favor',
            format('Despacho #%s', v_d.numero),
            format('Pago con Saldo a Favor (%s) (Creado en edición profunda)', upper(coalesce(v_sf_origen, 'Crédito'))), p_usuario_id);
  end if;

  -- 2c) Crédito propio por vuelto ("Excedente de pago en Despacho…")
  select greatest(0, coalesce(sum(case when tipo = 'credito' then monto_usd
                                       when tipo = 'abono' and forma_pago_abono = 'Saldo a favor' then -monto_usd
                                       when tipo in ('devolucion_credito', 'consumo_credito') then -monto_usd else 0 end), 0))
    into v_favor from public.cuentas_por_cobrar where cliente_id = v_cliente;
  select * into v_row from public.cuentas_por_cobrar
   where despacho_id = p_despacho_id and tipo = 'credito' and descripcion ilike 'Excedente de pago en Despacho%'
   order by creado_en limit 1;
  if found then
    if v_row.monto_usd - v_vuelto > v_favor + 0.005 then
      raise exception 'VUELTO_YA_USADO:%', round(v_favor, 2) using errcode = 'P0001';
    end if;
    if v_vuelto <= 0.015 then
      delete from public.cuentas_por_cobrar where id = v_row.id;
    elsif abs(v_vuelto - v_row.monto_usd) > 0.00005 then
      update public.cuentas_por_cobrar set monto_usd = round(v_vuelto, 4) where id = v_row.id;
    end if;
  elsif v_vuelto > 0.015 then
    insert into public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, referencia, descripcion, registrado_por)
    values (v_cliente, p_despacho_id, 'credito', v_vuelto, 0, format('Despacho #%s', v_d.numero),
            format('Excedente de pago en Despacho #%s (Creado en edición profunda)', v_d.numero), p_usuario_id);
  end if;

  -- 3) ¿Quedan pagos del cliente sin deuda?
  select greatest(0, coalesce(sum(case when tipo = 'abono' then monto_usd when tipo = 'cargo' then -monto_usd else 0 end), 0))
    into v_e1 from public.cuentas_por_cobrar where cliente_id = v_cliente and tipo in ('cargo', 'abono');
  v_delta := round(greatest(0, v_e1 - v_e0), 2);
  if v_delta > 0.005 then
    if coalesce(p_destino_pagos, '') not in ('mantener', 'saldo_favor') then
      raise exception 'DECISION_PAGOS_REQUERIDA:%', v_delta using errcode = 'P0001';
    end if;
    if p_destino_pagos = 'saldo_favor' then
      v_falta := v_delta;
      for v_ab in
        select * from public.cuentas_por_cobrar
         where cliente_id = v_cliente and tipo = 'abono'
           and coalesce(forma_pago_abono, '') not in ('Saldo a favor', 'Devolución')
         order by (despacho_id = p_despacho_id) desc nulls last, creado_en desc, id desc
      loop
        exit when v_falta <= 0.005;
        v_parte := least(v_ab.monto_usd, v_falta);
        v_reclasif := v_reclasif || jsonb_build_array(jsonb_build_object('original', to_jsonb(v_ab), 'pasado_a_saldo_favor', v_parte));
        if v_parte >= v_ab.monto_usd - 0.00005 then
          update public.cuentas_por_cobrar
             set tipo = 'credito', despacho_id = null,
                 descripcion = left(coalesce(descripcion, '') || format(' [pasado a saldo a favor al editar despacho #%s]', v_d.numero), 500)
           where id = v_ab.id;
        else
          update public.cuentas_por_cobrar set monto_usd = round(monto_usd - v_parte, 4) where id = v_ab.id;
          insert into public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por, creado_en)
          values (v_cliente, 'credito', v_parte, 0, v_ab.forma_pago_abono, v_ab.referencia,
                  left(format('Parte de un pago (%s) pasada a saldo a favor al editar despacho #%s', coalesce(v_ab.descripcion, 'abono'), v_d.numero), 500),
                  p_usuario_id, v_ab.creado_en);
        end if;
        v_falta := round(v_falta - v_parte, 4);
      end loop;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(c.*) order by c.creado_en), '[]'::jsonb) into v_despues
    from public.cuentas_por_cobrar c where c.despacho_id = p_despacho_id;

  -- 4) Auditoría (solo si cambió algo de dinero)
  if v_antes is distinct from v_despues or v_delta > 0.005 then
    insert into public.auditoria (usuario_id, usuario_nombre, usuario_rol, categoria, accion, descripcion, entidad_tipo, entidad_id, meta)
    values (p_usuario_id, p_usuario_nombre, p_usuario_rol, 'FINANZAS', 'EDICION_PROFUNDA_CXC',
            format('Edición profunda del despacho #%s: cuenta del cliente ajustada%s', v_d.numero,
                   case when v_delta > 0.005 then format('; $%s de pagos sin deuda: %s', v_delta,
                        case p_destino_pagos when 'saldo_favor' then 'pasados a saldo a favor' else 'se quedan en la cuenta' end) else '' end),
            'nota_despacho', p_despacho_id,
            jsonb_build_object('antes', v_antes, 'despues', v_despues,
                               'objetivo', jsonb_build_object('credito', v_cxc, 'cobro_destino', v_cod, 'saldo_favor', v_sf, 'vuelto', v_vuelto),
                               'pagado_de_mas_nuevo', v_delta, 'destino_pagos', p_destino_pagos,
                               'reclasificados_a_saldo_favor', v_reclasif, 'cliente_id', v_cliente));
  end if;

  return jsonb_build_object('ok', true, 'cxc_sincronizada', true, 'pagado_de_mas_nuevo', v_delta,
                            'destino_pagos', p_destino_pagos,
                            'pasado_a_saldo_favor', (select coalesce(sum((x->>'pasado_a_saldo_favor')::numeric), 0) from jsonb_array_elements(v_reclasif) x));
end;
$$;

revoke all on function public.editar_despacho_profundidad_con_cxc(uuid, jsonb, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.editar_despacho_profundidad_con_cxc(uuid, jsonb, uuid, text, text, text, text) to service_role;
revoke all on function public.cxc_num(text) from public, anon, authenticated;
grant execute on function public.cxc_num(text) to service_role;

notify pgrst, 'reload schema';

commit;
