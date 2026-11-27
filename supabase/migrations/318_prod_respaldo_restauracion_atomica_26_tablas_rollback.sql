-- 318_prod_respaldo_restauracion_atomica_26_tablas_rollback.sql — Vuelta atrás exacta de 318
BEGIN;

DROP FUNCTION IF EXISTS public.restaurar_respaldo_atomico(uuid, jsonb);
DROP FUNCTION IF EXISTS public.sync_sequences_after_restore();

CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_cabecera()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public.sincronizar_prestamos_despacho(NEW.id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_despacho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sincronizar_prestamos_despacho(OLD.despacho_id);
    RETURN OLD;
  ELSE
    PERFORM public.sincronizar_prestamos_despacho(NEW.despacho_id);
    RETURN NEW;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_cliente_para_cotizar()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.validar_transicion_estado()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.validar_designacion_diaria()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
  v_activo BOOLEAN;
  v_externo BOOLEAN;
BEGIN
  SELECT rol, activo, es_externo INTO v_rol, v_activo, v_externo
  FROM public.usuarios WHERE id = NEW.designado_id;
  IF NOT FOUND OR v_activo IS NOT TRUE
     OR v_externo IS TRUE
     OR v_rol NOT IN ('vendedor', 'supervisor') THEN
    RAISE EXCEPTION 'DESIGNADO_INVALIDO: solo vendedor o supervisor activos (no externos) pueden ser designados';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_cambio_flete_pagado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
BEGIN
  -- También cubrir INSERT: un registro no puede nacer marcado como pagado
  -- si no representa una comisión externa válida.
  IF TG_OP = 'INSERT' THEN
    IF NEW.flete_pagado = true
       AND (
         COALESCE(NEW.flete_comisionable, false) IS NOT TRUE
         OR COALESCE(NEW.flete_neto_transportista_usd, 0) <= 0
       )
    THEN
      RAISE EXCEPTION 'FLETE_NO_COMISIONABLE: solo se pueden liquidar comisiones de flete fuera de Carabobo';
    END IF;
    IF NEW.flete_pagado = true THEN
      NEW.flete_pagado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.flete_pagado = true
     AND (
       COALESCE(NEW.flete_comisionable, false) IS NOT TRUE
       OR COALESCE(NEW.flete_neto_transportista_usd, 0) <= 0
     )
  THEN
    RAISE EXCEPTION 'FLETE_NO_COMISIONABLE: solo se pueden liquidar comisiones de flete fuera de Carabobo';
  END IF;

  IF NEW.flete_pagado = OLD.flete_pagado THEN
    RETURN NEW;
  END IF;

  v_rol := public.get_rol_actual();
  IF v_rol IS NULL THEN
    IF NEW.flete_pagado = true AND OLD.flete_pagado = false THEN
      NEW.flete_pagado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: solo administración o desarrollador pueden liquidar fletes al transportista';
  END IF;

  IF NEW.flete_pagado = true AND OLD.flete_pagado = false THEN
    NEW.flete_pagado_en := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bloquear_edicion_flete_pagado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
BEGIN
  IF OLD.flete_pagado = true
     AND (
       NEW.flete_usd IS DISTINCT FROM OLD.flete_usd
       OR NEW.flete_neto_transportista_usd IS DISTINCT FROM OLD.flete_neto_transportista_usd
       OR NEW.flete_comisionable IS DISTINCT FROM OLD.flete_comisionable
       OR NEW.flete_regla_aplicada IS DISTINCT FROM OLD.flete_regla_aplicada
       OR NEW.flete_pct_aplicado IS DISTINCT FROM OLD.flete_pct_aplicado
       OR NEW.flete_estado_destino_snapshot IS DISTINCT FROM OLD.flete_estado_destino_snapshot
       OR NEW.transportista_id IS DISTINCT FROM OLD.transportista_id
       OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
       OR NEW.direccion_envio_estado IS DISTINCT FROM OLD.direccion_envio_estado
     )
  THEN
    v_rol := public.get_rol_actual();
    -- El Worker/service_role tiene v_rol NULL y puede ejecutar la reversa
    -- o una operación administrativa previamente validada.
    IF v_rol IS NOT NULL THEN
      RAISE EXCEPTION 'FLETE_YA_PAGADO: revierta el pago antes de editar el flete, chofer o destino';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

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
$function$;

COMMIT;
