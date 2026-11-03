-- 292_permisos_tablas_sin_truncate_apply.sql — ETAPA B: authenticated sin TRUNCATE/REFERENCES/TRIGGER (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/292_staging_permisos_tablas_sin_truncate.sql
-- No toca datos. Reversa: 292_permisos_tablas_sin_truncate_rollback_review.sql

-- 292_staging_permisos_tablas_sin_truncate.sql  (Etapa B de la auditoría de permisos de tablas)
-- Quita a "authenticated" (la sesión del navegador) los permisos TRUNCATE, REFERENCES y TRIGGER en 24 tablas.
-- La app nunca los usa: TRUNCATE vacía una tabla entera y NO lo frenan las reglas de fila (RLS).
-- SELECT / INSERT / UPDATE / DELETE no se tocan (siguen protegidos por RLS). No toca datos.
-- Rollback: 292_staging_permisos_tablas_sin_truncate_rollback.sql

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria','buzon_sugerencias','cliente_prestamos','clientes','comision_designacion_diaria','comision_liberaciones','configuracion_negocio','cotizacion_items','cotizaciones','cuentas_por_pagar','despacho_descuentos','notas_despacho','notas_despacho_items','orden_compra_items','ordenes_compra','pagos_transportistas','pagos_transportistas_despachos','proveedores','reasignaciones_clientes','seguimiento_operativo','system_log_analysis','system_logs','transportistas','usuarios'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
