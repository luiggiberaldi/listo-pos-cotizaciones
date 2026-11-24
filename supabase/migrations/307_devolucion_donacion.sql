-- 307_devolucion_donacion.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)
-- OP-2026-059: versión para producción de la migración de staging 306_staging_devolucion_donacion.sql (OP-2026-054).
-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de
-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: 307_devolucion_donacion_rollback.sql
--
-- Necesita 301 (usa la firma de 17 parámetros de registrar_devolucion_parcial_cobro_idempotente).
--
-- ── Texto de staging, adaptado (nombres sin "_staging") ──

begin;
-- OP-2026-054  — N2: devolver mercancía DONADA no da crédito ni reembolso.
--
-- devolucion_con_donacion envuelve la devolución de siempre (registrar_devolucion_parcial_cobro_idempotente)
-- en la MISMA transacción:
--   - el Worker le pasa como "total devuelto" solo la parte que da crédito (la donada no cuenta como dinero);
--   - los artículos se registran con su valor real (para saber qué volvió al inventario);
--   - después, el total del despacho y el monto "Donación" de su forma de pago bajan en la parte donada devuelta;
--   - todo queda en la auditoría: DEVOLUCION_DONACION_SIN_CREDITO, o DEVOLUCION_DONACION_ACREDITADA si un
--     administrador autorizó dar crédito (con motivo).

create or replace function public.cxc_restar_donacion_fp(p_fp text, p_monto numeric)
returns text language plpgsql immutable as $$
declare
  v_fp jsonb; v_out jsonb := '[]'::jsonb; v_el jsonb; v_rest numeric := p_monto; v_m numeric; v_quita numeric;
begin
  if p_fp is null or p_monto is null or p_monto <= 0 then return p_fp; end if;
  begin v_fp := p_fp::jsonb; exception when others then return p_fp; end;
  if jsonb_typeof(v_fp) <> 'array' then return p_fp; end if;
  for v_el in select * from jsonb_array_elements(v_fp) loop
    if lower(trim(coalesce(v_el->>'metodo', ''))) in ('donación', 'donacion') and v_rest > 0 then
      v_m := public.cxc_num(v_el->>'monto');
      v_quita := least(v_m, v_rest);
      v_el := jsonb_set(v_el, '{monto}', to_jsonb(round(v_m - v_quita, 2)));
      v_rest := v_rest - v_quita;
    end if;
    v_out := v_out || jsonb_build_array(v_el);
  end loop;
  return v_out::text;
end;
$$;

create or replace function public.devolucion_con_donacion(
  p_cuenta_id              uuid,
  p_despacho_id            uuid,
  p_idempotency_key        uuid,
  p_devoluciones           jsonb,
  p_intercambios           jsonb,
  p_motivo                 text,
  p_usuario_id             uuid,
  p_usuario_nombre         text,
  p_usuario_color          text,
  p_total_devuelto_usd     numeric,   -- solo la parte que da crédito
  p_total_intercambio_usd  numeric,
  p_reemplazo              jsonb,
  p_pagos_diferencia       jsonb,
  p_destino_saldo          text,
  p_pagos_reembolso        jsonb,
  p_anular_abono_id        uuid,
  p_usuario_rol            text,
  p_total_devuelto_real    numeric,   -- valor real de lo devuelto
  p_valor_donado           numeric,   -- parte donada que NO da crédito (0 si se autorizó)
  p_fraccion_donada        numeric,
  p_acreditar_donacion     boolean default false,
  p_motivo_donacion        text    default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

revoke all on function public.devolucion_con_donacion(uuid, uuid, uuid, jsonb, jsonb, text, uuid, text, text, numeric, numeric, jsonb, jsonb, text, jsonb, uuid, text, numeric, numeric, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.devolucion_con_donacion(uuid, uuid, uuid, jsonb, jsonb, text, uuid, text, text, numeric, numeric, jsonb, jsonb, text, jsonb, uuid, text, numeric, numeric, numeric, boolean, text) to service_role;
revoke all on function public.cxc_restar_donacion_fp(text, numeric) from public, anon, authenticated;
grant execute on function public.cxc_restar_donacion_fp(text, numeric) to service_role;

notify pgrst, 'reload schema';

commit;
