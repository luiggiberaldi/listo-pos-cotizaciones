-- 99_postflight.sql
-- Postflight READ ONLY del paquete reconciliado.
-- No ejecuta RPCs: solo consulta catálogo y valores de configuración.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'configuracion_negocio'
      AND column_name = ANY(ARRAY[
        'permitir_stock_negativo',
        'transp_tipo_calculo',
        'transp_pct_comision',
        'transp_tarifa_fija_usd'
      ]::TEXT[])
    GROUP BY table_name
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_CONFIG_COLUMNAS_FALTANTES: no están las cuatro columnas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
    WHERE permitir_stock_negativo IS NULL
       OR transp_tipo_calculo IS NULL
       OR transp_pct_comision IS NULL
       OR transp_tarifa_fija_usd IS NULL
       OR transp_tipo_calculo NOT IN ('porcentaje', 'fija')
       OR transp_pct_comision < 0
       OR transp_pct_comision > 100
       OR transp_tarifa_fija_usd < 0
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_CONFIG_INVALIDA: hay valores nulos o fuera de rango';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notas_despacho'
      AND column_name = ANY(ARRAY[
        'flete_estado_destino_snapshot',
        'flete_comisionable',
        'flete_regla_aplicada'
      ]::TEXT[])
    GROUP BY table_name
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_FLETE_COLUMNAS_FALTANTES: falta la regla de destino';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'trg_aplicar_regla_comision_flete'
      AND c.relname = 'notas_despacho'
      AND n.nspname = 'public'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'POSTFLIGHT_TRIGGER_FLETE_FALTANTE: falta trg_aplicar_regla_comision_flete';
  END IF;

  IF to_regprocedure('public.crear_producto_con_kardex(text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NULL
     OR to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'POSTFLIGHT_RPC_PRODUCTO_CANONICA_FALTANTE: falta una firma vigente';
  END IF;

  IF to_regprocedure('public.crear_producto_con_kardex(text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric)') IS NOT NULL
     OR to_regprocedure('public.crear_producto_con_kardex(text,text,text,text,text,numeric,numeric,numeric,numeric,text)') IS NOT NULL
     OR to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric)') IS NOT NULL
     OR to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'POSTFLIGHT_RPC_PRODUCTO_OVERLOAD: aún existe una firma histórica';
  END IF;

  IF to_regprocedure('public.aplicar_regla_comision_flete(text)') IS NOT NULL THEN
    -- La función de trigger no recibe argumentos; esta condición solo protege
    -- el caso de una función equivocada con el mismo nombre.
    RAISE EXCEPTION 'POSTFLIGHT_RPC_REGLA_INVALIDA: firma inesperada';
  END IF;

  IF to_regprocedure('public.aplicar_regla_comision_flete()') IS NULL THEN
    RAISE EXCEPTION 'POSTFLIGHT_REGLA_FLETE_FALTANTE: falta la función del trigger';
  END IF;
END
$$;

SELECT
  current_database() AS database_name,
  current_setting('transaction_read_only', true) AS transaction_read_only,
  count(*) AS configuracion_rows,
  array_agg(DISTINCT transp_tipo_calculo ORDER BY transp_tipo_calculo) AS tipos_calculo,
  array_agg(DISTINCT transp_pct_comision ORDER BY transp_pct_comision) AS porcentajes,
  array_agg(DISTINCT transp_tarifa_fija_usd ORDER BY transp_tarifa_fija_usd) AS tarifas_fijas,
  array_agg(DISTINCT permitir_stock_negativo ORDER BY permitir_stock_negativo) AS stock_negativo_flags
FROM public.configuracion_negocio;

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'aplicar_regla_comision_flete',
    'liquidar_transportista',
    'revertir_pago_transportista',
    'crear_producto_con_kardex',
    'actualizar_producto_con_kardex'
  )
ORDER BY p.proname, signature;

SELECT
  t.tgname AS trigger_name,
  c.relname AS table_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND t.tgname IN (
    'trg_aplicar_regla_comision_flete',
    'trg_flete_pagado',
    'trg_bloquear_flete_pagado'
  )
ORDER BY t.tgname;
