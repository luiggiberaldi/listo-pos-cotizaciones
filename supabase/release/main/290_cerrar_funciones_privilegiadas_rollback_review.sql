-- 290_cerrar_funciones_privilegiadas_rollback_review.sql — REVERSA de la 290 (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/290_staging_cerrar_funciones_privilegiadas_rollback.sql

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 290 solo si hace falta volver atrás'; END $$;

-- 290_staging_cerrar_funciones_privilegiadas_rollback.sql
-- Devuelve el acceso que tenían esas 9 funciones (anon / authenticated / PUBLIC). No toca datos.

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
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.firma);
  END LOOP;
END $$;

COMMIT;
