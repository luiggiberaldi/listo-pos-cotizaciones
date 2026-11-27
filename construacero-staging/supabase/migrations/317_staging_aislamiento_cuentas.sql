-- 317_staging_aislamiento_cuentas.sql — Solo STAGING (OP-2026-086, Fase 5 de OP-2026-078, hallazgo A4)
-- Cada empresa (cuenta) solo ve y toca sus propios datos.
-- 1) Regla de bloqueo general (política RESTRICTIVA) "aislamiento_cuenta" en cada tabla con datos de
--    empresa: se suma a las reglas existentes (que filtran por rol) y exige cuenta_id = auth.uid().
--    Las tablas hijas sin cuenta_id heredan la empresa de su padre (cliente o despacho).
--    El servidor (service_role) no se ve afectado.
-- 2) Usuarios sin sesión (anon) ya no leen directo productos, Kardex, cobros, comisiones ni devoluciones
--    (el catálogo público sigue en la vista v_catalogo_publico).
-- 3) Funciones de catálogo con permisos de dueño filtran por la empresa de quien llama.
-- 4) buscar_productos_hibrido queda solo para el servidor (que siempre envía p_cuenta_id).
-- Rollback: 317_staging_aislamiento_cuentas_rollback.sql
BEGIN;

REVOKE SELECT ON public.productos, public.inventario_movimientos, public.cuentas_por_cobrar, public.comisiones, public.despacho_devoluciones, public.despacho_devolucion_intercambios FROM anon;

DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.auditoria;
CREATE POLICY "aislamiento_cuenta" ON public.auditoria AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.buzon_sugerencias;
CREATE POLICY "aislamiento_cuenta" ON public.buzon_sugerencias AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.clientes;
CREATE POLICY "aislamiento_cuenta" ON public.clientes AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.comision_designacion_diaria;
CREATE POLICY "aislamiento_cuenta" ON public.comision_designacion_diaria AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.comision_liberaciones;
CREATE POLICY "aislamiento_cuenta" ON public.comision_liberaciones AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.configuracion_negocio;
CREATE POLICY "aislamiento_cuenta" ON public.configuracion_negocio AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cotizacion_items;
CREATE POLICY "aislamiento_cuenta" ON public.cotizacion_items AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cotizaciones;
CREATE POLICY "aislamiento_cuenta" ON public.cotizaciones AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cuentas_por_cobrar;
CREATE POLICY "aislamiento_cuenta" ON public.cuentas_por_cobrar AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cuentas_por_pagar;
CREATE POLICY "aislamiento_cuenta" ON public.cuentas_por_pagar AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_descuentos;
CREATE POLICY "aislamiento_cuenta" ON public.despacho_descuentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.inventario_movimientos;
CREATE POLICY "aislamiento_cuenta" ON public.inventario_movimientos AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.notas_despacho;
CREATE POLICY "aislamiento_cuenta" ON public.notas_despacho AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.notas_despacho_items;
CREATE POLICY "aislamiento_cuenta" ON public.notas_despacho_items AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.orden_compra_items;
CREATE POLICY "aislamiento_cuenta" ON public.orden_compra_items AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.ordenes_compra;
CREATE POLICY "aislamiento_cuenta" ON public.ordenes_compra AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.pagos_transportistas;
CREATE POLICY "aislamiento_cuenta" ON public.pagos_transportistas AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.pagos_transportistas_despachos;
CREATE POLICY "aislamiento_cuenta" ON public.pagos_transportistas_despachos AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.productos;
CREATE POLICY "aislamiento_cuenta" ON public.productos AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.proveedores;
CREATE POLICY "aislamiento_cuenta" ON public.proveedores AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.reasignaciones_clientes;
CREATE POLICY "aislamiento_cuenta" ON public.reasignaciones_clientes AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.seguimiento_operativo;
CREATE POLICY "aislamiento_cuenta" ON public.seguimiento_operativo AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.transportistas;
CREATE POLICY "aislamiento_cuenta" ON public.transportistas AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.vehiculos;
CREATE POLICY "aislamiento_cuenta" ON public.vehiculos AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.usuarios;
CREATE POLICY "aislamiento_cuenta" ON public.usuarios AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = (SELECT auth.uid())) WITH CHECK (cuenta_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.comisiones;
CREATE POLICY "aislamiento_cuenta" ON public.comisiones AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuentaid = (SELECT auth.uid())) WITH CHECK (cuentaid = (SELECT auth.uid()));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cliente_prestamos;
CREATE POLICY "aislamiento_cuenta" ON public.cliente_prestamos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = cliente_prestamos.cliente_id AND c.cuenta_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = cliente_prestamos.cliente_id AND c.cuenta_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devoluciones;
CREATE POLICY "aislamiento_cuenta" ON public.despacho_devoluciones AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devoluciones.despacho_id AND d.cuenta_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devoluciones.despacho_id AND d.cuenta_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devolucion_intercambios;
CREATE POLICY "aislamiento_cuenta" ON public.despacho_devolucion_intercambios AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devolucion_intercambios.despacho_id AND d.cuenta_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_devolucion_intercambios.despacho_id AND d.cuenta_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.obtener_stock_productos(p_ids uuid[])
 RETURNS TABLE(id uuid, stock_actual numeric, nombre text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.stock_actual, p.nombre
  FROM productos p
  WHERE p.id = ANY(p_ids) AND p.activo = true
    AND (auth.uid() IS NULL OR p.cuenta_id = (SELECT auth.uid()));
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
    AND (auth.uid() IS NULL OR p.cuenta_id = (SELECT auth.uid()))
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
      AND (auth.uid() IS NULL OR p.cuenta_id = (SELECT auth.uid()))
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

REVOKE ALL ON FUNCTION public.buscar_productos_hibrido(text, vector, text, boolean, integer, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_productos_hibrido(text, vector, text, boolean, integer, integer, uuid, boolean) TO service_role;

COMMIT;
