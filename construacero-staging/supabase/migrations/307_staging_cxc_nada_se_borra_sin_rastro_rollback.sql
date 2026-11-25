-- Reversa de 307 (solo STAGING). OJO: borrar la tabla elimina el archivo de movimientos borrados;
-- exportarla antes si tiene datos que interesen.
drop function if exists public.cxc_anular_movimiento_staging(uuid, uuid, uuid, text, text, text);
drop trigger if exists trg_archivar_cxc_borrado on public.cuentas_por_cobrar;
drop function if exists public.trg_archivar_cxc_borrado();
drop table if exists public.cxc_movimientos_borrados;
