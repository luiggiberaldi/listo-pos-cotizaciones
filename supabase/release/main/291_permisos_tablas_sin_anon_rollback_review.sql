-- 291_permisos_tablas_sin_anon_rollback_review.sql — REVERSA de la 291 (PRODUCCIÓN).

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 291 solo si hace falta volver atrás'; END $$;

-- 291_staging_permisos_tablas_sin_anon_rollback.sql
-- Devuelve a "anon" los permisos que tenía (los de Supabase por defecto). No toca datos.

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria','buzon_sugerencias','cliente_prestamos','clientes','comision_designacion_diaria','comision_liberaciones','configuracion_negocio','cotizacion_items','cotizaciones','cuentas_por_pagar','despacho_descuentos','notas_despacho','notas_despacho_items','orden_compra_items','ordenes_compra','pagos_transportistas','pagos_transportistas_despachos','proveedores','reasignaciones_clientes','seguimiento_operativo','system_log_analysis','system_logs','transportistas','usuarios'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO anon', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
