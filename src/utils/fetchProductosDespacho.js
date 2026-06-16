// src/utils/fetchProductosDespacho.js
// Devuelve un mapa { despachoId: [nombre_producto, ...] } para usarlo en los
// reportes de comisiones (que se arman desde eventos de liberación y no traen
// el detalle de productos). Prioriza notas_despacho_items y cae a
// cotizacion_items cuando un despacho no tiene ítems propios.
import supabase from '../services/supabase/client'

export async function fetchProductosDespacho(despachoIds = [], cotizacionPorDespacho = {}) {
  const map = {}
  const ids = [...new Set((despachoIds || []).filter(Boolean))]
  if (ids.length === 0) return map

  // 1) Ítems del despacho
  const { data: ndItems } = await supabase
    .from('notas_despacho_items')
    .select('despacho_id, nombre_snap')
    .in('despacho_id', ids)

  for (const it of ndItems || []) {
    if (!it?.nombre_snap) continue
    ;(map[it.despacho_id] ||= []).push(it.nombre_snap)
  }

  // 2) Fallback a ítems de la cotización para despachos sin ítems propios
  const faltantes = ids.filter(id => !map[id] && cotizacionPorDespacho[id])
  if (faltantes.length > 0) {
    const cotIds = [...new Set(faltantes.map(id => cotizacionPorDespacho[id]))]
    const { data: ciItems } = await supabase
      .from('cotizacion_items')
      .select('cotizacion_id, nombre_snap')
      .in('cotizacion_id', cotIds)

    const porCot = {}
    for (const it of ciItems || []) {
      if (!it?.nombre_snap) continue
      ;(porCot[it.cotizacion_id] ||= []).push(it.nombre_snap)
    }
    for (const id of faltantes) {
      map[id] = porCot[cotizacionPorDespacho[id]] || []
    }
  }

  return map
}
