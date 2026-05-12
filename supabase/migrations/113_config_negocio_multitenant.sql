-- 113_config_negocio_multitenant_fix_v3.sql
-- Solución definitiva eliminando la columna ID serial para evitar conflictos de PKEY globales.
-- En un sistema multi-tenant, la clave primaria natural es el cuenta_id.

-- 1. Eliminar registros huérfanos o con cuenta_id nulo si los hay (excepto el original si queremos conservarlo)
DELETE FROM public.configuracion_negocio WHERE cuenta_id IS NULL AND id <> 1;

-- 2. Asegurarse de que cuenta_id tenga el CONSTRAINT UNIQUE
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configuracion_negocio_cuenta_id_key') THEN
        ALTER TABLE public.configuracion_negocio ADD CONSTRAINT configuracion_negocio_cuenta_id_key UNIQUE (cuenta_id);
    END IF;
END $$;

-- 3. Insertar configuraciones faltantes. 
-- IMPORTANTÍSIMO: No incluimos la columna 'id' para que use el default (serial) sin chocar con el 1.
INSERT INTO public.configuracion_negocio (
  cuenta_id, nombre_negocio, moneda_principal, 
  validez_cotizacion_dias, iva_pct, comision_pct_cabilla, 
  comision_pct_otros, comision_categoria_cabilla
)
SELECT id, 'Mi Negocio', 'USD', 7, 16.00, 5.00, 3.00, 'cemento'
FROM public.usuarios u
WHERE NOT EXISTS (
  SELECT 1 FROM public.configuracion_negocio cn WHERE cn.cuenta_id = u.id
)
ON CONFLICT (cuenta_id) DO NOTHING;

-- 4. Trigger de automatización
CREATE OR REPLACE FUNCTION public.crear_configuracion_por_defecto()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.configuracion_negocio (cuenta_id, nombre_negocio)
  VALUES (NEW.id, 'Mi Negocio')
  ON CONFLICT (cuenta_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crear_config_usuario ON public.usuarios;
CREATE TRIGGER trg_crear_config_usuario
  AFTER INSERT ON public.usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.crear_configuracion_por_defecto();
