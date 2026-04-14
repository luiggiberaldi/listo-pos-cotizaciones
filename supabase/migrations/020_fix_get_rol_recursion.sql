-- 020_fix_get_rol_recursion.sql
-- Fix: "stack depth limit exceeded" — recursión infinita en RLS
--
-- Causa: get_rol_actual() es SECURITY INVOKER, lo que hace que al consultar
-- la tabla usuarios se evalúen las políticas RLS de usuarios, que a su vez
-- llaman a get_rol_actual() creando un ciclo infinito.
--
-- Solución: cambiar a SECURITY DEFINER para que la función salte RLS
-- al consultar la tabla usuarios internamente.

CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true;
$$;
