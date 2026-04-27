-- Reiniciar correlativos a 200
CREATE OR REPLACE FUNCTION public.reiniciar_correlativos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ALTER SEQUENCE cotizaciones_numero_seq RESTART WITH 200;
  ALTER SEQUENCE notas_despacho_numero_seq RESTART WITH 200;
  -- inventario_movimientos si existe
  BEGIN
    ALTER SEQUENCE inventario_movimientos_numero_seq RESTART WITH 200;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.reiniciar_correlativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reiniciar_correlativos() TO authenticated;

-- Ejecutar inmediatamente
SELECT public.reiniciar_correlativos();
