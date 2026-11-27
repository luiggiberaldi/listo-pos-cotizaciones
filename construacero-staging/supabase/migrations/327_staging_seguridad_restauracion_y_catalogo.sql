-- 327_staging_seguridad_restauracion_y_catalogo.sql — Solo STAGING (OP-2026-095 Fase 2)
-- Cierra hallazgos C3, A4 y M3 de la auditoría OP-2026-094:
--   1) Restauración sin candado total (ACCESS EXCLUSIVE): reemplaza ALTER TABLE ... DISABLE TRIGGER USER
--      por una bandera de transacción (app.restaurando_respaldo = 'on') respetada por los disparadores
--      de préstamos y validación histórica. No congela a otros usuarios ni deja disparadores apagados.
--   2) Cierra cruce entre empresas en tablas hijas (cliente_prestamos, despacho_devoluciones,
--      despacho_devolucion_intercambios): valida pertenencia de los IDs existentes ANTES del
--      INSERT ... ON CONFLICT DO UPDATE (antes solo validaba después).
--   3) Columnas de inserción deducidas de TODAS las filas del respaldo, no solo de la fila 0 (M3).
--   4) Amplía restauración a 26 tablas (despacho_descuentos, comision_liberaciones,
--      comision_designacion_diaria, cxc_movimientos_borrados, proveedores, ordenes_compra,
--      orden_compra_items, cuentas_por_pagar, vehiculos, pagos_transportistas y sus despachos).
--   5) Funciones de catálogo (obtener_stock_productos, obtener_categorias_vendedor,
--      obtener_productos_vendedor): cambia auth.uid() IS NULL por auth.role() = 'service_role'
--      y repite REVOKE FROM PUBLIC, anon (A4).
-- Rollback: 327_staging_seguridad_restauracion_y_catalogo_rollback.sql
BEGIN;

-- ── 1) Disparadores que respetan app.restaurando_respaldo = 'on' ────────────
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

CREATE OR REPLACE FUNCTION public.enforce_comision_238b_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho RECORD;
  v_payment JSONB;
BEGIN
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.calculo_version IS DISTINCT FROM '238b' THEN
    RAISE EXCEPTION 'COMISION_NUEVA_DEBE_USAR_238B';
  END IF;

  IF NEW.calculo_version IS DISTINCT FROM '238b' THEN
    RETURN NEW;
  END IF;

  SELECT nd.total_usd, nd.forma_pago_cliente, nd.forma_pago
  INTO v_despacho
  FROM public.notas_despacho nd
  WHERE nd.id = NEW.despachoid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_COMISION_NO_ENCONTRADO';
  END IF;

  v_payment := public.comision_238b_pago_split(
    v_despacho.total_usd, v_despacho.forma_pago_cliente, v_despacho.forma_pago
  );
  IF COALESCE((v_payment->>'requires_manual_review')::boolean, FALSE) THEN
    RAISE EXCEPTION 'PAGO_MIXTO_SIN_MONTOS_REQUIERE_REVISION';
  END IF;

  RETURN NEW;
END
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
    ARRAY['borrador',  'enviada'],
    ARRAY['borrador',  'anulada'],
    ARRAY['enviada',   'aceptada'],
    ARRAY['enviada',   'rechazada'],
    ARRAY['enviada',   'vencida'],
    ARRAY['enviada',   'anulada'],
    ARRAY['enviada',   'borrador'],
    ARRAY['rechazada', 'borrador'],
    ARRAY['aceptada',  'anulada'],
    ARRAY['vencida',   'anulada']
  ];
  par TEXT[];
  valido BOOLEAN := false;
BEGIN
  IF current_setting('app.restaurando_respaldo', true) = 'on' THEN
    RETURN NEW;
  END IF;

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

-- ── 2) restaurar_respaldo_atomico segura (C3, M3, 26 tablas, sin ACCESS EXCLUSIVE) ──
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

-- ── 3) A4 (OP-2026-094): exigir service_role en vez de auth.uid() IS NULL ───
CREATE OR REPLACE FUNCTION public.obtener_stock_productos(p_ids uuid[])
 RETURNS TABLE(id uuid, stock_actual numeric, nombre text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.stock_actual, p.nombre
  FROM productos p
  WHERE p.id = ANY(p_ids) AND p.activo = true
    AND (auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.obtener_categorias_vendedor()
 RETURNS TABLE(categoria text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT p.categoria
  FROM productos p
  WHERE p.activo = true AND p.categoria IS NOT NULL
    AND (auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid()))
  ORDER BY p.categoria ASC;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_productos_vendedor(p_busqueda text DEFAULT ''::text, p_categoria text DEFAULT ''::text, p_categoria_grupo boolean DEFAULT false, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, codigo text, nombre text, descripcion text, categoria text, unidad text, precio_usd numeric, precio_2 numeric, precio_3 numeric, stock_actual numeric, stock_minimo numeric, activo boolean, imagen_url text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_terms TEXT[];
BEGIN
  IF trim(COALESCE(p_busqueda, '')) <> '' THEN
    v_terms := string_to_array(lower(trim(p_busqueda)), ' ');
    v_terms := array_remove(v_terms, '');
  ELSE
    v_terms := ARRAY[]::TEXT[];
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id, p.codigo, p.nombre, p.descripcion, p.categoria, p.unidad,
      p.precio_usd, p.precio_2, p.precio_3,
      p.stock_actual, p.stock_minimo, p.activo, p.imagen_url
    FROM productos p
    WHERE p.activo = true
      AND (auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid()))
      AND (
        array_length(v_terms, 1) IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(v_terms) AS t(term)
          WHERE NOT (
            lower(p.nombre) LIKE '%' || t.term || '%'
            OR lower(COALESCE(p.codigo, '')) LIKE '%' || t.term || '%'
          )
        )
      )
      AND (
        p_categoria = ''
        OR (p_categoria_grupo AND p.categoria ILIKE p_categoria || '%')
        OR (NOT p_categoria_grupo AND p.categoria = p_categoria)
      )
    ORDER BY p.nombre ASC
  )
  SELECT f.*, count(*) OVER() AS total_count
  FROM filtered f
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.obtener_stock_productos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_stock_productos(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.obtener_categorias_vendedor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_categorias_vendedor() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.obtener_productos_vendedor(text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_productos_vendedor(text, text, boolean, integer, integer) TO authenticated, service_role;

COMMIT;
