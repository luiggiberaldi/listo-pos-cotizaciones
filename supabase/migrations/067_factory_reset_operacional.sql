-- Función factory reset operacional:
-- Borra cotizaciones, despachos, comisiones y logs, y reinicia correlativos a 200.
-- Solo supervisores pueden llamarla.
CREATE OR REPLACE FUNCTION public.factory_reset_operacional()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM comisiones;
  DELETE FROM cuentas_por_cobrar;
  DELETE FROM notas_despacho;
  DELETE FROM cotizacion_items;
  DELETE FROM cotizaciones;
  DELETE FROM auditoria;
  DELETE FROM system_logs;
  ALTER SEQUENCE cotizaciones_numero_seq RESTART WITH 200;
  ALTER SEQUENCE notas_despacho_numero_seq RESTART WITH 200;
  RETURN json_build_object('ok', true, 'correlativo_inicio', 200);
END;
$$;

REVOKE ALL ON FUNCTION public.factory_reset_operacional() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.factory_reset_operacional() TO authenticated;
