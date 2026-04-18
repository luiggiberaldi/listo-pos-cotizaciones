-- 039_seguridad_datos_y_gate.sql
-- Auditoría de seguridad: blindar datos sensibles + gate server-side
-- Fecha: 2026-04-18

-- ═══════════════════════════════════════════════════════════════════════════════
-- A. RESTRINGIR TABLA productos A SOLO SUPERVISORES
-- ═══════════════════════════════════════════════════════════════════════════════
-- Antes: productos_todos_leen USING (activo = true) — cualquier authenticated leía todo
-- Después: solo supervisores pueden SELECT en la tabla base (incluye costo_usd)
-- Vendedores acceden vía RPCs que excluyen costo_usd

DROP POLICY IF EXISTS productos_todos_leen ON public.productos;

CREATE POLICY productos_supervisor_select ON public.productos
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- ═══════════════════════════════════════════════════════════════════════════════
-- B. RPCs PARA ACCESO DE VENDEDORES A PRODUCTOS
-- ═══════════════════════════════════════════════════════════════════════════════

-- B1. Listar productos (sin costo_usd) con búsqueda y paginación
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
  v_busqueda TEXT;
BEGIN
  v_busqueda := '%' || COALESCE(NULLIF(trim(p_busqueda), ''), '') || '%';

  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id, p.codigo, p.nombre, p.descripcion, p.categoria, p.unidad,
      p.precio_usd, p.stock_actual, p.stock_minimo, p.activo, p.imagen_url
    FROM productos p
    WHERE p.activo = true
      AND (p_busqueda = '' OR p.nombre ILIKE v_busqueda OR p.codigo ILIKE v_busqueda)
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

-- B2. Categorías únicas de productos activos
CREATE OR REPLACE FUNCTION public.obtener_categorias_vendedor()
RETURNS TABLE(categoria TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.categoria
  FROM productos p
  WHERE p.activo = true AND p.categoria IS NOT NULL
  ORDER BY p.categoria ASC;
$$;

-- B3. Stock de productos por IDs (para check antes de despacho)
CREATE OR REPLACE FUNCTION public.obtener_stock_productos(p_ids UUID[])
RETURNS TABLE(id UUID, stock_actual NUMERIC, nombre TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.stock_actual, p.nombre
  FROM productos p
  WHERE p.id = ANY(p_ids) AND p.activo = true;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- C. GATE LOGIN SERVER-SIDE
-- ═══════════════════════════════════════════════════════════════════════════════

-- C1. Validar credenciales del gate sin exponer el hash al cliente
-- El cliente envía el SHA-256 del password, la función compara server-side
CREATE OR REPLACE FUNCTION public.validar_gate_acceso(
  p_email TEXT,
  p_password_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_hash TEXT;
BEGIN
  SELECT gate_email, gate_password_hash
  INTO v_email, v_hash
  FROM configuracion_negocio
  WHERE id = 1;

  -- Si no hay gate configurado, permitir acceso
  IF v_email IS NULL OR v_hash IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN lower(trim(p_email)) = lower(trim(v_email))
     AND p_password_hash = v_hash;
END;
$$;

-- Permitir que usuarios no autenticados (anon) llamen esta función
GRANT EXECUTE ON FUNCTION public.validar_gate_acceso(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.validar_gate_acceso(TEXT, TEXT) TO authenticated;

-- C2. Saber si hay gate configurado (para decidir si mostrar el formulario)
CREATE OR REPLACE FUNCTION public.tiene_gate_configurado()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM configuracion_negocio
    WHERE id = 1
      AND gate_email IS NOT NULL
      AND gate_password_hash IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.tiene_gate_configurado() TO anon;
GRANT EXECUTE ON FUNCTION public.tiene_gate_configurado() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- D. RESTRINGIR configuracion_negocio A SOLO AUTENTICADOS
-- ═══════════════════════════════════════════════════════════════════════════════
-- Antes: config_todos_leen USING (true) — incluso anon podía leer gate_password_hash
-- Después: solo usuarios autenticados pueden leer (y gate se valida vía RPC)

DROP POLICY IF EXISTS config_todos_leen ON public.configuracion_negocio;

CREATE POLICY config_autenticados_leen ON public.configuracion_negocio
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
