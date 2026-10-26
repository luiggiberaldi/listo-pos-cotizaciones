// src/utils/precioVenta.js
// Regla de venta (2026-10-26): un producto sin precio mayor que 0 NO es
// vendible. El precio 0 sigue siendo un valor válido GUARDADO en inventario
// (contrato de precios 280: "precio 0 válido"); lo que se bloquea es meterlo
// a una venta o cotización. Los préstamos no venden (se marcan aparte) y por
// eso no pasan por esta regla.
import { precio2Visible, precio3Visible } from './preciosHabilitados'

// Precios visibles del producto en orden de venta: P1 (detal), P2 (mayor), P3 (especial).
export function preciosVentaVisibles(producto) {
  if (!producto) return []
  const p1 = Number(producto.precio_usd ?? producto.preciousd ?? 0)
  const precios = [p1]
  if (precio2Visible(producto)) precios.push(Number(producto.precio_2))
  if (precio3Visible(producto)) precios.push(Number(producto.precio_3))
  return precios.map(v => (Number.isFinite(v) ? v : 0))
}

// Primer precio mayor que 0 con el que se puede vender; null si no hay ninguno.
export function precioVentaBase(producto) {
  return preciosVentaVisibles(producto).find(v => v > 0) ?? null
}

// true si el producto no tiene NINGÚN precio de venta mayor que 0.
export function sinPrecioVenta(producto) {
  return precioVentaBase(producto) == null
}
