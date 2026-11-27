-- 317_prod_seguridad_rpcs_rls_y_catalogo_rollback.sql — Vuelta atrás exacta de 317
BEGIN;

GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_lote(tipo_movimiento, text, motivo_movimiento, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_despacho(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_comision_pagada(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_cxc(uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reasignar_cliente(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reciclar_cotizacion(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reciclar_despacho(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tester_cleanup_cotizacion(p_cotizacion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_id UUID := auth.uid();
  v_rol TEXT := COALESCE(
    auth.jwt()->'app_metadata'->>'operator_rol',
    public.get_rol_actual()
  );
  v_cotizacion_cuenta_id UUID;
  v_despacho_ids UUID[];
  v_comision_ids UUID[];
  v_pago_ids UUID[];
BEGIN
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'TESTER_AUTH_REQUIRED: se requiere una sesión autenticada';
  END IF;

  IF v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'TESTER_ROLE_REQUIRED: solo roles privilegiados pueden ejecutar limpieza';
  END IF;

  SELECT cuenta_id
    INTO v_cotizacion_cuenta_id
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_cotizacion_cuenta_id IS DISTINCT FROM v_cuenta_id THEN
    RAISE EXCEPTION 'TESTER_TENANT_MISMATCH: la cotización no pertenece a la cuenta actual';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
    INTO v_despacho_ids
  FROM public.notas_despacho
  WHERE cotizacion_id = p_cotizacion_id;

  IF cardinality(v_despacho_ids) > 0 THEN
    -- Esta tabla no tenía ON DELETE CASCADE hacia notas_despacho. Capturar
    -- primero los pagos del fixture para no dejar registros append-only huérfanos.
    SELECT COALESCE(array_agg(DISTINCT pago_id), ARRAY[]::UUID[])
      INTO v_pago_ids
    FROM public.pagos_transportistas_despachos
    WHERE despacho_id = ANY(v_despacho_ids)
      AND cuenta_id = v_cuenta_id;

    DELETE FROM public.pagos_transportistas_despachos
    WHERE despacho_id = ANY(v_despacho_ids)
      AND cuenta_id = v_cuenta_id;

    -- Solo borrar el pago si ya no conserva vínculos con otros despachos. Así
    -- la limpieza tenant-safe no puede tocar una liquidación real compartida.
    IF cardinality(v_pago_ids) > 0 THEN
      DELETE FROM public.pagos_transportistas p
      WHERE p.id = ANY(v_pago_ids)
        AND p.cuenta_id = v_cuenta_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.pagos_transportistas_despachos j
          WHERE j.pago_id = p.id
        );
    END IF;

    DELETE FROM public.despacho_descuentos
    WHERE despacho_id = ANY(v_despacho_ids);

    DELETE FROM public.cuentas_por_cobrar
    WHERE despacho_id = ANY(v_despacho_ids);

    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
      INTO v_comision_ids
    FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    -- comision_liberaciones tiene ON DELETE CASCADE, pero se elimina de forma
    -- explícita para que el contrato siga siendo claro ante esquemas antiguos.
    IF cardinality(v_comision_ids) > 0 THEN
      DELETE FROM public.comision_liberaciones
      WHERE comision_id = ANY(v_comision_ids);
    END IF;

    DELETE FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    DELETE FROM public.notas_despacho
    WHERE id = ANY(v_despacho_ids);
  END IF;

  DELETE FROM public.comisiones
  WHERE cotizacionid = p_cotizacion_id;

  DELETE FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id;

  DELETE FROM public.cotizaciones
  WHERE id = p_cotizacion_id;
END;
$function$;

GRANT INSERT, UPDATE, DELETE ON TABLE public.cliente_prestamos TO authenticated;

DROP POLICY IF EXISTS "cliente_prestamos_select_cuenta" ON public.cliente_prestamos;
CREATE POLICY "Permitir todo a operadores autorizados en cliente_prestamos" ON public.cliente_prestamos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devoluciones;
DROP POLICY IF EXISTS "despacho_devoluciones_select_cuenta" ON public.despacho_devoluciones;
CREATE POLICY "Permitir todo a operadores autorizados en despacho_devoluciones" ON public.despacho_devoluciones FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devolucion_intercambios;
DROP POLICY IF EXISTS "despacho_devolucion_intercambios_select_cuenta" ON public.despacho_devolucion_intercambios;
CREATE POLICY "Permitir todo a operadores autorizados en despacho_devolucion_i" ON public.despacho_devolucion_intercambios FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.obtener_stock_productos(p_ids uuid[])
 RETURNS TABLE(id uuid, stock_actual numeric, nombre text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.stock_actual, p.nombre
  FROM productos p
  WHERE p.id = ANY(p_ids) AND p.activo = true;
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
      p.precio_usd,
      CASE WHEN p.precio2_habilitado THEN p.precio_2 END AS precio_2,
      CASE WHEN p.precio3_habilitado THEN p.precio_3 END AS precio_3,
      p.stock_actual, p.stock_minimo, p.activo, p.imagen_url
    FROM productos p
    WHERE p.activo = true
      AND p.cuenta_id = auth.uid()
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

COMMIT;
