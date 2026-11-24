CREATE OR REPLACE FUNCTION public.cxc_reparto_cliente(p_cliente_id uuid)
 RETURNS TABLE(cargo_id uuid, despacho_id uuid, monto numeric, pendiente numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_id    UUID[]    := ARRAY[]::UUID[];
  c_desp  UUID[]    := ARRAY[]::UUID[];
  c_monto NUMERIC[] := ARRAY[]::NUMERIC[];
  c_pend  NUMERIC[] := ARRAY[]::NUMERIC[];
  a_desp  UUID[]    := ARRAY[]::UUID[];
  a_rest  NUMERIC[] := ARRAY[]::NUMERIC[];
  r RECORD;
  i INT; j INT; nc INT; na INT;
  v_aplicar NUMERIC;
BEGIN
  FOR r IN
    SELECT x.id, x.tipo, x.despacho_id AS desp, x.monto_usd
    FROM public.cuentas_por_cobrar x
    WHERE x.cliente_id = p_cliente_id AND x.tipo IN ('cargo', 'abono')
    ORDER BY x.creado_en, x.id
  LOOP
    IF r.tipo = 'cargo' THEN
      c_id := c_id || r.id;
      c_desp := c_desp || r.desp;
      c_monto := c_monto || ROUND(r.monto_usd, 4);
      c_pend := c_pend || ROUND(r.monto_usd, 4);
    ELSE
      a_desp := a_desp || r.desp;
      a_rest := a_rest || ROUND(r.monto_usd, 4);
    END IF;
  END LOOP;
  nc := COALESCE(array_length(c_id, 1), 0);
  na := COALESCE(array_length(a_rest, 1), 0);

  -- Fase 1: abono enlazado -> primer cargo de su despacho
  FOR i IN 1..na LOOP
    IF a_desp[i] IS NOT NULL THEN
      FOR j IN 1..nc LOOP
        IF c_desp[j] = a_desp[i] THEN
          IF c_pend[j] > 0 THEN
            v_aplicar := LEAST(c_pend[j], a_rest[i]);
            c_pend[j] := ROUND(c_pend[j] - v_aplicar, 4);
            a_rest[i] := ROUND(a_rest[i] - v_aplicar, 4);
          END IF;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Fase 2: lo que sobra, del cargo mas viejo al mas nuevo
  FOR i IN 1..na LOOP
    IF a_rest[i] > 0 THEN
      FOR j IN 1..nc LOOP
        IF c_pend[j] > 0 THEN
          v_aplicar := LEAST(c_pend[j], a_rest[i]);
          c_pend[j] := ROUND(c_pend[j] - v_aplicar, 4);
          a_rest[i] := ROUND(a_rest[i] - v_aplicar, 4);
        END IF;
        EXIT WHEN a_rest[i] <= 0;
      END LOOP;
    END IF;
  END LOOP;

  FOR j IN 1..nc LOOP
    cargo_id := c_id[j];
    despacho_id := c_desp[j];
    monto := c_monto[j];
    pendiente := c_pend[j];
    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cxc_pendiente_despacho(p_cliente_id uuid, p_despacho_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ROUND(SUM(r.pendiente), 4), 0)
  FROM public.cxc_reparto_cliente(p_cliente_id) r
  WHERE r.despacho_id = p_despacho_id;
$function$;

REVOKE ALL ON FUNCTION public.cxc_reparto_cliente(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cxc_pendiente_despacho(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cxc_reparto_cliente(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cxc_pendiente_despacho(uuid, uuid) TO service_role;

-- Vista de pagos de mas: respeta las reglas de acceso de quien consulta (security_invoker).
CREATE OR REPLACE VIEW public.v_cxc_pagado_de_mas
WITH (security_invoker = true) AS
SELECT x.cliente_id,
       ROUND(SUM(CASE WHEN x.tipo = 'cargo' THEN x.monto_usd ELSE 0 END), 2) AS cargos_usd,
       ROUND(SUM(CASE WHEN x.tipo = 'abono' THEN x.monto_usd ELSE 0 END), 2) AS abonos_usd,
       ROUND(SUM(CASE WHEN x.tipo = 'abono' THEN x.monto_usd WHEN x.tipo = 'cargo' THEN -x.monto_usd ELSE 0 END), 2) AS pagado_de_mas_usd
FROM public.cuentas_por_cobrar x
WHERE x.tipo IN ('cargo', 'abono')
GROUP BY x.cliente_id
HAVING SUM(CASE WHEN x.tipo = 'abono' THEN x.monto_usd WHEN x.tipo = 'cargo' THEN -x.monto_usd ELSE 0 END) > 0.005;

REVOKE ALL ON public.v_cxc_pagado_de_mas FROM anon;
GRANT SELECT ON public.v_cxc_pagado_de_mas TO authenticated, service_role;
