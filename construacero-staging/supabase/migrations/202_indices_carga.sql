-- 202_indices_carga.sql
-- Índices faltantes detectados en auditoría de rendimiento (2026-07-20).
-- Columnas consultadas con frecuencia por el frontend/worker sin índice:
--   • notas_despacho.cliente_id / cliente_factura_id — búsqueda de despachos por cliente
--     (useDespachos.js: or(cliente_id.in..., cliente_factura_id.in...)) y checks del worker
--   • notas_despacho.creado_en — filtro "hoy" en despachos y ORDER BY en reportes
--   • notas_despacho.entregada_en — métricas del dashboard (entregada_en >= inicioMes)
--   • notas_despacho.transportista_id — FK joined en cada carga de lista de despachos
--   • cotizaciones.creado_en — métricas del dashboard (gte inicioMesAnterior)
-- Migración aditiva e idempotente: segura de aplicar en producción.

CREATE INDEX IF NOT EXISTS idx_nd_cliente_id
  ON public.notas_despacho (cliente_id);

CREATE INDEX IF NOT EXISTS idx_nd_cliente_factura_id
  ON public.notas_despacho (cliente_factura_id);

CREATE INDEX IF NOT EXISTS idx_nd_creado_en
  ON public.notas_despacho (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_nd_entregada_en
  ON public.notas_despacho (entregada_en DESC);

CREATE INDEX IF NOT EXISTS idx_nd_transportista_id
  ON public.notas_despacho (transportista_id);

CREATE INDEX IF NOT EXISTS idx_cot_creado_en
  ON public.cotizaciones (creado_en DESC);
