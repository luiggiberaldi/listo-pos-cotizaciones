-- Reversa OP-2026-061: la base deja de avisar los cambios de cuentas por cobrar (vuelve a como estaba).
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cuentas_por_cobrar') then
    alter publication supabase_realtime drop table public.cuentas_por_cobrar;
  end if;
end $$;
