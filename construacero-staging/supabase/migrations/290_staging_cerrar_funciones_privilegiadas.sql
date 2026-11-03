-- 290_staging_cerrar_funciones_privilegiadas.sql
-- 9 funciones privilegiadas (SECURITY DEFINER) podían ejecutarse con la llave pública, sin sesión,
-- y NO verifican quién las llama (a diferencia de las demás, que sí comprueban el rol del operador):
--   factory_reset_operacional  -> BORRA datos operativos de una cuenta (hay que conocer su UUID)
--   purgar_logs_antiguos, reiniciar_correlativos, registrar_auditoria, sincronizar_prestamos_despacho,
--   calcular_comision_despacho / calcularcomisiondespacho, registrar_devolucion_parcial_atomica, debug_comision_mixto
-- Solo las usa el Worker (service_role) y otras funciones SECURITY DEFINER (corren como dueño: no se afectan).
-- El navegador no las llama (revisado en src/). No toca datos.
-- Rollback: 290_staging_cerrar_funciones_privilegiadas_rollback.sql

BEGIN;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('factory_reset_operacional','purgar_logs_antiguos','debug_comision_mixto','reiniciar_correlativos','registrar_auditoria','sincronizar_prestamos_despacho','calcular_comision_despacho','calcularcomisiondespacho','registrar_devolucion_parcial_atomica')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.firma);
  END LOOP;
END $$;

COMMIT;
