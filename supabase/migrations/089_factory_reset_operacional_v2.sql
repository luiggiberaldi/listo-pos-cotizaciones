-- Migración 089: factory_reset_operacional v2
-- Borra todos los datos operacionales conservando:
--   clientes, usuarios, productos (inventario), transportistas, configuracion.
-- Reinicia correlativos a 200.

CREATE OR REPLACE FUNCTION public.factory_reset_operacional()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Orden seguro respetando FK constraints
  DELETE FROM comisiones;
  DELETE FROM cuentas_por_cobrar;
  DELETE FROM notas_despacho;
  DELETE FROM cotizacion_items;
  DELETE FROM cotizaciones;
  DELETE FROM inventario_movimientos;
  DELETE FROM auditoria;
  DELETE FROM system_logs;

  -- Reiniciar correlativos a 200
  ALTER SEQUENCE cotizaciones_numero_seq RESTART WITH 200;
  ALTER SEQUENCE notas_despacho_numero_seq RESTART WITH 200;

  RETURN json_build_object(
    'ok', true,
    'correlativo_inicio', 200,
    'mensaje', 'Reset completado. Clientes, usuarios, inventario y transportistas conservados.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.factory_reset_operacional() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.factory_reset_operacional() TO authenticated;
