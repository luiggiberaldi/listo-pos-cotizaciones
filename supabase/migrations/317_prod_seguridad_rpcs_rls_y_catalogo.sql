-- 317_prod_seguridad_rpcs_rls_y_catalogo.sql — PRODUCCIÓN (OP-2026-097)
-- Cierra todos los hallazgos pendientes de INC-004, N30, C1, A4 y M5 en producción:
-- 1) Cierra RPCs de dinero/inventario/estado que estaban abiertas a anon/authenticated.
-- 2) Limita tester_cleanup_cotizacion a la propia cuenta (M5).
-- 3) Revoca escritura directa en cliente_prestamos, despacho_devoluciones,
--    despacho_devolucion_intercambios, productos, inventario_movimientos y cuentas_por_cobrar (N30).
-- 4) Revoca SELECT de anon en tablas operativas y agrega aislamiento RESTRICTIVE en
--    despacho_devoluciones y despacho_devolucion_intercambios, quitando políticas USING(true).
-- 5) Corrige funciones de catálogo (A4) usando auth.role() = 'service_role' OR cuenta_id = auth.uid(),
--    conservando intacta la regla de producción precio2_habilitado / precio3_habilitado.
-- Rollback: 317_prod_seguridad_rpcs_rls_y_catalogo_rollback.sql
BEGIN;

-- 1) Cerrar RPCs de dinero / inventario / estado abiertas a anon o authenticated
REVOKE ALL ON FUNCTION public.aplicar_movimiento_lote(tipo_movimiento, text, motivo_movimiento, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_lote(tipo_movimiento, text, motivo_movimiento, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.actualizar_estado_despacho(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_despacho(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.marcar_comision_pagada(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_comision_pagada(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_abono_cxc(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_cxc(uuid, numeric, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_cargo_cxc(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cargo_cxc(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.reasignar_cliente(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reasignar_cliente(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.reciclar_cotizacion(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reciclar_cotizacion(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.reciclar_despacho(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reciclar_despacho(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.calcularcomisiondespacho_238b(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text) TO service_role;

-- 2) M5: tester_cleanup_cotizacion solo borra dentro de la propia cuenta
CREATE OR REPLACE FUNCTION public.tester_cleanup_cotizacion(p_cotizacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
  v_despacho_ids UUID[] := '{}'::UUID[];
  v_comision_ids UUID[] := '{}'::UUID[];
  v_item_ids UUID[] := '{}'::UUID[];
BEGIN
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'TESTER_ROLE_REQUIRED: solo roles privilegiados pueden ejecutar limpieza';
  END IF;

  -- OP-2026-086 (M5): solo borra cotizaciones de la propia cuenta (salvo el servidor).
  --   Si la cotización ya no existe, no hace nada (igual que antes).
  IF auth.role() IS DISTINCT FROM 'service_role' AND EXISTS (
    SELECT 1 FROM public.cotizaciones c
    WHERE c.id = p_cotizacion_id
      AND c.cuenta_id IS DISTINCT FROM (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'COTIZACION_DE_OTRA_CUENTA';
  END IF;

  SELECT array_agg(id) INTO v_despacho_ids
  FROM public.notas_despacho
  WHERE cotizacion_id = p_cotizacion_id;

  IF v_despacho_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_item_ids
    FROM public.notas_despacho_items
    WHERE despacho_id = ANY(v_despacho_ids);

    IF v_item_ids IS NOT NULL THEN
      DELETE FROM public.despacho_descuentos WHERE despacho_item_id = ANY(v_item_ids);
    END IF;

    SELECT array_agg(id) INTO v_comision_ids
    FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    IF v_comision_ids IS NOT NULL THEN
      DELETE FROM public.comision_liberaciones WHERE comision_id = ANY(v_comision_ids);
      DELETE FROM public.comisiones WHERE id = ANY(v_comision_ids);
    END IF;

    DELETE FROM public.cliente_prestamos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.cuentas_por_cobrar WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_fecha_entrega_cambios WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.pagos_transportistas_despachos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.seguimiento_operativo WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_devoluciones WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_devolucion_intercambios WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho_items WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho WHERE id = ANY(v_despacho_ids);
  END IF;

  DELETE FROM public.comisiones WHERE cotizacionid = p_cotizacion_id;
  DELETE FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id;
  DELETE FROM public.cotizaciones WHERE id = p_cotizacion_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.tester_cleanup_cotizacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tester_cleanup_cotizacion(uuid) TO authenticated, service_role;

-- 3) N30 + INC-004: sin escritura directa del cliente y sin lectura anon
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.cliente_prestamos,
  public.despacho_devoluciones,
  public.despacho_devolucion_intercambios,
  public.productos,
  public.inventario_movimientos,
  public.cuentas_por_cobrar
FROM PUBLIC, anon, authenticated;

REVOKE SELECT ON TABLE
  public.productos,
  public.inventario_movimientos,
  public.cuentas_por_cobrar,
  public.comisiones,
  public.despacho_devoluciones,
  public.despacho_devolucion_intercambios
FROM anon;

-- 4) Reemplazar políticas USING(true) y añadir aislamiento RESTRICTIVE en tablas de devoluciones
DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en cliente_prestamos" ON public.cliente_prestamos;
DROP POLICY IF EXISTS "cliente_prestamos_select_cuenta" ON public.cliente_prestamos;
CREATE POLICY "cliente_prestamos_select_cuenta" ON public.cliente_prestamos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = cliente_prestamos.cliente_id AND c.cuenta_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devoluciones" ON public.despacho_devoluciones;
DROP POLICY IF EXISTS "despacho_devoluciones_select_cuenta" ON public.despacho_devoluciones;
CREATE POLICY "despacho_devoluciones_select_cuenta" ON public.despacho_devoluciones
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devoluciones.despacho_id AND d.cuenta_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devoluciones;
CREATE POLICY "aislamiento_cuenta" ON public.despacho_devoluciones AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devoluciones.despacho_id AND d.cuenta_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devoluciones.despacho_id AND d.cuenta_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devolucion_i" ON public.despacho_devolucion_intercambios;
DROP POLICY IF EXISTS "despacho_devolucion_intercambios_select_cuenta" ON public.despacho_devolucion_intercambios;
CREATE POLICY "despacho_devolucion_intercambios_select_cuenta" ON public.despacho_devolucion_intercambios
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devolucion_intercambios.despacho_id AND d.cuenta_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devolucion_intercambios;
CREATE POLICY "aislamiento_cuenta" ON public.despacho_devolucion_intercambios AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devolucion_intercambios.despacho_id AND d.cuenta_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devolucion_intercambios.despacho_id AND d.cuenta_id = (SELECT auth.uid())));

-- 5) A4: funciones de catálogo filtradas por empresa con auth.role() = 'service_role'
--    (conservando precio2_habilitado y precio3_habilitado de producción)
CREATE OR REPLACE FUNCTION public.obtener_stock_productos(p_ids uuid[])
 RETURNS TABLE(id uuid, stock_actual numeric, nombre text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.stock_actual, p.nombre
  FROM public.productos p
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
  FROM public.productos p
  WHERE p.activo = true AND p.categoria IS NOT NULL
    AND (auth.role() = 'service_role' OR p.cuenta_id = (SELECT auth.uid()))
  ORDER BY p.categoria ASC;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_productos_vendedor(
  p_busqueda text DEFAULT ''::text,
  p_categoria text DEFAULT ''::text,
  p_categoria_grupo boolean DEFAULT false,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
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
    FROM public.productos p
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
