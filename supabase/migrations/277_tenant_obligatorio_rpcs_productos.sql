-- 277: Tenant obligatorio y grants mínimos para las RPCs de productos
--
-- Cierra la exposición entre tenants detectada en la auditoría 2026-10-18:
--   * buscar_productos_hibrido: ejecutable por cualquier rol (EXECUTE por
--     defecto a PUBLIC + GRANT a authenticated) y aceptaba p_cuenta_id NULL =
--     TODOS los tenants, exponiendo costo_usd, precios y stock entre cuentas.
--   * obtener_productos_vendedor: SECURITY DEFINER SIN filtro de cuenta
--     (salta las políticas RLS cuenta_id = auth.uid() de las migraciones
--     104/132), exponiendo el catálogo completo de todos los tenants.
--
-- Endurecimiento:
--   1. buscar_productos_hibrido: p_cuenta_id obligatorio (RAISE si NULL),
--      rechaza cuentas ajenas cuando hay JWT, y ejecutable SOLO por
--      service_role (el Worker es su único consumidor verificado).
--   2. obtener_productos_vendedor: filtra p.cuenta_id = auth.uid() (mismo
--      modelo de tenant que la RLS de productos). Sigue disponible para
--      authenticated porque el frontend la llama directo; con el filtro ya
--      no cruza tenants.
--
-- Requiere la migración 276 aplicada primero (este cuerpo conserva los flags
-- precio2_habilitado / precio3_habilitado de buscar_productos_hibrido).

-- ─── 1. buscar_productos_hibrido: tenant obligatorio + solo service_role ─────
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
  -- Tenant obligatorio: NULL ya no significa "todos los tenants".
  IF p_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_REQUERIDA';
  END IF;
  -- Defensa en profundidad: con JWT presente, solo la propia cuenta.
  IF auth.uid() IS NOT NULL AND p_cuenta_id <> auth.uid() THEN
    RAISE EXCEPTION 'CUENTA_NO_AUTORIZADA';
  END IF;

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
    WHERE p.cuenta_id = p_cuenta_id
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

REVOKE ALL ON FUNCTION public.buscar_productos_hibrido(text, public.vector, text, boolean, integer, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_productos_hibrido(text, public.vector, text, boolean, integer, integer, uuid, boolean) TO service_role;

-- ─── 2. obtener_productos_vendedor: filtrar por la cuenta del JWT ────────────
-- Cuerpo de la migración 276 (oculta valores de precios inhabilitados) + el
-- filtro de tenant que faltaba. Misma firma y mismas columnas de retorno.
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
$$;

REVOKE ALL ON FUNCTION public.obtener_productos_vendedor(text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_productos_vendedor(text, text, boolean, integer, integer) TO authenticated, service_role;
