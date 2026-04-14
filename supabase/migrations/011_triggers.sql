-- 011_triggers.sql

-- Función genérica para updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$;

-- Aplicar a todas las tablas con actualizado_en
CREATE TRIGGER trg_usuarios_updated
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_productos_updated
  BEFORE UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transportistas_updated
  BEFORE UPDATE ON public.transportistas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_clientes_updated
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_cotizaciones_updated
  BEFORE UPDATE ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_config_updated
  BEFORE UPDATE ON public.configuracion_negocio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Trigger: validar transiciones de estado (máquina de estados)
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
    ARRAY['aceptada',  'anulada'],    -- Solo supervisor, validado en RPC
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

CREATE TRIGGER trg_cotizaciones_estado
  BEFORE UPDATE OF estado ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.validar_transicion_estado();


-- Trigger: validar que el cliente tiene datos suficientes al crear la cotización
-- (Incluido aquí porque depende de la tabla cotizaciones y clientes)
CREATE OR REPLACE FUNCTION public.validar_cliente_para_cotizar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cliente RECORD;
BEGIN
  SELECT nombre, telefono, email
  INTO v_cliente
  FROM public.clientes WHERE id = NEW.cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_INVALIDO: El cliente no existe o está inactivo';
  END IF;

  IF v_cliente.nombre IS NULL OR trim(v_cliente.nombre) = '' THEN
    RAISE EXCEPTION 'CLIENTE_SIN_NOMBRE: El cliente debe tener nombre para cotizar';
  END IF;

  IF (v_cliente.telefono IS NULL OR trim(v_cliente.telefono) = '')
     AND (v_cliente.email IS NULL OR trim(v_cliente.email) = '') THEN
    RAISE EXCEPTION 'CLIENTE_SIN_CONTACTO: El cliente debe tener teléfono o email para cotizar';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cotizacion_validar_cliente
  BEFORE INSERT ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.validar_cliente_para_cotizar();
