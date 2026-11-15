-- OP-2026-026 — Recalcular comisiones del sábado 14-nov-2026 (designado: Edgar Ramírez)
-- Pegar TODO en Supabase → SQL Editor (proyecto de PRODUCCIÓN) y pulsar "Run".
-- Seguridad:
--   * Si no hay designado guardado para el 14-nov, se detiene sin tocar nada.
--   * Si alguna comisión ya está pagada, se detiene sin tocar nada.
--   * Todo va en un solo bloque: si algo falla, no queda nada a medias.
--   * La herramienta de recálculo nunca toca comisiones pagadas.
-- Resultado: una tabla con el antes y el después por despacho y por vendedor.

drop table if exists op026_antes, op026_despues;

begin;

-- 1) Guardas
do $$
begin
  if not exists (
    select 1 from public.comision_designacion_diaria d
    join public.usuarios u on u.id = d.designado_id
    where d.fecha = date '2026-11-14' and u.nombre ilike 'Edgar Ram%'
  ) then
    raise exception 'ALTO: no hay designación de Edgar Ramírez para el 2026-11-14. No se cambió nada.';
  end if;

  if exists (
    select 1 from public.comisiones c
    join public.notas_despacho n on n.id = c.despachoid
    where n.numero::text in ('4747','4748','4749','4750','4752','4753','4754','4756','4757','4758','4759')
      and (n.creado_en at time zone 'America/Caracas')::date = date '2026-11-14'
      and (c.estado = 'pagada' or coalesce(c.montopagado, 0) > 0.01)
  ) then
    raise exception 'ALTO: hay comisiones ya pagadas en estos despachos. No se cambió nada.';
  end if;
end $$;

-- 2) Foto de ANTES
create temp table op026_antes as
select n.numero::text as despacho, c.vendedorid, c.totalcomision
from public.comisiones c
join public.notas_despacho n on n.id = c.despachoid
where n.numero::text in ('4747','4748','4749','4750','4752','4753','4754','4756','4757','4758','4759')
  and (n.creado_en at time zone 'America/Caracas')::date = date '2026-11-14';

-- 3) Recálculo
select public.recalcularcomisiondespacho_238b(n.id)
from public.notas_despacho n
where n.numero::text in ('4747','4748','4749','4750','4752','4753','4754','4756','4757','4758','4759')
  and (n.creado_en at time zone 'America/Caracas')::date = date '2026-11-14';

-- 4) Foto de DESPUÉS + comparación
create temp table op026_despues as
select n.numero::text as despacho, c.vendedorid, c.totalcomision
from public.comisiones c
join public.notas_despacho n on n.id = c.despachoid
where n.numero::text in ('4747','4748','4749','4750','4752','4753','4754','4756','4757','4758','4759')
  and (n.creado_en at time zone 'America/Caracas')::date = date '2026-11-14';

commit;

-- 5) Tabla para revisar (y copiar en el documento OP-2026-026)
select coalesce(a.despacho, d.despacho)                    as despacho,
       u.nombre                                            as vendedor,
       a.totalcomision                                     as antes_usd,
       d.totalcomision                                     as despues_usd,
       coalesce(d.totalcomision,0) - coalesce(a.totalcomision,0) as diferencia_usd
from op026_antes a
full join op026_despues d on d.despacho = a.despacho and d.vendedorid = a.vendedorid
left join public.usuarios u on u.id = coalesce(a.vendedorid, d.vendedorid)
order by 1, 2;
