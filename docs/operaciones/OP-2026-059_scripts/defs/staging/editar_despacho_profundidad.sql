CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(p_despacho_id uuid, p_nuevos_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
BEGIN
  -- Overload legacy unificado (release 17): resuelve el operador por auth.uid()
  -- y delega al cuerpo canónico.
  PERFORM public.editar_despacho_profundidad(
    p_despacho_id,
    p_nuevos_items,
    v_usuario_id,
    COALESCE((SELECT nombre FROM public.usuarios WHERE id = v_usuario_id), 'Sistema'),
    COALESCE((SELECT rol FROM public.usuarios WHERE id = v_usuario_id), 'sistema'),
    NULL
  );
END;
$function$
