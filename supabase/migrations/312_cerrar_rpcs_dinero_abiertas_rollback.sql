-- Rollback de 312_cerrar_rpcs_dinero_abiertas.sql: devuelve los permisos exactos de antes.
-- ¡Vuelve a abrir el riesgo de INC-004! Usar solo en emergencia.
BEGIN;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid, uuid, numeric, text, uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_comision(uuid, uuid, uuid) TO PUBLIC, anon, authenticated;
COMMIT;
