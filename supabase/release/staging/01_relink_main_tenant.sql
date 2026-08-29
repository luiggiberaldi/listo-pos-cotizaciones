-- APLICACIÓN TRANSACCIONAL — staging únicamente
-- Proyecto esperado: spupqgkdsgohxxfoxydl
-- Destino: cuenta auth supervisor@listo.sys
-- Origen: configuración id=1 de CONSTRUACERO CARABOBO C.A.
--
-- IMPORTANTE:
--   * Ejecutar solo después de revisar 00_preflight.sql.
--   * Conservar backup_staging_2026-08-16.dump.
--   * No cambia auth.users, contraseñas ni correos.
--   * No mezcla el segundo tenant restaurado.
--   * Crea temporalmente una copia de la configuración para respetar la
--     relación de buzon_sugerencias, mueve sus filas y luego conserva el id 1.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  v_destino UUID;
  v_origen UUID;
  v_nombre TEXT;
  v_tabla TEXT;
  v_actualizadas BIGINT;
  v_usuarios_origen BIGINT;
  v_usuarios_destino BIGINT;
  v_config_destino BIGINT;
  v_config_temporal INTEGER;
BEGIN
  -- Resolver la cuenta de staging sin modificar autenticación.
  SELECT id
    INTO v_destino
  FROM auth.users
  WHERE lower(email) = 'supervisor@listo.sys';

  IF v_destino IS NULL THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: no existe supervisor@listo.sys en staging';
  END IF;

  -- Resolver únicamente el tenant principal identificado por su configuración.
  SELECT cuenta_id, nombre_negocio
    INTO v_origen, v_nombre
  FROM public.configuracion_negocio
  WHERE id = 1
    AND lower(coalesce(nombre_negocio, '')) LIKE '%construacero%';

  IF v_origen IS NULL THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: no se encontró la configuración principal de Construacero';
  END IF;

  IF v_origen = v_destino THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: el origen y el destino ya son la misma cuenta';
  END IF;

  -- Nunca mezclar con datos que ya pertenezcan al destino.
  SELECT count(*) INTO v_usuarios_destino
  FROM public.usuarios
  WHERE cuenta_id = v_destino;

  SELECT count(*) INTO v_config_destino
  FROM public.configuracion_negocio
  WHERE cuenta_id = v_destino;

  IF v_usuarios_destino > 0 OR v_config_destino > 0 THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: la cuenta de staging ya tiene datos (% usuarios, % configuraciones)',
      v_usuarios_destino, v_config_destino;
  END IF;

  SELECT count(*) INTO v_usuarios_origen
  FROM public.usuarios
  WHERE cuenta_id = v_origen;

  -- La copia revisada contiene diez operadores en el tenant principal.
  IF v_usuarios_origen <> 10 THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: se esperaban 10 operadores en el tenant principal, se encontraron %',
      v_usuarios_origen;
  END IF;

  -- Evitar que otra operación de configuración cambie el máximo de id durante
  -- la creación temporal. La tabla no usa una secuencia automática.
  LOCK TABLE public.configuracion_negocio IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(max(id), 0) + 1 INTO v_config_temporal
  FROM public.configuracion_negocio;

  -- Crear una configuración temporal con la cuenta nueva. Esto mantiene viva
  -- la FK de buzon_sugerencias mientras sus filas pasan al destino.
  INSERT INTO public.configuracion_negocio (
    id,
    nombre_negocio,
    rif_negocio,
    telefono_negocio,
    direccion_negocio,
    email_negocio,
    logo_url,
    moneda_principal,
    validez_cotizacion_dias,
    pie_pagina_pdf,
    tasa_bcv_manual,
    creado_en,
    actualizado_en,
    gate_email,
    gate_password_hash,
    iva_pct,
    comision_pct_cabilla,
    comision_pct_otros,
    comision_categoria_cabilla,
    _comision_extras,
    cuenta_id,
    comision_pct_externos,
    nota_entrega_mostrar_iva,
    nota_entrega_plantilla,
    markup_pct_externo,
    comision_ext_pct_cabilla,
    comision_ext_pct_otros,
    comision_ext_pct_externos,
    _comision_ext_extras,
    descuento_personal_pct
  )
  SELECT
    v_config_temporal,
    nombre_negocio,
    rif_negocio,
    telefono_negocio,
    direccion_negocio,
    email_negocio,
    logo_url,
    moneda_principal,
    validez_cotizacion_dias,
    pie_pagina_pdf,
    tasa_bcv_manual,
    creado_en,
    actualizado_en,
    gate_email,
    gate_password_hash,
    iva_pct,
    comision_pct_cabilla,
    comision_pct_otros,
    comision_categoria_cabilla,
    _comision_extras,
    v_destino,
    comision_pct_externos,
    nota_entrega_mostrar_iva,
    nota_entrega_plantilla,
    markup_pct_externo,
    comision_ext_pct_cabilla,
    comision_ext_pct_otros,
    comision_ext_pct_externos,
    _comision_ext_extras,
    descuento_personal_pct
  FROM public.configuracion_negocio
  WHERE id = 1 AND cuenta_id = v_origen;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: no se pudo crear la configuración temporal';
  END IF;

  RAISE NOTICE 'Enlazando tenant % (%) con %', v_origen, v_nombre, v_destino;

  -- La configuración temporal ya permite actualizar las tablas dependientes.
  -- Las filas de otros tenants y las filas NULL permanecen intactas.
  FOREACH v_tabla IN ARRAY ARRAY[
    'auditoria',
    'buzon_sugerencias',
    'clientes',
    'comision_liberaciones',
    'cotizacion_items',
    'cotizaciones',
    'cuentas_por_cobrar',
    'cuentas_por_pagar',
    'despacho_descuentos',
    'inventario_movimientos',
    'notas_despacho',
    'notas_despacho_items',
    'orden_compra_items',
    'ordenes_compra',
    'pagos_transportistas',
    'pagos_transportistas_despachos',
    'productos',
    'proveedores',
    'reasignaciones_clientes',
    'seguimiento_operativo',
    'transportistas',
    'usuarios'
  ] LOOP
    EXECUTE format(
      'UPDATE public.%I SET cuenta_id = $1 WHERE cuenta_id = $2',
      v_tabla
    ) USING v_destino, v_origen;
    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
    IF v_actualizadas > 0 THEN
      RAISE NOTICE '%: % filas enlazadas', v_tabla, v_actualizadas;
    END IF;
  END LOOP;

  -- Ya no quedan filas apuntando a la configuración anterior.
  DELETE FROM public.configuracion_negocio
  WHERE id = 1 AND cuenta_id = v_origen;

  -- Conservar el id 1 para no romper referencias lógicas históricas.
  UPDATE public.configuracion_negocio
  SET id = 1
  WHERE id = v_config_temporal AND cuenta_id = v_destino;

  -- Confirmación mínima dentro de la misma transacción.
  SELECT count(*) INTO v_usuarios_destino
  FROM public.usuarios
  WHERE cuenta_id = v_destino AND activo = true;

  IF v_usuarios_destino <> 9 THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: se esperaban 9 operadores activos después del enlace, se encontraron %',
      v_usuarios_destino;
  END IF;

  IF (SELECT count(*) FROM public.configuracion_negocio WHERE cuenta_id = v_destino) <> 1 THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: la configuración final del destino no es única';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.configuracion_negocio
    WHERE cuenta_id = v_origen
  ) THEN
    RAISE EXCEPTION 'ENLACE_ABORTADO: aún existe una configuración del tenant principal antiguo';
  END IF;

  RAISE NOTICE 'Preconfirmación correcta: % operadores activos enlazados', v_usuarios_destino;
END $$;

COMMIT;
