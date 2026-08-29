-- 253_staging_service_role_grants.sql
-- Otorga a service_role los privilegios DML sobre las tablas de esquema
-- staging creadas por 241/246/247/250. Esas migraciones revocaron
-- PUBLIC/authenticated pero no otorgaron a service_role, y el Worker consulta
-- directamente inventario_operaciones_staging para el replay guard.
-- Patrón espejo de inventario_operaciones (DML completo a service_role).

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.inventario_operaciones_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.kardex_reconciliaciones_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.kardex_provenance_backfills_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.despacho_fecha_entrega_cambios TO service_role;

NOTIFY pgrst, 'reload schema';
