-- 240_sync_sequences_after_restore.sql
-- Mantiene los correlativos alineados después de un restore que inserta
-- números explícitos. No borra ni modifica filas; solo ajusta secuencias.

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

COMMENT ON FUNCTION public.sync_sequences_after_restore() IS
  'Repara secuencias de correlativos después de restaurar filas con IDs/números explícitos.';

REVOKE ALL ON FUNCTION public.sync_sequences_after_restore() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.sync_sequences_after_restore() TO service_role;
  END IF;
END
$$;

-- Postflight: la función debe poder ejecutarse aun si alguna tabla opcional no existe.
SELECT public.sync_sequences_after_restore();

COMMIT;
