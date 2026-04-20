// src/utils/calcTotales.js
// Single source of truth for cotización totals calculation
import { round2 } from './dinero'

/**
 * Calculate cotización totals from items and parameters.
 * @param {Array} items - Items with { cantidad, precioUnitUsd, descuentoPct }
 * @param {number} descGlobalPct - Global discount percentage
 * @param {number} costoEnvio - Shipping cost in USD
 * @param {number} ivaPct - IVA percentage (default 0)
 * @returns {{ subtotal: number, descuentoUsd: number, ivaUsd: number, totalUsd: number }}
 */
export function calcTotales(items, descGlobalPct, costoEnvio, ivaPct = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    return { subtotal: 0, descuentoUsd: 0, ivaUsd: 0, totalUsd: round2(Number(costoEnvio) || 0) }
  }
  const subtotal     = round2(items.reduce((s, it) => {
    const qty = Number(it.cantidad) || 0
    const price = Number(it.precioUnitUsd) || 0
    const disc = Number(it.descuentoPct) || 0
    return round2(s + round2(qty * price * (1 - disc / 100)))
  }, 0))
  const descuentoUsd = round2(subtotal * (Number(descGlobalPct) || 0) / 100)
  const baseAnteIva  = round2(subtotal - descuentoUsd)
  const ivaUsd       = round2(baseAnteIva * (Number(ivaPct) || 0) / 100)
  const totalUsd     = round2(baseAnteIva + ivaUsd + round2(Number(costoEnvio) || 0))
  return { subtotal, descuentoUsd, ivaUsd, totalUsd }
}
