CREATE OR REPLACE FUNCTION public.cxc_num(p text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when coalesce(p, '') ~ '^-?[0-9]+(\.[0-9]+)?$' then p::numeric else 0 end
$function$
