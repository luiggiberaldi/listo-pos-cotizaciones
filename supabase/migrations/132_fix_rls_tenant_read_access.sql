-- 132_fix_rls_tenant_read_access.sql
-- Permite lectura de datos de la empresa (cuenta_id = auth.uid()) para usuarios autenticados
-- y añade soporte para extraer operador desde request.headers o app_metadata.

-- 1. Actualizar helper functions para leer también de request.headers si app_metadata no está presente
CREATE OR REPLACE FUNCTION public.get_operador_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt()->'app_metadata'->>'operator_id')::uuid,
    nullif(current_setting('request.headers', true)::json->>'x-operator-id', '')::uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.jwt()->'app_metadata'->>'operator_rol',
    nullif(current_setting('request.headers', true)::json->>'x-operator-rol', ''),
    (SELECT rol FROM public.usuarios WHERE id = public.get_operador_id() AND activo = true),
    'administracion'
  );
$$;

-- 2. Asegurar que las lecturas autenticadas dentro del tenant estén permitidas
DROP POLICY IF EXISTS despachos_authenticated_select ON public.notas_despacho;
CREATE POLICY despachos_authenticated_select ON public.notas_despacho
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS cotizaciones_authenticated_select ON public.cotizaciones;
CREATE POLICY cotizaciones_authenticated_select ON public.cotizaciones
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS clientes_authenticated_select ON public.clientes;
CREATE POLICY clientes_authenticated_select ON public.clientes
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS productos_authenticated_select ON public.productos;
CREATE POLICY productos_authenticated_select ON public.productos
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());
