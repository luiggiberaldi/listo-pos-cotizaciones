-- 305_despacho_pagos_al_reabrir_anular.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)
-- OP-2026-059: versión para producción de la migración de staging 304_staging_despacho_pagos_al_reabrir_anular.sql (OP-2026-052).
-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de
-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: 305_despacho_pagos_al_reabrir_anular_rollback.sql
--
-- Cambio respecto de staging: reabrir_despacho_con_pagos llama a la reversión de PRODUCCIÓN,
-- revertir_entrega_finanzas_idempotente(cuenta, despacho, clave, ...), en vez de la de staging
-- (revertir_entrega_finanzas_atomica_staging, que no existe en producción). La cuenta se toma del propio
-- despacho. Si la reversión es una repetición (misma clave), se devuelve el resultado guardado sin volver a
-- anotar en la auditoría. La clave (p_idempotency_key) es obligatoria, igual que hoy en producción.
--
-- ── Texto de staging, adaptado (nombres sin "_staging") ──

begin;
-- OP-2026-052  — G2 y N1: reabrir o anular un despacho ya no hace desaparecer pagos.
--
-- 1) cxc_pagos_en_juego_despacho(despacho): dice qué dinero está en juego antes de reabrir o anular:
--      - pagos anotados en la forma de pago del despacho (efectivo, Zelle, USDT…; no crédito, cobro a destino,
--        donación, saldo a favor ni préstamo);
--      - abonos reales enlazados al despacho;
--      - cuánto quedaría como "pagado de más" si se borra su deuda (pagos sueltos que la cubrían).
-- 2) reabrir_despacho_con_pagos: reabre (entregada → pendiente/despachada) en UNA transacción:
--      desenlaza los abonos reales (no se borran), y según la decisión deja el sobrante en la cuenta
--      ("mantener", se vuelve a aplicar al entregar de nuevo) o lo pasa a saldo a favor ("saldo_favor");
--      después llama a la reversión de siempre y anota todo en la auditoría.
-- 3) anular_despacho_con_pagos: anula un despacho pendiente con pagos anotados, con decisión
--      obligatoria: "saldo_favor" (crea saldo a favor por cada pago), "otro_despacho" (se anotará en el
--      despacho que lo reemplaza) o "no_cobrado" (con motivo). Todo queda en la auditoría.

create or replace function public.cxc_es_pago_real(p_metodo text)
returns boolean language sql immutable as $$
  select coalesce(lower(trim(p_metodo)), '') not in
    ('', 'cta por cobrar', 'cobro a destino', 'donación', 'donacion', 'saldo a favor', 'crédito', 'credito', 'préstamo', 'prestamo')
$$;

create or replace function public.cxc_pagos_en_juego_despacho(p_despacho_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
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
$$;

create or replace function public.reabrir_despacho_con_pagos(
  p_despacho_id     uuid,
  p_nuevo_estado    text,
  p_usuario_id      uuid,
  p_usuario_nombre  text,
  p_usuario_rol     text,
  p_usuario_color   text    default null,
  p_idempotency_key uuid    default null,
  p_destino_pagos   text    default null,   -- 'mantener' | 'saldo_favor'
  p_motivo          text    default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
  v_cuenta     uuid;
begin
  -- Turno: despacho y cliente bloqueados durante toda la operación
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_OBLIGATORIA' using errcode = 'P0001';
  end if;
  select cuenta_id into v_cuenta from public.notas_despacho where id = p_despacho_id for update;
  if not found then raise exception 'DESPACHO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
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
  v_res := public.revertir_entrega_finanzas_idempotente(v_cuenta, p_despacho_id, p_idempotency_key, p_nuevo_estado,
                                                       p_usuario_id, p_usuario_nombre, p_usuario_color);
  -- Repetición de una reversión ya hecha (misma clave): no se vuelve a anotar nada
  if coalesce((v_res->>'idempotent')::boolean, false) then
    return v_res;
  end if;

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
$$;

create or replace function public.anular_despacho_con_pagos(
  p_despacho_id     uuid,
  p_usuario_id      uuid,
  p_usuario_nombre  text,
  p_usuario_rol     text,
  p_destino         text,     -- 'saldo_favor' | 'otro_despacho' | 'no_cobrado'
  p_motivo          text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

revoke all on function public.cxc_pagos_en_juego_despacho(uuid) from public, anon, authenticated;
revoke all on function public.reabrir_despacho_con_pagos(uuid, text, uuid, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.anular_despacho_con_pagos(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.cxc_pagos_en_juego_despacho(uuid) to service_role;
grant execute on function public.reabrir_despacho_con_pagos(uuid, text, uuid, text, text, text, uuid, text, text) to service_role;
grant execute on function public.anular_despacho_con_pagos(uuid, uuid, text, text, text, text) to service_role;
revoke all on function public.cxc_es_pago_real(text) from public, anon, authenticated;
grant execute on function public.cxc_es_pago_real(text) to service_role;

notify pgrst, 'reload schema';

commit;
