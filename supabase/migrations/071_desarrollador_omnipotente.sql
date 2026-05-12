-- 071_desarrollador_omnipotente.sql
-- El rol 'desarrollador' debe tener los mismos permisos que 'supervisor' a nivel RLS.
-- En lugar de modificar decenas de políticas, mapeamos desarrollador → supervisor
-- dentro de get_rol_actual(). Así pasa todas las políticas que ya reconocen supervisor.

CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(
           auth.jwt()->'app_metadata'->>'operator_rol',
           (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
         ) = 'desarrollador'
    THEN 'supervisor'
    ELSE COALESCE(
           auth.jwt()->'app_metadata'->>'operator_rol',
           (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
         )
  END;
$$;
