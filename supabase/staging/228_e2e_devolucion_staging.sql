-- 228: Ensayo E2E de inventario y devolución parcial
--
-- SEGURIDAD:
--   1. Ejecutar únicamente en una base de datos clonada cuyo nombre contenga
--      staging, stage, test o qa.
--   2. El script se niega a ejecutarse en una base de datos llamada postgres,
--      producción o cualquier nombre no identificable como staging.
--   3. Todo se ejecuta dentro de una transacción y termina con ROLLBACK.
--   4. No aplicar este archivo como migración de producción.
--
-- Requiere tener aplicadas las migraciones 206, 207, 221, 222, 223, 224, 225, 226, 232 y 235.

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_db TEXT := current_database();
  v_cuenta UUID;
  v_cuenta_setting TEXT := current_setting('app.construacero_cuenta_id', true);
  v_staging_ack TEXT := current_setting('app.construacero_staging', true);
  v_operador UUID;
  v_cliente UUID := gen_random_uuid();
  v_producto UUID := gen_random_uuid();
  v_producto_intercambio UUID := gen_random_uuid();
  v_transportista UUID := gen_random_uuid();
  v_cotizacion UUID := gen_random_uuid();
  v_despacho UUID := gen_random_uuid();
  v_cotizacion_carabobo UUID := gen_random_uuid();
  v_despacho_carabobo UUID := gen_random_uuid();
  v_item UUID := gen_random_uuid();
  v_delivery JSONB;
  v_partial JSONB;
  v_estado TEXT;
  v_comprometido NUMERIC;
  v_stock NUMERIC;
  v_total NUMERIC;
  v_cxc_credito NUMERIC;
  v_comision NUMERIC;
  v_kardex_count INTEGER;
  v_cxc_count INTEGER;
  v_comision_count INTEGER;
  v_saldo_pendiente NUMERIC;
  v_saldo_favor NUMERIC;
  v_transp_tipo TEXT;
  v_transp_pct NUMERIC;
  v_transp_tarifa NUMERIC;
  v_transportista_neto NUMERIC;
  v_flete_comisionable BOOLEAN;
  v_flete_regla TEXT;
  v_flete_pagado BOOLEAN;
  v_pago_result JSONB;
  v_pago_replay JSONB;
  v_pago_id UUID;
  v_reversa JSONB;
BEGIN
  IF v_db ~* '(prod|production)'
     OR (v_db !~* '(stage|staging|test|qa)'
         AND v_staging_ack IS DISTINCT FROM 'CONFIRM_STAGING_ONLY') THEN
    RAISE EXCEPTION
      'ABORTADO: % no parece una base staging/test. En una base Supabase cuyo nombre sea postgres se requiere SET app.construacero_staging = CONFIRM_STAGING_ONLY.',
      v_db;
  END IF;

  IF v_cuenta_setting IS NOT NULL AND v_cuenta_setting <> '' THEN
    IF v_cuenta_setting !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'ABORTADO: app.construacero_cuenta_id no es un UUID válido';
    END IF;
    v_cuenta := v_cuenta_setting::UUID;
  ELSE
    -- En el proyecto staging actual existe una sola cuenta operativa. Si se
    -- ejecuta en un clone multi-tenant, pasar explícitamente la cuenta.
    SELECT u.cuenta_id
    INTO v_cuenta
    FROM public.usuarios u
    WHERE u.cuenta_id IS NOT NULL
      AND u.activo = TRUE
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
    GROUP BY u.cuenta_id
    ORDER BY count(*) DESC, u.cuenta_id
    LIMIT 1;
  END IF;

  IF v_cuenta IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver la cuenta de ensayo; establezca app.construacero_cuenta_id';
  END IF;

  SELECT u.id
  INTO v_operador
  FROM public.usuarios u
  WHERE u.cuenta_id = v_cuenta
    AND u.activo = TRUE
    AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
  ORDER BY u.nombre
  LIMIT 1;

  IF v_operador IS NULL THEN
    RAISE EXCEPTION 'No existe un operador privilegiado activo para la cuenta de ensayo';
  END IF;

  -- Fixture completamente aislado: todos los IDs son nuevos y el número de
  -- cotización/despacho es explícito para no avanzar secuencias de negocio.
  INSERT INTO public.productos (
    id, codigo, nombre, descripcion, categoria, unidad,
    precio_usd, costo_usd, stock_actual, stock_minimo, activo, cuenta_id
  ) VALUES
    (
      v_producto,
      '__STAGING_E2E_A_' || replace(v_producto::TEXT, '-', ''),
      'STAGING E2E Producto Retornado',
      'Fixture temporal — no conservar',
      'CABILLAS',
      'und',
      10,
      5,
      10,
      0,
      TRUE,
      v_cuenta
    ),
    (
      v_producto_intercambio,
      '__STAGING_E2E_B_' || replace(v_producto_intercambio::TEXT, '-', ''),
      'STAGING E2E Producto Intercambio',
      'Fixture temporal — no conservar',
      'OTROS',
      'und',
      5,
      2,
      5,
      0,
      TRUE,
      v_cuenta
    );

  INSERT INTO public.clientes (
    id, nombre, rif_cedula, telefono, email, vendedor_id, activo,
    saldo_pendiente, saldo_a_favor, estado, cuenta_id
  ) VALUES (
    v_cliente,
    'STAGING E2E Cliente Temporal',
    '__STAGING_E2E_' || replace(v_cliente::TEXT, '-', ''),
    '04140000001',
    'staging-e2e@example.invalid',
    v_operador,
    TRUE,
    0,
    0,
    'Aragua',
    v_cuenta
  );

  INSERT INTO public.transportistas (
    id, nombre, rif, telefono, activo, es_local, tipo_relacion, cuenta_id
  ) VALUES (
    v_transportista,
    'STAGING E2E Transportista Local',
    '__STAGING_E2E_TRANSP_' || replace(v_transportista::TEXT, '-', ''),
    '04140000002',
    TRUE,
    TRUE,
    'contratista',
    v_cuenta
  );

  SELECT transp_tipo_calculo, transp_pct_comision, transp_tarifa_fija_usd
  INTO v_transp_tipo, v_transp_pct, v_transp_tarifa
  FROM public.configuracion_negocio
  WHERE cuenta_id = v_cuenta
  LIMIT 1;

  IF v_transp_tipo = 'fija' THEN
    v_transportista_neto := LEAST(100, GREATEST(0, COALESCE(v_transp_tarifa, 0)));
  ELSE
    v_transportista_neto := ROUND((100 * GREATEST(0, LEAST(100, COALESCE(v_transp_pct, 0))) / 100)::NUMERIC, 4);
  END IF;

  IF v_transportista_neto <= 0 THEN
    RAISE EXCEPTION 'FALLO configuración transportista: el neto de prueba debe ser mayor que cero';
  END IF;

  INSERT INTO public.cotizaciones (
    id, numero, version, cliente_id, vendedor_id, estado,
    subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd, notas_internas, cuenta_id
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_cotizacion,
    -228001,
    1,
    v_cliente,
    v_operador,
    'aceptada',
    20,
    0,
    0,
    100,
    120,
    'Fixture temporal 228',
    v_cuenta
  );

  INSERT INTO public.cotizacion_items (
    id, cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden, cuenta_id
  ) VALUES (
    gen_random_uuid(),
    v_cotizacion,
    v_producto,
    '__STAGING_E2E_A',
    'STAGING E2E Producto Retornado',
    'und',
    2,
    10,
    0,
    20,
    0,
    v_cuenta
  );

  INSERT INTO public.notas_despacho (
    id, numero, cotizacion_id, cliente_id, vendedor_id,
    transportista_id, estado, total_usd, flete_usd,
    flete_neto_transportista_usd, flete_pct_aplicado,
    direccion_envio_estado, notas, creado_por, despachada_en, cuenta_id
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_despacho,
    -228001,
    v_cotizacion,
    v_cliente,
    v_operador,
    v_transportista,
    'despachada',
    120,
    100,
    v_transportista_neto,
    CASE WHEN v_transp_tipo = 'fija' THEN NULL ELSE v_transp_pct END,
    'Aragua',
    'Fixture temporal 228',
    v_operador,
    now(),
    v_cuenta
  );

  SELECT flete_comisionable, flete_regla_aplicada
  INTO v_flete_comisionable, v_flete_regla
  FROM public.notas_despacho
  WHERE id = v_despacho;

  IF v_flete_comisionable IS NOT TRUE OR v_flete_regla <> 'comision_fuera_carabobo' THEN
    RAISE EXCEPTION 'FALLO regla fuera de Carabobo: comisionable=%, regla=%', v_flete_comisionable, v_flete_regla;
  END IF;

  -- Edición: mover el destino a Carabobo debe retirar la comisión y enviarlo
  -- a nómina; volver a Aragua debe reconstruir únicamente el snapshot externo.
  UPDATE public.notas_despacho
  SET direccion_envio_estado = 'Carabobo'
  WHERE id = v_despacho;

  SELECT flete_comisionable, flete_regla_aplicada, flete_neto_transportista_usd
  INTO v_flete_comisionable, v_flete_regla, v_transportista_neto
  FROM public.notas_despacho
  WHERE id = v_despacho;

  IF v_flete_comisionable IS NOT FALSE
     OR v_flete_regla <> 'nomina_carabobo'
     OR v_transportista_neto <> 0 THEN
    RAISE EXCEPTION 'FALLO edición a Carabobo: comisionable=%, regla=%, neto=%',
      v_flete_comisionable, v_flete_regla, v_transportista_neto;
  END IF;

  UPDATE public.notas_despacho
  SET direccion_envio_estado = 'Aragua'
  WHERE id = v_despacho;

  SELECT flete_comisionable, flete_regla_aplicada, flete_neto_transportista_usd
  INTO v_flete_comisionable, v_flete_regla, v_transportista_neto
  FROM public.notas_despacho
  WHERE id = v_despacho;

  IF v_flete_comisionable IS NOT TRUE
     OR v_flete_regla <> 'comision_fuera_carabobo'
     OR v_transportista_neto <= 0 THEN
    RAISE EXCEPTION 'FALLO edición fuera de Carabobo: comisionable=%, regla=%, neto=%',
      v_flete_comisionable, v_flete_regla, v_transportista_neto;
  END IF;

  -- Segundo caso: el mismo chofer local lleva un flete dentro de Carabobo.
  -- Debe quedar en nómina externa y no generar saldo liquidable.
  INSERT INTO public.cotizaciones (
    id, numero, version, cliente_id, vendedor_id, estado,
    subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd, notas_internas, cuenta_id
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_cotizacion_carabobo,
    -228002,
    1,
    v_cliente,
    v_operador,
    'aceptada',
    0,
    0,
    0,
    50,
    50,
    'Fixture temporal 228 — caso Carabobo',
    v_cuenta
  );

  INSERT INTO public.notas_despacho (
    id, numero, cotizacion_id, cliente_id, vendedor_id,
    transportista_id, estado, total_usd, flete_usd,
    direccion_envio_estado, notas, creado_por, cuenta_id
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_despacho_carabobo,
    -228002,
    v_cotizacion_carabobo,
    v_cliente,
    v_operador,
    v_transportista,
    'pendiente',
    50,
    50,
    'Carabobo',
    'Fixture temporal 228 — caso Carabobo',
    v_operador,
    v_cuenta
  );

  SELECT flete_comisionable, flete_regla_aplicada
  INTO v_flete_comisionable, v_flete_regla
  FROM public.notas_despacho
  WHERE id = v_despacho_carabobo;

  IF v_flete_comisionable IS NOT FALSE OR v_flete_regla <> 'nomina_carabobo' THEN
    RAISE EXCEPTION 'FALLO regla Carabobo: comisionable=%, regla=%', v_flete_comisionable, v_flete_regla;
  END IF;

  INSERT INTO public.notas_despacho_items (
    id, despacho_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden, origen
  ) VALUES (
    v_item,
    v_despacho,
    v_producto,
    '__STAGING_E2E_A',
    'STAGING E2E Producto Retornado',
    'und',
    2,
    10,
    0,
    20,
    0,
    'inventario'
  );

  -- Comisión fixture para validar el ajuste proporcional. No se llama al
  -- calculador de comisión porque este ensayo debe ser independiente de la
  -- configuración comercial actual.
  INSERT INTO public.comisiones (
    id, despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros,
    pctcabilla, pctotros, montopagado, estado,
    comision_liberada, comision_retenida
  ) VALUES (
    gen_random_uuid(),
    v_despacho,
    v_operador,
    v_cotizacion,
    v_cuenta,
    10,
    10,
    0,
    2,
    0,
    0,
    'pendiente',
    10,
    0
  );

  -- 1) Aprobación: el despacho despachado compromete 2 unidades y no toca
  -- stock físico ni Kardex.
  SELECT COALESCE(SUM(cantidad), 0)
  INTO v_comprometido
  FROM public.obtener_stock_comprometido_detalle(v_producto);

  IF v_comprometido <> 2 THEN
    RAISE EXCEPTION 'FALLO compromiso antes de entrega: esperado 2, obtenido %', v_comprometido;
  END IF;

  SELECT stock_actual
  INTO v_stock
  FROM public.productos
  WHERE id = v_producto;

  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FALLO stock en aprobación: esperado 10, obtenido %', v_stock;
  END IF;

  SELECT COUNT(*)
  INTO v_kardex_count
  FROM public.inventario_movimientos
  WHERE producto_id IN (v_producto, v_producto_intercambio)
    AND cuenta_id = v_cuenta;

  IF v_kardex_count <> 0 THEN
    RAISE EXCEPTION 'FALLO Kardex en aprobación: se encontraron % movimientos', v_kardex_count;
  END IF;

  -- 2) Entrega: descuenta físicamente 2 unidades y crea un único movimiento.
  SELECT public.confirmar_entrega_inventario_atomica(
    v_despacho,
    v_operador,
    'STAGING E2E Operator',
    NULL,
    NULL,
    FALSE
  ) INTO v_delivery;

  SELECT estado INTO v_estado FROM public.notas_despacho WHERE id = v_despacho;
  IF v_estado <> 'entregada' THEN
    RAISE EXCEPTION 'FALLO estado después de entrega: %', v_estado;
  END IF;

  SELECT stock_actual INTO v_stock FROM public.productos WHERE id = v_producto;
  IF v_stock <> 8 THEN
    RAISE EXCEPTION 'FALLO stock después de entrega: esperado 8, obtenido %', v_stock;
  END IF;

  SELECT COUNT(*) INTO v_kardex_count
  FROM public.inventario_movimientos
  WHERE producto_id = v_producto
    AND cuenta_id = v_cuenta;
  IF v_kardex_count <> 1 THEN
    RAISE EXCEPTION 'FALLO Kardex de entrega: esperado 1 movimiento, obtenido %', v_kardex_count;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)
  INTO v_comprometido
  FROM public.obtener_stock_comprometido_detalle(v_producto);
  IF v_comprometido <> 0 THEN
    RAISE EXCEPTION 'FALLO compromiso después de entrega: esperado 0, obtenido %', v_comprometido;
  END IF;

  -- 3) Devolución parcial con intercambio de menor valor:
  --    devuelve 1 unidad de A ($10), entrega 1 unidad de B ($5),
  --    genera $5 de saldo a favor y reduce proporcionalmente la comisión
  --    de $10 a $9.58 (115/120 del total original).
  SELECT public.registrar_devolucion_parcial_atomica(
    v_despacho,
    jsonb_build_array(jsonb_build_object(
      'despacho_item_id', v_item,
      'producto_id', v_producto,
      'nombre_snap', 'STAGING E2E Producto Retornado',
      'codigo_snap', '__STAGING_E2E_A',
      'unidad_snap', 'und',
      'cantidad_devuelta', 1,
      'precio_unit_usd', 10,
      'total_devuelto_usd', 10,
      'origen', 'inventario'
    )),
    jsonb_build_array(jsonb_build_object(
      'producto_id', v_producto_intercambio,
      'nombre_snap', 'STAGING E2E Producto Intercambio',
      'codigo_snap', '__STAGING_E2E_B',
      'unidad_snap', 'und',
      'cantidad', 1,
      'precio_unit_usd', 5,
      'total_usd', 5
    )),
    'Prueba E2E staging',
    v_operador,
    'STAGING E2E Operator',
    NULL,
    NULL,
    10,
    5
  ) INTO v_partial;

  SELECT stock_actual INTO v_stock FROM public.productos WHERE id = v_producto;
  IF v_stock <> 9 THEN
    RAISE EXCEPTION 'FALLO stock devuelto: esperado 9, obtenido %', v_stock;
  END IF;

  SELECT stock_actual INTO v_stock FROM public.productos WHERE id = v_producto_intercambio;
  IF v_stock <> 4 THEN
    RAISE EXCEPTION 'FALLO stock intercambio: esperado 4, obtenido %', v_stock;
  END IF;

  SELECT total_usd INTO v_total FROM public.notas_despacho WHERE id = v_despacho;
  IF v_total <> 115 THEN
    RAISE EXCEPTION 'FALLO total despacho: esperado 115, obtenido %', v_total;
  END IF;

  SELECT COALESCE(SUM(monto_usd), 0)
  INTO v_cxc_credito
  FROM public.cuentas_por_cobrar
  WHERE despacho_id = v_despacho
    AND tipo = 'credito';
  IF v_cxc_credito <> 5 THEN
    RAISE EXCEPTION 'FALLO saldo a favor: esperado 5, obtenido %', v_cxc_credito;
  END IF;

  SELECT totalcomision
  INTO v_comision
  FROM public.comisiones
  WHERE despachoid = v_despacho;
  IF v_comision <> 9.58 THEN
    RAISE EXCEPTION 'FALLO comisión: esperado 9.58, obtenido %', v_comision;
  END IF;

  -- 4) Reversión de entrega e impacto financiero: restaura únicamente lo que
  -- todavía estaba fuera del inventario y elimina los CxC/comisiones no pagados
  -- dentro de la misma transacción.
  SELECT public.revertir_entrega_finanzas_atomica(
    v_despacho,
    'pendiente',
    v_operador,
    'STAGING E2E Operator',
    NULL
  ) INTO v_reversa;

  SELECT stock_actual INTO v_stock FROM public.productos WHERE id = v_producto;
  IF v_stock <> 10 THEN
    RAISE EXCEPTION 'FALLO stock después de reversión A: esperado 10, obtenido %', v_stock;
  END IF;

  SELECT stock_actual INTO v_stock FROM public.productos WHERE id = v_producto_intercambio;
  IF v_stock <> 5 THEN
    RAISE EXCEPTION 'FALLO stock después de reversión B: esperado 5, obtenido %', v_stock;
  END IF;

  SELECT COUNT(*)
  INTO v_cxc_count
  FROM public.cuentas_por_cobrar
  WHERE despacho_id = v_despacho;
  IF v_cxc_count <> 0 THEN
    RAISE EXCEPTION 'FALLO reversión financiera: quedaron % movimientos CxC', v_cxc_count;
  END IF;

  SELECT COUNT(*)
  INTO v_comision_count
  FROM public.comisiones
  WHERE despachoid = v_despacho;
  IF v_comision_count <> 0 THEN
    RAISE EXCEPTION 'FALLO reversión financiera: quedaron % comisiones', v_comision_count;
  END IF;

  SELECT saldo_pendiente, saldo_a_favor
  INTO v_saldo_pendiente, v_saldo_favor
  FROM public.clientes
  WHERE id = v_cliente;
  IF COALESCE(v_saldo_pendiente, 0) <> 0 OR COALESCE(v_saldo_favor, 0) <> 0 THEN
    RAISE EXCEPTION 'FALLO saldos después de reversión: pendiente=%, favor=%', v_saldo_pendiente, v_saldo_favor;
  END IF;

  -- 5) Liquidación local: porcentaje o tarifa fija, FIFO, idempotencia y reversa.
  SELECT public.liquidar_transportista(
    v_transportista,
    v_cuenta,
    v_transportista_neto,
    'STAGING-E2E-228',
    'Fixture temporal — pago local',
    v_operador,
    'staging-e2e-transportista-228'
  ) INTO v_pago_result;

  v_pago_id := (v_pago_result->>'pago_id')::UUID;
  IF v_pago_id IS NULL OR COALESCE((v_pago_result->>'despachos_marcados')::INTEGER, 0) <> 1 THEN
    RAISE EXCEPTION 'FALLO liquidación local: %', v_pago_result;
  END IF;

  SELECT flete_pagado INTO v_flete_pagado FROM public.notas_despacho WHERE id = v_despacho;
  IF v_flete_pagado IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLO liquidación local: el despacho no quedó pagado';
  END IF;

  SELECT flete_pagado INTO v_flete_pagado FROM public.notas_despacho WHERE id = v_despacho_carabobo;
  IF v_flete_pagado IS NOT FALSE THEN
    RAISE EXCEPTION 'FALLO nómina Carabobo: el despacho no debe quedar liquidado';
  END IF;

  -- Un pago que solo tenga un despacho de Carabobo debe rechazarse: la
  -- nómina externa nunca puede entrar al pool de liquidación.
  BEGIN
    PERFORM public.liquidar_transportista(
      v_transportista,
      v_cuenta,
      1,
      'STAGING-E2E-CARABOBO-228',
      'Debe rechazarse — nómina externa',
      v_operador,
      'staging-e2e-carabobo-228'
    );
    RAISE EXCEPTION 'FALLO: la liquidación aceptó un despacho de Carabobo';
  EXCEPTION WHEN others THEN
    IF position('SIN_DESPACHOS_LIQUIDABLES' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  SELECT public.liquidar_transportista(
    v_transportista,
    v_cuenta,
    v_transportista_neto,
    'STAGING-E2E-228',
    'Fixture temporal — pago local',
    v_operador,
    'staging-e2e-transportista-228'
  ) INTO v_pago_replay;

  IF (v_pago_replay->>'pago_id')::UUID <> v_pago_id
     OR COALESCE((v_pago_replay->>'idempotent_replay')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLO idempotencia liquidación local: %', v_pago_replay;
  END IF;

  PERFORM public.revertir_pago_transportista(
    v_pago_id,
    v_cuenta,
    v_operador,
    'STAGING E2E Operator'
  );

  SELECT flete_pagado INTO v_flete_pagado FROM public.notas_despacho WHERE id = v_despacho;
  IF v_flete_pagado IS NOT FALSE THEN
    RAISE EXCEPTION 'FALLO reversa liquidación local: el despacho sigue pagado';
  END IF;

  RAISE NOTICE 'PASS: entrega, compromiso, Kardex, devolución, intercambio, CxC, comisión, reversión financiera y liquidación local (% con neto %) validados.', v_transp_tipo, v_transportista_neto;
END;
$$;

-- Seguridad final: aunque todas las aserciones pasen, ningún fixture se
-- conserva y ningún dato de la base staging queda modificado.
ROLLBACK;

SELECT 'PASS — ensayo staging ejecutado y revertido; no persistieron fixtures' AS resultado;
