-- ============================================================================
-- 320_auditoria_camaras_fase1_rollback.sql
-- Reversión exacta de 320_auditoria_camaras_fase1.sql (OP-2026-110)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tabla TEXT;
  v_tablas TEXT[] := ARRAY[
    'notas_despacho', 'notas_despacho_items', 'cotizaciones',
    'cuentas_por_cobrar', 'clientes', 'productos',
    'inventario_movimientos', 'comisiones', 'usuarios',
    'transportistas', 'pagos_transportistas', 'vehiculos',
    'cuentas_por_pagar', 'proveedores', 'configuracion_negocio',
    'despacho_devoluciones', 'despacho_descuentos'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_tablas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_camara ON public.%I;', v_tabla);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.registrar_cambio_auditoria();
DROP TABLE IF EXISTS public.auditoria_cambios;

COMMIT;
