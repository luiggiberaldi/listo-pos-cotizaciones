-- 291_staging_permisos_tablas_sin_anon.sql  (Etapa A de la auditoría de permisos de tablas)
-- Quita TODO permiso de tabla a "anon" (la llave pública, sin sesión) en 24 tablas del esquema público.
-- El navegador siempre entra con la sesión de la cuenta (authenticated); anon solo llama a funciones de login.
-- Hasta hoy la única barrera eran las reglas de fila (RLS). No toca datos.
-- Rollback: 291_staging_permisos_tablas_sin_anon_rollback.sql

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria','buzon_sugerencias','cliente_prestamos','clientes','comision_designacion_diaria','comision_liberaciones','configuracion_negocio','cotizacion_items','cotizaciones','cuentas_por_pagar','despacho_descuentos','notas_despacho','notas_despacho_items','orden_compra_items','ordenes_compra','pagos_transportistas','pagos_transportistas_despachos','proveedores','reasignaciones_clientes','seguimiento_operativo','system_log_analysis','system_logs','transportistas','usuarios'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
