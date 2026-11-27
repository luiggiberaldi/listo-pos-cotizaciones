-- 318_prod_respaldo_restauracion_atomica_26_tablas.sql — PRODUCCIÓN (OP-2026-097)
-- 1) Agrega sync_sequences_after_restore() para realinear correlativos tras restaurar.
-- 2) Agrega bandera transaccional app.restaurando_respaldo = 'on' a los 8 disparadores reales
--    de producción (sin ALTER TABLE DISABLE TRIGGER USER, sin candado ACCESS EXCLUSIVE).
-- 3) Crea restaurar_respaldo_atomico(uuid, jsonb): validación previa C3 en tablas hijas,
--    unión de columnas M3 de todas las filas, 26 tablas completas y statement_timeout local 180s
--    para soportar cómodamente el respaldo real de producción (~24 MB JSON).
-- Rollback: 318_prod_respaldo_restauracion_atomica_26_tablas_rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_sequences_after_restore()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  item record;
  max_value bigint;
  start_value bigint;
  applied_value bigint;
  report jsonb := '[]'::jsonb;
BEGIN
  -- Estas secuencias se consumen desde RPCs y no necesariamente aparecen como
  -- DEFAULT/OWNED BY en pg_attrdef, por lo que se mantienen explícitas.
  FOR item IN
    SELECT *
    FROM (VALUES
      ('public', 'configuracion_negocio', 'id', 'configuracion_negocio_id_seq'),
      ('public', 'cotizaciones', 'numero', 'cotizaciones_numero_seq'),
      ('public', 'notas_despacho', 'numero', 'notas_despacho_numero_seq'),
      ('public', 'inventario_movimientos', 'numero', 'inventario_movimientos_numero_seq'),
      ('public', 'ordenes_compra', 'numero', 'ordenes_compra_numero_seq')
    ) AS mappings(table_schema, table_name, column_name, sequence_name)
  LOOP
    IF to_regclass(format('%I.%I', item.table_schema, item.table_name)) IS NULL
       OR to_regclass(format('%I.%I', item.table_schema, item.sequence_name)) IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = item.table_schema
           AND c.relname = item.table_name
           AND a.attname = item.column_name
           AND a.attnum > 0
           AND NOT a.attisdropped
       ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT max(%I)::bigint FROM %I.%I',
      item.column_name,
      item.table_schema,
      item.table_name
    ) INTO max_value;

    SELECT COALESCE(s.start_value, 1)::bigint
      INTO start_value
      FROM pg_catalog.pg_sequences s
     WHERE s.schemaname = item.table_schema
       AND s.sequencename = item.sequence_name;

    IF max_value IS NULL THEN
      EXECUTE format(
        'SELECT setval(%L::regclass, $1, false)',
        format('%I.%I', item.table_schema, item.sequence_name)
      ) USING COALESCE(start_value, 1) INTO applied_value;
    ELSE
      EXECUTE format(
        'SELECT setval(%L::regclass, $1, true)',
        format('%I.%I', item.table_schema, item.sequence_name)
      ) USING max_value INTO applied_value;
    END IF;

    report := report || jsonb_build_array(jsonb_build_object(
      'sequence', format('%I.%I', item.table_schema, item.sequence_name),
      'table', format('%I.%I', item.table_schema, item.table_name),
      'column', item.column_name,
      'max_value', max_value,
      'set_value', applied_value
    ));
  END LOOP;

  RETURN report;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_sequences_after_restore() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_sequences_after_restore() TO service_role;

CREATE OR REPLACE FUNCTION public.tg_sincronizar_prestamos_cabecera()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION public.restaurar_respaldo_atomico(
  p_cuenta_id uuid,
  p_tablas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Orden que respeta todas las llaves foráneas.
  v_orden TEXT[] := ARRAY[
    'configuracion_negocio', 'transportistas', 'vehiculos', 'proveedores', 'productos', 'clientes',
    'cotizaciones', 'cotizacion_items', 'notas_despacho', 'notas_despacho_items',
    'despacho_descuentos', 'cliente_prestamos', 'despacho_devoluciones',
    'despacho_devolucion_intercambios', 'cuentas_por_cobrar', 'cxc_movimientos_borrados',
    'comisiones', 'comision_liberaciones', 'comision_designacion_diaria',
    'inventario_movimientos', 'inventario_operaciones',
    'ordenes_compra', 'orden_compra_items', 'cuentas_por_pagar',
    'pagos_transportistas', 'pagos_transportistas_despachos'
  ];
  v_t          TEXT;
  v_filas      JSONB;
  v_cuenta_col TEXT;
  v_cols       TEXT[];
  v_pk         TEXT[];
  v_sel        TEXT;
  v_set        TEXT;
  v_n          INTEGER;
  v_resumen    JSONB := '{}'::JSONB;
  v_seq        JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_tablas IS NULL OR jsonb_typeof(p_tablas) <> 'object' THEN
    RAISE EXCEPTION 'RESPALDO_INVALIDO';
  END IF;
  IF jsonb_typeof(p_tablas->'productos') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'RESPALDO_INCOMPLETO: falta la tabla productos';
  END IF;

  -- Bandera local de la transacción: evita ALTER TABLE DISABLE TRIGGER USER (ACCESS EXCLUSIVE).
  PERFORM set_config('statement_timeout', '180000', true);
  PERFORM set_config('app.restaurando_respaldo', 'on', true);

  -- C3 (OP-2026-094): validar tablas hijas SIN cuenta_id ANTES de cualquier INSERT/UPDATE,
  -- para que un archivo manipulado nunca pueda sobrescribir filas existentes de OTRA empresa.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'cliente_prestamos', '[]'::jsonb)) r
    JOIN public.cliente_prestamos cp ON cp.id::text = (r->>'id')
    LEFT JOIN public.clientes c ON c.id = cp.cliente_id
    WHERE c.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'despacho_devoluciones', '[]'::jsonb)) r
    JOIN public.despacho_devoluciones dd ON dd.id::text = (r->>'id')
    LEFT JOIN public.notas_despacho d ON d.id = dd.despacho_id
    WHERE d.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'despacho_devolucion_intercambios', '[]'::jsonb)) r
    JOIN public.despacho_devolucion_intercambios di ON di.id::text = (r->>'id')
    LEFT JOIN public.notas_despacho d ON d.id = di.despacho_id
    WHERE d.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'RESPALDO_CON_FILAS_DE_OTRA_EMPRESA: préstamos o devoluciones existentes de otra empresa';
  END IF;

  FOREACH v_t IN ARRAY v_orden LOOP
    v_filas := p_tablas->v_t;
    IF v_filas IS NULL OR jsonb_typeof(v_filas) <> 'array' OR jsonb_array_length(v_filas) = 0 THEN
      v_resumen := v_resumen || jsonb_build_object(v_t, 0);
      CONTINUE;
    END IF;

    v_cuenta_col := CASE
      WHEN v_t = 'comisiones' THEN 'cuentaid'
      WHEN v_t IN ('cliente_prestamos', 'despacho_devoluciones', 'despacho_devolucion_intercambios') THEN NULL
      ELSE 'cuenta_id'
    END;

    -- M3 (OP-2026-094): unión de llaves presentes en TODAS las filas (no solo la fila 0).
    SELECT array_agg(c.column_name ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_t
      AND c.is_generated = 'NEVER'
      AND c.column_name IN (
        SELECT DISTINCT k
        FROM jsonb_array_elements(v_filas) elem,
             LATERAL jsonb_object_keys(elem) k
      );
    IF v_cols IS NULL OR array_length(v_cols, 1) IS NULL THEN
      v_resumen := v_resumen || jsonb_build_object(v_t, 0);
      CONTINUE;
    END IF;
    IF v_cuenta_col IS NOT NULL AND NOT (v_cuenta_col = ANY (v_cols)) THEN
      v_cols := v_cols || v_cuenta_col;
    END IF;

    SELECT array_agg(a.attname ORDER BY a.attnum) INTO v_pk
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = format('public.%I', v_t)::regclass AND i.indisprimary;
    IF v_pk IS NULL THEN
      RAISE EXCEPTION 'TABLA_SIN_LLAVE_PRIMARIA: %', v_t;
    END IF;

    -- Filas que ya existen en OTRA empresa: se rechaza todo antes de escribir.
    IF v_cuenta_col IS NOT NULL AND 'id' = ANY (v_pk) THEN
      EXECUTE format(
        'SELECT count(*) FROM jsonb_array_elements($1) r JOIN public.%I x ON x.id::text = (r->>''id'') WHERE x.%I IS DISTINCT FROM $2',
        v_t, v_cuenta_col)
      INTO v_n USING v_filas, p_cuenta_id;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'RESPALDO_CON_FILAS_DE_OTRA_EMPRESA: % filas en %', v_n, v_t;
      END IF;
    END IF;

    SELECT string_agg(CASE WHEN col = v_cuenta_col THEN quote_literal(p_cuenta_id) || '::uuid' ELSE quote_ident(col) END, ', ')
    INTO v_sel FROM unnest(v_cols) AS col;

    SELECT string_agg(format('%I = EXCLUDED.%I', col, col), ', ')
    INTO v_set FROM unnest(v_cols) AS col
    WHERE NOT (col = ANY (v_pk))
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = v_t AND ic.column_name = col
          AND ic.is_identity = 'YES' AND ic.identity_generation = 'ALWAYS');

    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) OVERRIDING SYSTEM VALUE SELECT %3$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1) ON CONFLICT (%4$s) %5$s',
      v_t,
      (SELECT string_agg(quote_ident(col), ', ') FROM unnest(v_cols) AS col),
      v_sel,
      (SELECT string_agg(quote_ident(col), ', ') FROM unnest(v_pk) AS col),
      CASE WHEN v_set IS NULL THEN 'DO NOTHING' ELSE 'DO UPDATE SET ' || v_set END)
    USING v_filas;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resumen := v_resumen || jsonb_build_object(v_t, v_n);
  END LOOP;

  -- Validación posterior: ninguna fila hija nueva puede apuntar a un padre de otra empresa.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'cliente_prestamos', '[]'::jsonb)) r
    JOIN public.cliente_prestamos cp ON cp.id::text = (r->>'id')
    LEFT JOIN public.clientes c ON c.id = cp.cliente_id
    WHERE c.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'despacho_devoluciones', '[]'::jsonb)) r
    JOIN public.despacho_devoluciones dd ON dd.id::text = (r->>'id')
    LEFT JOIN public.notas_despacho d ON d.id = dd.despacho_id
    WHERE d.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'despacho_devolucion_intercambios', '[]'::jsonb)) r
    JOIN public.despacho_devolucion_intercambios di ON di.id::text = (r->>'id')
    LEFT JOIN public.notas_despacho d ON d.id = di.despacho_id
    WHERE d.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'RESPALDO_CON_FILAS_DE_OTRA_EMPRESA: préstamos o devoluciones de otra empresa';
  END IF;

  v_seq := public.sync_sequences_after_restore();

  RETURN jsonb_build_object('ok', TRUE, 'resumen', v_resumen, 'secuencias', v_seq);
END;
$function$;

REVOKE ALL ON FUNCTION public.restaurar_respaldo_atomico(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_respaldo_atomico(uuid, jsonb) TO service_role;

COMMIT;
