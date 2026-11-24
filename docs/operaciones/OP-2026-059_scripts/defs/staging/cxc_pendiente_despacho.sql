CREATE OR REPLACE FUNCTION public.cxc_pendiente_despacho(p_cliente_id uuid, p_despacho_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ROUND(SUM(r.pendiente), 4), 0)
  FROM public.cxc_reparto_cliente(p_cliente_id) r
  WHERE r.despacho_id = p_despacho_id;
$function$
