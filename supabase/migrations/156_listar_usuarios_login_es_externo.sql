-- 156_listar_usuarios_login_es_externo.sql
-- Redefine listar_usuarios_login para incluir la columna es_externo

DROP FUNCTION IF EXISTS public.listar_usuarios_login();

CREATE OR REPLACE FUNCTION public.listar_usuarios_login()
  RETURNS TABLE(id uuid, nombre text, rol text, color text, imagen_url text, markup_pct numeric, es_externo boolean)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::text AS imagen_url, u.markup_pct, u.es_externo
  FROM public.usuarios u
  WHERE u.activo = true
    AND u.nombre <> 'Super Admin'
    AND u.cuenta_id = auth.uid()
  ORDER BY u.nombre;
$$;

GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO anon, authenticated;
