-- Reversa de 308 (solo STAGING): vuelve a la regla de OP-2026-042 (copia exacta de la funcion anterior).
CREATE OR REPLACE FUNCTION public.cxc_reparto_cliente(p_cliente_id uuid)
 RETURNS TABLE(cargo_id uuid, despacho_id uuid, monto numeric, pendiente numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
$function$
;
