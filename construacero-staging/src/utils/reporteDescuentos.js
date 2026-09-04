// src/utils/reporteDescuentos.js
// Aplica los descuentos por ítem (despacho_descuentos) a una lista de ítems de
// un despacho, devolviendo líneas nuevas con total_linea_usd neto (nunca negativo).
//
// Empareja por despacho_item_id (índice moderno de notas_despacho_items) y, en su
// ausencia, por cotizacion_item_id (filas legacy creadas antes de que existiera la
// columna despacho_item_id). No muta los ítems de entrada.

export function aplicarDescuentosItems(items = [], descuentos = []) {
  const porDespachoItem = new Map()
  const porCotizacionItem = new Map()

  for (const dd of descuentos) {
    const monto = Number(dd.monto_usd || 0)
    if (!Number.isFinite(monto) || monto <= 0) continue
    if (dd.despacho_item_id) {
      porDespachoItem.set(dd.despacho_item_id, (porDespachoItem.get(dd.despacho_item_id) || 0) + monto)
    }
    if (dd.cotizacion_item_id) {
      porCotizacionItem.set(dd.cotizacion_item_id, (porCotizacionItem.get(dd.cotizacion_item_id) || 0) + monto)
    }
  }

  if (porDespachoItem.size === 0 && porCotizacionItem.size === 0) {
    return items.map(it => ({ ...it }))
  }

  return items.map(it => {
    let desc = 0
    if (it.id) desc += porDespachoItem.get(it.id) || 0
    if (it.cotizacion_item_id) desc += porCotizacionItem.get(it.cotizacion_item_id) || 0
    if (desc <= 0) return { ...it }
    return {
      ...it,
      total_linea_usd: Math.max(Number(it.total_linea_usd || 0) - desc, 0),
    }
  })
}