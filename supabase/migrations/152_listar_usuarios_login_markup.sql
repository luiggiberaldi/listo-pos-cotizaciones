-- 152: Agregar markup_pct a listar_usuarios_login
-- Permite identificar vendedores externos en la pantalla de login

DROP FUNCTION IF EXISTS public.listar_usuarios_login();

CREATE FUNCTION public.listar_usuarios_login()
  RETURNS TABLE(id uuid, nombre text, rol text, color text, imagen_url text, markup_pct numeric)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::text AS imagen_url, u.markup_pct
  FROM public.usuarios u
  WHERE u.activo = true
    AND u.nombre <> 'Super Admin'
    AND u.cuenta_id = auth.uid()
  ORDER BY u.nombre;
$$;

GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO anon, authenticated;
