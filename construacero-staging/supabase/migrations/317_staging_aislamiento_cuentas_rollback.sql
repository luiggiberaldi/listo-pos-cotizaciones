-- Rollback de 317_staging_aislamiento_cuentas.sql (Solo STAGING). Vuelve a abrir A4: solo emergencia.
BEGIN;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.auditoria;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.buzon_sugerencias;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.clientes;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.comision_designacion_diaria;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.comision_liberaciones;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.configuracion_negocio;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cotizacion_items;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cotizaciones;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cuentas_por_cobrar;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cuentas_por_pagar;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_descuentos;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.inventario_movimientos;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.notas_despacho;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.notas_despacho_items;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.orden_compra_items;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.ordenes_compra;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.pagos_transportistas;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.pagos_transportistas_despachos;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.productos;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.proveedores;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.reasignaciones_clientes;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.seguimiento_operativo;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.transportistas;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.vehiculos;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.usuarios;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.comisiones;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.cliente_prestamos;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devoluciones;
DROP POLICY IF EXISTS "aislamiento_cuenta" ON public.despacho_devolucion_intercambios;
GRANT SELECT ON public.productos, public.inventario_movimientos, public.cuentas_por_cobrar, public.comisiones, public.despacho_devoluciones, public.despacho_devolucion_intercambios TO anon;

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
      p.precio_usd, p.precio_2, p.precio_3,
      p.stock_actual, p.stock_minimo, p.activo, p.imagen_url
    FROM productos p
    WHERE p.activo = true
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

GRANT EXECUTE ON FUNCTION public.buscar_productos_hibrido(text, vector, text, boolean, integer, integer, uuid, boolean) TO authenticated;
COMMIT;
