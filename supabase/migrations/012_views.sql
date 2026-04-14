-- 012_views.sql
-- Las vistas son la única forma de ocultar columnas en Supabase/PostgREST

-- Vista de productos para VENDEDORES (sin costo_usd)
CREATE OR REPLACE VIEW public.v_productos_vendedor AS
SELECT
  id,
  codigo,
  nombre,
  descripcion,
  categoria,
  unidad,
  precio_usd,
  -- costo_usd OMITIDO intencionalmente
  stock_actual,
  stock_minimo,
  imagen_url,
  activo,
  creado_en,
  actualizado_en
FROM public.productos
WHERE activo = true;

COMMENT ON VIEW public.v_productos_vendedor
  IS 'Vista sin costo_usd. Para uso exclusivo del rol vendedor.';


-- Vista de cotizaciones para VENDEDORES (sin notas_internas)
CREATE OR REPLACE VIEW public.v_cotizaciones_vendedor AS
SELECT
  id,
  numero,
  version,
  cotizacion_raiz_id,
  cliente_id,
  vendedor_id,
  transportista_id,
  estado,
  subtotal_usd,
  descuento_global_pct,
  descuento_usd,
  costo_envio_usd,
  total_usd,
  tasa_bcv_snapshot,
  total_bs_snapshot,
  valida_hasta,
  notas_cliente,
  -- notas_internas OMITIDO intencionalmente
  creado_en,
  actualizado_en,
  enviada_en,
  exportada_en
FROM public.cotizaciones;

COMMENT ON VIEW public.v_cotizaciones_vendedor
  IS 'Vista sin notas_internas. Para uso exclusivo del rol vendedor.';
