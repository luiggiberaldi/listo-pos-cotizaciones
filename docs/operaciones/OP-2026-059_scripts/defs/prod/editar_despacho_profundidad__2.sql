CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(p_despacho_id uuid, p_nuevos_items jsonb, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT 'Sistema'::text, p_usuario_rol text DEFAULT 'sistema'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Overload unificado (release 17): delega al cuerpo canónico.
  PERFORM public.editar_despacho_profundidad(
    p_despacho_id, p_nuevos_items, p_usuario_id, p_usuario_nombre, p_usuario_rol, NULL
  );
END;
$function$
