-- 322_staging_restaurar_respaldo_atomico.sql — Solo STAGING (OP-2026-086, Fase 3 de OP-2026-078, hallazgos A1 y B3)
-- Restaurar un respaldo JSON en UN solo paso (todo o nada):
--   * si algo falla a mitad, no queda nada a medias (antes se cargaba por lotes sueltos y podía
--     quedar parcial devolviendo "200");
--   * durante la carga se apagan los disparadores propios de cada tabla (por ejemplo el que crea
--     préstamos automáticamente al insertar artículos de despacho, que hacía chocar los préstamos
--     del respaldo y perder lo devuelto/facturado); las llaves foráneas siguen activas;
--   * conserva los números originales (cotizaciones, Kardex) con OVERRIDING SYSTEM VALUE y al final
--     avanza los contadores (sync_sequences_after_restore);
--   * rechaza filas cuyo id ya pertenece a OTRA empresa, y fuerza la empresa de quien restaura;
--   * las tablas hijas sin columna de empresa (préstamos, devoluciones, intercambios) se verifican
--     contra su cliente o despacho.
-- Solo el servidor (service_role) puede ejecutarla.
-- Rollback: 322_staging_restaurar_respaldo_atomico_rollback.sql
BEGIN;

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
  -- Orden que respeta las llaves foráneas.
  v_orden TEXT[] := ARRAY[
    'configuracion_negocio', 'transportistas', 'productos', 'clientes', 'cotizaciones',
    'cotizacion_items', 'notas_despacho', 'notas_despacho_items', 'cliente_prestamos',
    'despacho_devoluciones', 'despacho_devolucion_intercambios', 'cuentas_por_cobrar',
    'comisiones', 'inventario_movimientos', 'inventario_operaciones'
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

  -- Apagar disparadores propios durante la carga (se vuelven a encender al final de esta misma
  -- transacción; si algo falla, el ROLLBACK los deja como estaban).
  FOREACH v_t IN ARRAY v_orden LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_t);
  END LOOP;

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

    -- Columnas: las que trae el respaldo y existen en la tabla (sin columnas calculadas).
    SELECT array_agg(c.column_name ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_t
      AND c.is_generated = 'NEVER'
      AND (v_filas->0) ? c.column_name;
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

    -- Filas que ya existen en OTRA empresa: se rechaza todo.
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

    -- Al actualizar una fila existente no se tocan la llave ni los números automáticos
    -- "GENERATED ALWAYS" (la base no lo permite; la fila ya tiene su número).
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

  -- Tablas hijas sin columna de empresa: deben colgar de un cliente/despacho de esta empresa.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'cliente_prestamos', '[]')) r
    JOIN public.cliente_prestamos cp ON cp.id::text = (r->>'id')
    LEFT JOIN public.clientes c ON c.id = cp.cliente_id
    WHERE c.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'despacho_devoluciones', '[]')) r
    JOIN public.despacho_devoluciones dd ON dd.id::text = (r->>'id')
    LEFT JOIN public.notas_despacho d ON d.id = dd.despacho_id
    WHERE d.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_tablas->'despacho_devolucion_intercambios', '[]')) r
    JOIN public.despacho_devolucion_intercambios di ON di.id::text = (r->>'id')
    LEFT JOIN public.notas_despacho d ON d.id = di.despacho_id
    WHERE d.cuenta_id IS DISTINCT FROM p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'RESPALDO_CON_FILAS_DE_OTRA_EMPRESA: préstamos o devoluciones de otra empresa';
  END IF;

  FOREACH v_t IN ARRAY v_orden LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_t);
  END LOOP;

  v_seq := public.sync_sequences_after_restore();

  RETURN jsonb_build_object('ok', TRUE, 'resumen', v_resumen, 'secuencias', v_seq);
END;
$function$;

REVOKE ALL ON FUNCTION public.restaurar_respaldo_atomico(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_respaldo_atomico(uuid, jsonb) TO service_role;

COMMIT;
