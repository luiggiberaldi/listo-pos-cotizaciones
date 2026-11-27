-- 308_staging_reparto_dos_deudas.sql
-- OP-2026-057 (solo STAGING) — M3: despachos con dos deudas (crédito y cobro a destino).
-- La regla de reparto de la base (cxc_reparto_cliente, usada por las devoluciones) queda igual que la de la
-- pantalla (src/utils/cxcReparto.js): un abono enlazado paga primero la deuda de su despacho del MISMO tipo
-- (metodo_pago 'cod' con 'cod'; el resto con 'cxc'), después la otra deuda del mismo despacho, y solo lo que
-- sobre pasa a los cargos más viejos. Antes pagaba solo el primer cargo del despacho.

create or replace function public.cxc_reparto_cliente(p_cliente_id uuid)
 returns table(cargo_id uuid, despacho_id uuid, monto numeric, pendiente numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  c_id    uuid[]    := array[]::uuid[];
  c_desp  uuid[]    := array[]::uuid[];
  c_met   text[]    := array[]::text[];
  c_monto numeric[] := array[]::numeric[];
  c_pend  numeric[] := array[]::numeric[];
  a_desp  uuid[]    := array[]::uuid[];
  a_met   text[]    := array[]::text[];
  a_rest  numeric[] := array[]::numeric[];
  r record;
  i int; j int; nc int; na int; pasada int;
  v_aplicar numeric;
begin
  for r in
    select x.id, x.tipo, x.despacho_id as desp, x.monto_usd,
           case when x.metodo_pago = 'cod' then 'cod' else 'cxc' end as met
    from public.cuentas_por_cobrar x
    where x.cliente_id = p_cliente_id and x.tipo in ('cargo', 'abono')
    order by x.creado_en, x.id
  loop
    if r.tipo = 'cargo' then
      c_id := c_id || r.id;
      c_desp := c_desp || r.desp;
      c_met := c_met || r.met;
      c_monto := c_monto || round(r.monto_usd, 4);
      c_pend := c_pend || round(r.monto_usd, 4);
    else
      a_desp := a_desp || r.desp;
      a_met := a_met || r.met;
      a_rest := a_rest || round(r.monto_usd, 4);
    end if;
  end loop;
  nc := coalesce(array_length(c_id, 1), 0);
  na := coalesce(array_length(a_rest, 1), 0);

  -- Fase 1: abono enlazado -> cargos de su despacho (primero el del mismo tipo, luego el otro)
  for i in 1..na loop
    if a_desp[i] is not null then
      for pasada in 1..2 loop
        for j in 1..nc loop
          exit when a_rest[i] <= 0;
          if c_desp[j] = a_desp[i] and c_pend[j] > 0
             and ((pasada = 1 and c_met[j] = a_met[i]) or (pasada = 2 and c_met[j] <> a_met[i])) then
            v_aplicar := least(c_pend[j], a_rest[i]);
            c_pend[j] := round(c_pend[j] - v_aplicar, 4);
            a_rest[i] := round(a_rest[i] - v_aplicar, 4);
          end if;
        end loop;
      end loop;
    end if;
  end loop;

  -- Fase 2: lo que sobra, del cargo mas viejo al mas nuevo
  for i in 1..na loop
    if a_rest[i] > 0 then
      for j in 1..nc loop
        if c_pend[j] > 0 then
          v_aplicar := least(c_pend[j], a_rest[i]);
          c_pend[j] := round(c_pend[j] - v_aplicar, 4);
          a_rest[i] := round(a_rest[i] - v_aplicar, 4);
        end if;
        exit when a_rest[i] <= 0;
      end loop;
    end if;
  end loop;

  for j in 1..nc loop
    cargo_id := c_id[j];
    despacho_id := c_desp[j];
    monto := c_monto[j];
    pendiente := c_pend[j];
    return next;
  end loop;
end;
$function$;
