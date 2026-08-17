-- 00_preflight.sql
-- Preflight READ ONLY del paquete reconciliado del proyecto principal.
-- No ejecutar sobre staging ni usarlo como sustituto de una aprobación DBA.
-- Este archivo solo consulta catálogo/datos de configuración y aborta ante
-- una precondición incompatible.

DO $$
BEGIN
  IF to_regclass('public.configuracion_negocio') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_CONFIGURACION_FALTANTE: falta public.configuracion_negocio';
  END IF;

  IF to_regclass('public.notas_despacho') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_DESPACHOS_FALTANTE: falta public.notas_despacho';
  END IF;

  IF to_regclass('public.transportistas') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_TRANSPORTISTAS_FALTANTE: falta public.transportistas';
  END IF;

  IF to_regclass('public.pagos_transportistas') IS NULL
     OR to_regclass('public.pagos_transportistas_despachos') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_PAGOS_TRANSPORTISTAS_FALTANTE: faltan tablas de pagos/vínculos';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'configuracion_negocio'
      AND column_name = 'cuenta_id'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_TENANT_FALTANTE: configuracion_negocio.cuenta_id no existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_CONFIGURACION_VACIA: no hay filas de configuración';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.configuracion_negocio
    WHERE cuenta_id IS NULL
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_CUENTA_NULA: existe configuración sin cuenta';
  END IF;

  IF EXISTS (
    SELECT cuenta_id
    FROM public.configuracion_negocio
    GROUP BY cuenta_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_CUENTA_DUPLICADA: hay más de una configuración por cuenta';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notas_despacho'
      AND column_name = ANY(ARRAY[
        'flete_neto_transportista_usd',
        'flete_pct_aplicado',
        'flete_pagado',
        'flete_pagado_en'
      ]::TEXT[])
  ) <> 4 THEN
    RAISE EXCEPTION 'PRECONDICION_206_INCOMPLETA: faltan snapshots base de flete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transportistas'
      AND column_name = 'es_local'
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_206_TRANSPORTISTAS: falta transportistas.es_local';
  END IF;

  IF to_regprocedure('public.crear_producto_con_kardex(text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_RPC_PRODUCTO_CANONICA: falta crear_producto_con_kardex de 15 parámetros';
  END IF;

  IF to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_RPC_PRODUCTO_CANONICA: falta actualizar_producto_con_kardex de 16 parámetros';
  END IF;

  IF to_regprocedure('public.liquidar_transportista(uuid,uuid,numeric,text,text,uuid,text,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_RPC_TRANSPORTISTA: falta liquidar_transportista de 8 parámetros';
  END IF;

  IF to_regprocedure('public.revertir_pago_transportista(uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_RPC_TRANSPORTISTA: falta revertir_pago_transportista';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'configuracion_negocio'
      AND (
        (column_name = 'permitir_stock_negativo' AND data_type <> 'boolean')
        OR (column_name IN ('transp_pct_comision', 'transp_tarifa_fija_usd') AND data_type <> 'numeric')
        OR (column_name = 'transp_tipo_calculo' AND data_type <> 'text')
      )
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_TIPO_CONFIG_INVALIDO: una columna transp_* existente tiene tipo incompatible';
  END IF;
END
$$;

-- Salida sanitizada: no devuelve clientes, despachos ni UUIDs de negocio.
SELECT
  current_database() AS database_name,
  current_setting('transaction_read_only', true) AS transaction_read_only,
  (SELECT count(*) FROM public.configuracion_negocio) AS configuracion_rows,
  to_regprocedure('public.crear_producto_con_kardex(text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NOT NULL AS producto_create_canonico,
  to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NOT NULL AS producto_update_canonico,
  to_regprocedure('public.liquidar_transportista(uuid,uuid,numeric,text,text,uuid,text,uuid[])') IS NOT NULL AS liquidar_transportista_exists,
  to_regprocedure('public.revertir_pago_transportista(uuid,uuid,uuid,text)') IS NOT NULL AS revertir_pago_exists;
