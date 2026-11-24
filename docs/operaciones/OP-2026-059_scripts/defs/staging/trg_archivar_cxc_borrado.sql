CREATE OR REPLACE FUNCTION public.trg_archivar_cxc_borrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_consulta text := left(coalesce(current_query(), ''), 8000);
  v_origen   text;
begin
  v_origen := coalesce(nullif(current_setting('cxc.origen', true), ''),
                       substring(v_consulta from '"?public"?\."?([a-z0-9_]+)"?\s*\('),
                       case when v_consulta ~* 'delete\s+from' then 'borrado directo' else 'sin identificar' end);
  insert into public.cxc_movimientos_borrados (movimiento_id, cuenta_id, cliente_id, despacho_id, tipo, monto_usd, fila,
                                              motivo, borrado_por, borrado_por_nombre, origen)
  values (old.id, old.cuenta_id, old.cliente_id, old.despacho_id, old.tipo, old.monto_usd, to_jsonb(old),
          nullif(current_setting('cxc.motivo', true), ''),
          nullif(current_setting('cxc.usuario_id', true), '')::uuid,
          nullif(current_setting('cxc.usuario_nombre', true), ''),
          v_origen);
  return old;
end;
$function$
