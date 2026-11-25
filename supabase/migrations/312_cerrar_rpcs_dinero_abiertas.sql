-- 312_cerrar_rpcs_dinero_abiertas.sql — PRODUCCIÓN (INC-004)
-- Cierra dos funciones de dinero que se podían ejecutar sin sesión y sin control
-- de quién llama. Ningún código del proyecto las usa (búsqueda en origin/main).
-- Permisos antes (2026-11-25), en ambas:
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Rollback: 312_cerrar_rpcs_dinero_abiertas_rollback.sql
BEGIN;
REVOKE ALL ON FUNCTION public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_pago_comision(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_pago_comision(uuid, uuid, uuid) TO service_role;
COMMIT;
