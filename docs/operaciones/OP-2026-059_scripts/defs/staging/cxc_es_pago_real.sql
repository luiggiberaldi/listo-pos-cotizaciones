CREATE OR REPLACE FUNCTION public.cxc_es_pago_real(p_metodo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(lower(trim(p_metodo)), '') not in
    ('', 'cta por cobrar', 'cobro a destino', 'donación', 'donacion', 'saldo a favor', 'crédito', 'credito', 'préstamo', 'prestamo')
$function$
