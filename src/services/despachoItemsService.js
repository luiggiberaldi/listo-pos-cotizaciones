// src/services/despachoItemsService.js
// Servicio centralizado para obtener ítems consolidados de un despacho,
// integrando devoluciones parciales e intercambios de productos.
import supabase from './supabase/client'

/**
 * Retorna los ítems netos de un despacho, descontando devoluciones
 * y añadiendo productos de intercambio.
 *
 * Si el despacho NO tiene devoluciones, se comporta igual que el
 * fetchItemsDespacho original (sin overhead extra).
 *
 * @param {string} despachoId  UUID del despacho
 * @param {object} despacho    Objeto despacho (con tiene_devoluciones, etc.)
 * @returns {{ itemsConsolidados: Array, tieneDevoluciones: boolean }}
 */
export async function fetchDespachoConsolidado(despachoId, despacho) {
  // 1. Siempre traer los ítems originales
  const itemsRes = await supabase
    .from('notas_despacho_items')
    .select('id, producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden, es_prestamo, productos(categoria)')
    .eq('despacho_id', despachoId)
    .order('orden')

  if (itemsRes.error) throw new Error(itemsRes.error.message || 'Error al cargar ítems del despacho')

  const itemsOriginales = (itemsRes.data ?? []).map(item => ({
    ...item,
    categoria: item.productos?.categoria || ''
  }))

  // Si no tiene devoluciones, retornar tal cual (sin queries extra)
  if (!despacho?.tiene_devoluciones) {
    return { itemsConsolidados: itemsOriginales, tieneDevoluciones: false }
  }

  // 2. Consultar devoluciones e intercambios en paralelo
  const [devRes, intRes] = await Promise.all([
    supabase
      .from('despacho_devoluciones')
      .select('despacho_item_id, producto_id, cantidad_devuelta')
      .eq('despacho_id', despachoId),
    supabase
      .from('despacho_devolucion_intercambios')
      .select('id, producto_id, nombre_snap, codigo_snap, unidad_snap, cantidad, precio_unit_usd, total_usd')
      .eq('despacho_id', despachoId)
  ])

  // 3. Mapear cantidades devueltas separando ítems originales de intercambios
  const devData = devRes.data ?? []
  const returnedOrigMap = {}
  const returnedExchangeMap = {}
  devData.forEach(d => {
    if (d.despacho_item_id) {
      returnedOrigMap[d.despacho_item_id] = (returnedOrigMap[d.despacho_item_id] || 0) + Number(d.cantidad_devuelta)
    } else if (d.producto_id) {
      returnedExchangeMap[d.producto_id] = (returnedExchangeMap[d.producto_id] || 0) + Number(d.cantidad_devuelta)
    }
  })

  // 4. Ajustar ítems originales: restar cantidades devueltas
  const itemsAjustados = itemsOriginales
    .map(item => {
      const devuelto = returnedOrigMap[item.id] || 0
      if (devuelto <= 0) return item // Sin cambios

      const cantidadNeta = Number(item.cantidad) - devuelto
      if (cantidadNeta <= 0) return null // Totalmente devuelto → excluir

      const descPct = Number(item.descuento_pct || 0)
      const precioConDesc = Number(item.precio_unit_usd) * (1 - descPct / 100)
      const totalLineaNeto = Math.round(cantidadNeta * precioConDesc * 10000) / 10000

      return {
        ...item,
        cantidad: cantidadNeta,
        total_linea_usd: totalLineaNeto
      }
    })
    .filter(Boolean)

  // 5. Agrupar productos de intercambio y descontar sus devoluciones
  const intRaw = intRes.data ?? []
  const exchangeGroupMap = {}

  intRaw.forEach(it => {
    const prodId = it.producto_id
    if (!exchangeGroupMap[prodId]) {
      exchangeGroupMap[prodId] = {
        ...it,
        cantidadTotal: 0
      }
    }
    exchangeGroupMap[prodId].cantidadTotal += Number(it.cantidad)
  })

  const intercambios = Object.values(exchangeGroupMap).map((it, idx) => {
    const devuelto = returnedExchangeMap[it.producto_id] || 0
    const cantidadNeta = Number(it.cantidadTotal) - devuelto
    if (cantidadNeta <= 0) return null // Devuelto totalmente → excluir del PDF / vista

    const precio = Number(it.precio_unit_usd) || 0
    const totalLineaNeto = Math.round(cantidadNeta * precio * 10000) / 10000

    return {
      id: it.id,
      producto_id: it.producto_id,
      codigo_snap: it.codigo_snap,
      nombre_snap: it.nombre_snap,
      unidad_snap: it.unidad_snap,
      cantidad: cantidadNeta,
      precio_unit_usd: precio,
      total_linea_usd: totalLineaNeto,
      descuento_pct: 0,
      orden: 9000 + idx,
      es_prestamo: false,
      es_intercambio: true,
      categoria: ''
    }
  }).filter(Boolean)

  const itemsConsolidados = [...itemsAjustados, ...intercambios]

  return { itemsConsolidados, tieneDevoluciones: true }
}
