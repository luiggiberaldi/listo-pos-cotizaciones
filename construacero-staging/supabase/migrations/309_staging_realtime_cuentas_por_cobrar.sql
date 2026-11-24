-- OP-2026-061: que la base avise a las pantallas abiertas cuando cambia un abono o un cargo
-- (cuentas por cobrar), para que la ficha y la deuda del cliente se actualicen solas sin recargar.
-- Las pantallas solo reciben los movimientos que ya tienen permiso de ver (mismas reglas de acceso).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cuentas_por_cobrar') then
    alter publication supabase_realtime add table public.cuentas_por_cobrar;
  end if;
end $$;
