CREATE OR REPLACE FUNCTION public.cxc_restar_donacion_fp(p_fp text, p_monto numeric)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_fp jsonb; v_out jsonb := '[]'::jsonb; v_el jsonb; v_rest numeric := p_monto; v_m numeric; v_quita numeric;
begin
  if p_fp is null or p_monto is null or p_monto <= 0 then return p_fp; end if;
  begin v_fp := p_fp::jsonb; exception when others then return p_fp; end;
  if jsonb_typeof(v_fp) <> 'array' then return p_fp; end if;
  for v_el in select * from jsonb_array_elements(v_fp) loop
    if lower(trim(coalesce(v_el->>'metodo', ''))) in ('donación', 'donacion') and v_rest > 0 then
      v_m := public.cxc_num(v_el->>'monto');
      v_quita := least(v_m, v_rest);
      v_el := jsonb_set(v_el, '{monto}', to_jsonb(round(v_m - v_quita, 2)));
      v_rest := v_rest - v_quita;
    end if;
    v_out := v_out || jsonb_build_array(v_el);
  end loop;
  return v_out::text;
end;
$function$
