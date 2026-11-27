-- 314_prod_decimales_4_digitos_rollback.sql — Vuelta atrás de 314
BEGIN;

DROP VIEW IF EXISTS public.despacho_pesos;
DROP VIEW IF EXISTS public.despacho_items_peso;
DROP VIEW IF EXISTS public.v_catalogo_publico;
DROP VIEW IF EXISTS public.v_productos_vendedor;

ALTER TABLE public.productos
  ALTER COLUMN stock_actual TYPE NUMERIC(10,2) USING ROUND(stock_actual::NUMERIC, 2),
  ALTER COLUMN stock_minimo TYPE NUMERIC(10,2) USING ROUND(stock_minimo::NUMERIC, 2);

ALTER TABLE public.inventario_movimientos
  ALTER COLUMN cantidad TYPE NUMERIC(10,2) USING ROUND(cantidad::NUMERIC, 2),
  ALTER COLUMN stock_anterior TYPE NUMERIC(10,2) USING ROUND(stock_anterior::NUMERIC, 2),
  ALTER COLUMN stock_nuevo TYPE NUMERIC(10,2) USING ROUND(stock_nuevo::NUMERIC, 2);

ALTER TABLE public.cotizacion_items
  ALTER COLUMN cantidad TYPE NUMERIC(10,2) USING ROUND(cantidad::NUMERIC, 2);

ALTER TABLE public.notas_despacho_items
  ALTER COLUMN cantidad TYPE NUMERIC(10,2) USING ROUND(cantidad::NUMERIC, 2),
  ALTER COLUMN cantidad_original TYPE NUMERIC(10,2) USING ROUND(cantidad_original::NUMERIC, 2);

CREATE VIEW public.despacho_items_peso WITH (security_invoker = true) AS
SELECT i.id AS item_id,
    i.despacho_id,
    i.producto_id,
    i.cantidad,
    w.peso_unit_kg,
    (i.cantidad * w.peso_unit_kg)::numeric(14,3) AS peso_linea_kg
   FROM notas_despacho_items i
     JOIN notas_despacho d ON d.id = i.despacho_id
     CROSS JOIN LATERAL ( SELECT COALESCE(i.peso_unit_kg_snap,
                CASE
                    WHEN d.estado = ANY (ARRAY['pendiente'::text, 'despachada'::text]) THEN peso_producto_visible(i.producto_id)
                    ELSE NULL::numeric
                END) AS peso_unit_kg) w;
REVOKE ALL ON public.despacho_items_peso FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.despacho_items_peso TO authenticated, service_role;

CREATE VIEW public.despacho_pesos WITH (security_invoker = true) AS
SELECT despacho_id,
    COALESCE(sum(peso_linea_kg), 0::numeric)::numeric(14,3) AS peso_total_kg,
    count(*) FILTER (WHERE peso_unit_kg IS NULL)::integer AS items_sin_peso,
    count(*)::integer AS items_total
   FROM despacho_items_peso
  GROUP BY despacho_id;
REVOKE ALL ON public.despacho_pesos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.despacho_pesos TO authenticated, service_role;

CREATE VIEW public.v_catalogo_publico WITH (security_invoker = true) AS
SELECT id,
    codigo,
    nombre,
    categoria,
    descripcion,
    unidad,
    precio_usd,
    stock_actual,
    imagen_url,
    activo
   FROM productos
  WHERE activo = true AND stock_actual > 0::numeric;
REVOKE ALL ON public.v_catalogo_publico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_catalogo_publico TO anon, authenticated, service_role;

CREATE VIEW public.v_productos_vendedor AS
SELECT id,
    codigo,
    nombre,
    descripcion,
    categoria,
    unidad,
    precio_usd,
    stock_actual,
    stock_minimo,
    imagen_url,
    activo,
    creado_en,
    actualizado_en
   FROM productos
  WHERE activo = true;
REVOKE ALL ON public.v_productos_vendedor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_productos_vendedor TO authenticated, service_role;

COMMIT;
