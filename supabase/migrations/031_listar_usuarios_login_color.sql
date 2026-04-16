-- Agrega campo color al retorno de listar_usuarios_login
DROP FUNCTION IF EXISTS public.listar_usuarios_login();
CREATE FUNCTION public.listar_usuarios_login()
  RETURNS TABLE(id uuid, nombre text, rol text, email text, color text)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public', 'auth'
AS $$
  SELECT u.id, u.nombre, u.rol, au.email, u.color
  FROM public.usuarios u
  JOIN auth.users au ON au.id = u.id
  WHERE u.activo = true
  ORDER BY u.nombre;
$$;
