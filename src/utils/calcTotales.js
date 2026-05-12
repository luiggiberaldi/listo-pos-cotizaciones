// src/utils/calcTotales.js
// Single source of truth for cotización totals calculation
import { round2 } from './dinero'

/**
 * Calculate cotización totals from items and parameters.
 * @param {Array} items - Items with { cantidad, precioUnitUsd }
 * @param {number} descGlobalPct - DEPRECATED, always treated as 0
 * @param {number} costoEnvio - Shipping cost in USD
 * @param {number} costoCorte - Cutting cost in USD
 * @returns {{ subtotal: number, descuentoUsd: number, totalUsd: number }}
 */
export function calcTotales(items, descGlobalPct, costoEnvio, costoCorte = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    return { subtotal: 0, descuentoUsd: 0, totalUsd: round2((Number(costoEnvio) || 0) + (Number(costoCorte) || 0)) }
  }
  const subtotal     = round2(items.reduce((s, it) => {
    const qty = Number(it.cantidad) || 0
    const price = Number(it.precioUnitUsd) || 0
    return round2(s + round2(qty * price))
  }, 0))
  const descuentoUsd = 0
  const totalUsd     = round2(subtotal + round2(Number(costoEnvio) || 0) + round2(Number(costoCorte) || 0))
  return { subtotal, descuentoUsd, totalUsd }
}
