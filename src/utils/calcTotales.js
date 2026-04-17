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
  const subtotal     = round2(items.reduce((s, it) =>
    round2(s + round2(it.cantidad * it.precioUnitUsd * (1 - it.descuentoPct / 100))), 0))
  const descuentoUsd = round2(subtotal * (Number(descGlobalPct) || 0) / 100)
  const baseAnteIva  = round2(subtotal - descuentoUsd)
  const ivaUsd       = round2(baseAnteIva * (Number(ivaPct) || 0) / 100)
  const totalUsd     = round2(baseAnteIva + ivaUsd + (Number(costoEnvio) || 0))
  return { subtotal, descuentoUsd, ivaUsd, totalUsd }
}
