// src/utils/kardexRevertible.js
// Regla única (pantalla) de qué movimientos del Kardex se pueden revertir. La base aplica la misma
// regla en revertir_movimiento_inventario_atomico (migración 319).

export const ORIGENES_SISTEMA_NO_REVERTIBLES = new Set([
  'venta',
  'despacho',
  'devolucion',
  'loan_return',
  'transformacion_inventario',
  'batch_ingest',
  'reversion_inventario',
  'product_create',
  'product_update',
  'product_delete',
  'reconciliacion_kardex',
])

export const ORIGENES_MANUALES_REVERTIBLES = new Set([
  'movimiento_inventario',
  'conteo_fisico',
  'ajuste_inventario',
  'compra',
  'transferencia',
  'otro',
])

// OP-2026-086 (M1): lista de PERMITIDOS. Solo ajustes manuales y conteos; nunca ventas,
// devoluciones ni movimientos viejos sin origen (la base aplica la misma regla).
export function esMovimientoManualRevertible(m) {
  if (!m || ['venta', 'devolucion'].includes(m.motivo_tipo)) return false
  if (!m.origen_tipo) return false
  if (ORIGENES_SISTEMA_NO_REVERTIBLES.has(m.origen_tipo)) return false
  return ORIGENES_MANUALES_REVERTIBLES.has(m.origen_tipo)
}
