-- Permitir reabrir cotizaciones: agregar transiciones enviada→borrador y rechazada→borrador
CREATE OR REPLACE FUNCTION public.validar_transicion_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transiciones_validas TEXT[][] := ARRAY[
    -- [estado_origen, estado_destino]
    ARRAY['borrador',  'enviada'],
    ARRAY['borrador',  'anulada'],
    ARRAY['enviada',   'aceptada'],
    ARRAY['enviada',   'rechazada'],
    ARRAY['enviada',   'vencida'],
    ARRAY['enviada',   'anulada'],
    ARRAY['enviada',   'borrador'],     -- reabrir para edición
    ARRAY['rechazada', 'borrador'],     -- reabrir para edición
    ARRAY['aceptada',  'anulada'],      -- Solo supervisor, validado en RPC
    ARRAY['vencida',   'anulada']
  ];
  par TEXT[];
  valido BOOLEAN := false;
BEGIN
  -- Si el estado no cambia, permitir
  IF OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  FOREACH par SLICE 1 IN ARRAY transiciones_validas LOOP
    IF par[1] = OLD.estado::TEXT AND par[2] = NEW.estado::TEXT THEN
      valido := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT valido THEN
    RAISE EXCEPTION 'Transición de estado inválida: % → %', OLD.estado, NEW.estado;
  END IF;

  -- Registrar timestamps automáticamente
  IF NEW.estado = 'enviada' AND OLD.estado = 'borrador' THEN
    NEW.enviada_en = now();
  END IF;

  RETURN NEW;
END;
$$;
