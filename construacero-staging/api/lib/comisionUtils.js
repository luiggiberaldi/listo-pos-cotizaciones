function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function parseExtras(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rateForItem(item, product, config, vendedorExterno) {
  if (item?.origen === 'externo') {
    return { bucket: 'otros', rate: Number(config.comision_ext_pct_externos ?? config.comision_pct_externos ?? 0) }
  }

  const category = String(product?.categoria || '').trim().toLowerCase()
  const cabilla = String(config.comision_categoria_cabilla || 'Cabilla').trim().toLowerCase()
  if (vendedorExterno && (category === 'cemento' || String(item?.nombre_snap || '').trim().toLowerCase().includes('cemento'))) {
    return { bucket: 'cabilla', rate: Number(config.comision_ext_pct_cabilla ?? config.comision_pct_cabilla ?? 0) }
  }
  if (category === cabilla) {
    return { bucket: 'cabilla', rate: Number(vendedorExterno ? config.comision_ext_pct_cabilla : config.comision_pct_cabilla) || 0 }
  }

  const extra = parseExtras(vendedorExterno ? config._comision_ext_extras : config._comision_extras)
    .find(entry => String(entry?.cat || '').trim().toLowerCase() === category)
  if (extra) return { bucket: 'otros', rate: Number(extra.pct) || 0 }
  return { bucket: 'otros', rate: Number(vendedorExterno ? config.comision_ext_pct_otros : config.comision_pct_otros) || 0 }
}

function calculateTotals(items, productsById, discountsByItem, config, vendedorExterno) {
  let cabillaBase = 0
  let otrosCommission = 0

  for (const item of items) {
    const gross = Math.max(0, Number(item?.total_linea_usd) || 0)
    const discount = Math.max(0, Number(discountsByItem.get(item?.id) || 0))
    const net = Math.max(0, gross - discount)
    const { bucket, rate } = rateForItem(item, productsById.get(item?.producto_id), config, vendedorExterno)

    if (bucket === 'cabilla') {
      cabillaBase += net
    } else {
      otrosCommission += net * rate / 100
    }
  }

  const pctCabilla = Number(vendedorExterno ? config.comision_ext_pct_cabilla : config.comision_pct_cabilla) || 0
  const cabillaCommission = cabillaBase * pctCabilla / 100
  return {
    cabilla: round2(cabillaCommission),
    otros: round2(otrosCommission),
    total: round2(cabillaCommission + otrosCommission),
  }
}

/**
 * Compara la comisión que la RPC calculó sobre el bruto con la comisión neta
 * que corresponde después de aplicar despacho_descuentos.
 */
export function calcularComisionConDescuentos({ discounts = [], items = [], products = [], config = {}, vendedorExterno = false }) {
  const productsById = new Map(products.map(product => [product.id, product]))
  const discountsByItem = new Map(discounts.map(discount => [discount.cotizacion_item_id, discount.monto_usd]))
  const grossItems = items.map(item => ({ ...item, total_linea_usd: Number(item.total_linea_usd) || 0 }))
  const netItems = grossItems.map(item => ({ ...item, total_linea_usd: Math.max(0, item.total_linea_usd - Number(discountsByItem.get(item.id) || 0)) }))

  const gross = calculateTotals(grossItems, productsById, new Map(), config, vendedorExterno)
  const net = calculateTotals(netItems, productsById, new Map(), config, vendedorExterno)
  return {
    gross,
    net,
    adjustment: {
      cabilla: round2(gross.cabilla - net.cabilla),
      otros: round2(gross.otros - net.otros),
      total: round2(gross.total - net.total),
    },
  }
}

/**
 * Devuelve un PATCH solo si la comisión remota coincide con el cálculo bruto.
 * Si ya está corregida, devuelve null y evita descontarla dos veces.
 */
export function reconciliarComisionConDescuento(comision, calculation) {
  const grossTotal = Number(calculation?.gross?.total) || 0
  const net = calculation?.net
  const netTotal = Number(net?.total) || 0
  const currentTotal = Number(comision?.totalcomision) || 0

  if (Math.abs(currentTotal - netTotal) <= 0.01) return null
  if (Math.abs(currentTotal - grossTotal) > 0.01) return null

  const paid = Number(comision?.montopagado) || 0
  if (paid > netTotal + 0.01) {
    throw new Error('La comisión ya pagada supera el monto neto después del descuento; requiere conciliación manual.')
  }

  const released = Math.max(0, Number(comision?.comision_liberada) || 0)
  const releaseRatio = currentTotal > 0 ? Math.min(1, released / currentTotal) : 0
  const newReleased = round2(netTotal * releaseRatio)
  const newRetained = round2(netTotal - newReleased)

  return {
    comisioncabilla: net.cabilla,
    comisionotros: net.otros,
    totalcomision: netTotal,
    comision_liberada: newReleased,
    comision_retenida: newRetained,
    estado: newRetained > 0.01 ? 'cta_cobrar' : (comision.estado === 'pagada' ? 'pagada' : 'pendiente'),
  }
}
