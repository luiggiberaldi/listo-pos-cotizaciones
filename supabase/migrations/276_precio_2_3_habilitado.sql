-- 276: Habilitar/inhabilitar Precio 2 y Precio 3 por producto
--
-- Regla de negocio: cada producto decide si ofrece Precio 2 (Mayor) y Precio 3
-- (Especial). Un precio inhabilitado NO debe aparecer en cotizaciones, venta
-- rápida ni inventario; el VALOR se conserva en la base (no se borra) y sigue
-- visible en el formulario de producto (superficie de gestión).
--
-- Capas:
--   1. Columnas `precio2_habilitado` / `precio3_habilitado` (DEFAULT TRUE =
--      comportamiento actual sin cambios para los productos existentes).
--   2. `obtener_productos_vendedor`: los valores de precios inhabilitados se
--      ocultan al vendedor (CASE → NULL), en paralelo al ocultamiento de
--      `costo_usd` que esta RPC ya hace por diseño.
--   3. `buscar_productos_hibrido`: expone los flags para que el frontend
--      privilegiado pueda ocultar en presentación (el Worker hace el
--      stripping por rol para no privilegiados, igual que con `costo_usd`).
--
-- Los flags se escriben por `/api/productos/metadatos` (Worker/service_role,
-- mismo canal que `activo` e `imagen_url`); las RPC crear/actualizar producto
-- NO cambian de firma.

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS precio2_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS precio3_habilitado BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.productos.precio2_habilitado IS
  'FALSE = Precio 2 (Mayor) inhabilitado: se oculta en venta/cotización/inventario. El valor de precio_2 se conserva.';
COMMENT ON COLUMN public.productos.precio3_habilitado IS
  'FALSE = Precio 3 (Especial) inhabilitado: se oculta en venta/cotización/inventario. El valor de precio_3 se conserva.';

-- ─── 2. obtener_productos_vendedor: ocultar valores inhabilitados ────────────
-- Misma firma y mismas columnas de retorno que la versión 202; solo cambia que
-- precio_2/precio_3 llegan como NULL cuando el precio está inhabilitado.
CREATE OR REPLACE FUNCTION public.obtener_productos_vendedor(
  p_busqueda TEXT DEFAULT '',
  p_categoria TEXT DEFAULT '',
  p_categoria_grupo BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  codigo TEXT,
  nombre TEXT,
  descripcion TEXT,
  categoria TEXT,
  unidad TEXT,
  precio_usd NUMERIC,
  precio_2 NUMERIC,
  precio_3 NUMERIC,
  stock_actual NUMERIC,
  stock_minimo NUMERIC,
  activo BOOLEAN,
  imagen_url TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ─── 3. buscar_productos_hibrido: exponer los flags ──────────────────────────
-- Cambia el tipo de retorno → DROP + CREATE (no admite CREATE OR REPLACE).
DROP FUNCTION IF EXISTS public.buscar_productos_hibrido(text, public.vector, text, boolean, integer, integer, uuid, boolean);

CREATE OR REPLACE FUNCTION public.buscar_productos_hibrido(
  p_busqueda TEXT DEFAULT '',
  p_embedding public.vector DEFAULT NULL,
  p_categoria TEXT DEFAULT '',
  p_categoria_grupo BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_cuenta_id UUID DEFAULT NULL,
  p_incluir_inactivos BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  codigo TEXT,
  nombre TEXT,
  descripcion TEXT,
  categoria TEXT,
  unidad TEXT,
  precio_usd NUMERIC,
  precio_2 NUMERIC,
  precio_3 NUMERIC,
  precio1_porcentaje NUMERIC,
  precio2_porcentaje NUMERIC,
  precio3_porcentaje NUMERIC,
  precio2_habilitado BOOLEAN,
  precio3_habilitado BOOLEAN,
  costo_usd NUMERIC,
  stock_actual NUMERIC,
  stock_minimo NUMERIC,
  activo BOOLEAN,
  imagen_url TEXT,
  vector_distance DOUBLE PRECISION,
  total_count BIGINT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_tsquery tsquery;
  v_has_fts BOOLEAN := FALSE;
  v_has_sem BOOLEAN := FALSE;
BEGIN
  IF p_busqueda IS NOT NULL AND trim(p_busqueda) <> '' THEN
    v_tsquery := plainto_tsquery('spanish', p_busqueda);
    v_has_fts := TRUE;
  END IF;

  IF p_embedding IS NOT NULL THEN
    v_has_sem := TRUE;
  END IF;

  RETURN QUERY
  WITH filtered_products AS (
    SELECT 
      p.id,
      p.codigo,
      p.nombre,
      p.descripcion,
      p.categoria,
      p.unidad,
      p.precio_usd,
      p.precio_2,
      p.precio_3,
      p.precio1_porcentaje,
      p.precio2_porcentaje,
      p.precio3_porcentaje,
      p.precio2_habilitado,
      p.precio3_habilitado,
      p.costo_usd,
      p.stock_actual,
      p.stock_minimo,
      p.activo,
      p.imagen_url,
      CASE 
        WHEN v_has_sem THEN (p.vector_embedding <=> p_embedding)
        ELSE 0.0
      END AS dist
    FROM public.productos p
    WHERE 
      (p_cuenta_id IS NULL OR p.cuenta_id = p_cuenta_id)
      AND (p_incluir_inactivos = TRUE OR p.activo = TRUE)
      AND (
        p_categoria = '' OR 
        (p_categoria_grupo = TRUE AND p.categoria ILIKE p_categoria || '%') OR 
        (p_categoria_grupo = FALSE AND p.categoria = p_categoria)
      )
      AND (
        NOT v_has_fts OR 
        to_tsvector('spanish', p.nombre) @@ v_tsquery OR
        p.codigo ILIKE '%' || p_busqueda || '%' OR
        p.nombre ILIKE '%' || p_busqueda || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS cnt FROM filtered_products
  )
  SELECT 
    fp.id,
    fp.codigo,
    fp.nombre,
    fp.descripcion,
    fp.categoria,
    fp.unidad,
    fp.precio_usd,
    fp.precio_2,
    fp.precio_3,
    fp.precio1_porcentaje,
    fp.precio2_porcentaje,
    fp.precio3_porcentaje,
    fp.precio2_habilitado,
    fp.precio3_habilitado,
    fp.costo_usd,
    fp.stock_actual,
    fp.stock_minimo,
    fp.activo,
    fp.imagen_url,
    fp.dist::double precision AS vector_distance,
    c.cnt AS total_count
  FROM filtered_products fp
  CROSS JOIN counted c
  ORDER BY 
    CASE WHEN v_has_sem THEN fp.dist ELSE 0.0 END ASC,
    fp.nombre ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_productos_hibrido(text, public.vector, text, boolean, integer, integer, uuid, boolean) TO authenticated, service_role;
