// src/services/pdf/comisionesGeneradasPDF.js
// PDFs de comisiones generadas. No registra ni representa pagos internos.
import { jsPDF } from 'jspdf'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_H,
  MARGIN,
  CONTENT_W,
  C_PRIMARY,
  C_DARK,
  C_EMERALD,
  C_RED,
  fmtUsd,
  fmtBs,
  fmtFecha,
  fmtFechaCorta,
  hexToRgb,
  drawWatermark,
  drawPremiumHeader,
  drawPremiumFooter,
} from './pdfShared'
import {
  adjustLegacyCommissionForExcludedProducts,
  getComisionPctForItem,
  getNonCxcFraction,
  isDonationPayment,
  isLoanPayment,
  countUniqueDispatches,
  getCommissionDispatchKey,
} from '../../utils/comisionUtils'

const round2 = value => Math.round((Number(value) || 0) * 100) / 100

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function sellerFromRow(row, fallback = null) {
  const seller = row?.vendedor || row?.comisiones?.vendedor || fallback || {}
  return {
    id: seller.id || fallback?.id || 'sin_asesor',
    nombre: seller.nombre || fallback?.nombre || 'Sin asesor',
    color: seller.color || fallback?.color || '#1B365D',
    codigo: seller.codigo || fallback?.codigo || null,
    markup_pct: seller.markup_pct ?? fallback?.markup_pct ?? null,
    es_externo: !!(seller.es_externo ?? fallback?.es_externo),
  }
}

function despachoFromRow(row) {
  return row?.despacho || row?.comisiones?.despacho || {}
}

function clientNameFromRow(row, despacho) {
  const cotizacion = row?.cotizacion || row?.comisiones?.cotizacion || {}
  const candidates = [
    despacho?.cliente_nombre,
    despacho?.clienteNombre,
    typeof despacho?.cliente === 'string' ? despacho.cliente : null,
    despacho?.cliente?.nombre,
    despacho?.cliente?.razon_social,
    despacho?.cliente_factura?.nombre,
    row?.cliente_nombre,
    row?.clienteNombre,
    typeof row?.cliente === 'string' ? row.cliente : null,
    row?.cliente?.nombre,
    row?.comisiones?.cliente_nombre,
    cotizacion?.cliente_nombre,
    typeof cotizacion?.cliente === 'string' ? cotizacion.cliente : null,
    cotizacion?.cliente?.nombre,
  ]
  const value = candidates.find(candidate => {
    const text = String(candidate ?? '').trim()
    return text && text !== '---' && text !== '—'
  })
  return String(value || '---').trim()
}

export function formatCommissionPeriod(range = {}, dispatchCount = null) {
  const from = range?.from ? fmtFecha(range.from) : 'Inicio'
  const to = range?.to ? fmtFecha(range.to) : 'Fin'
  const hasDispatchCount = dispatchCount !== null
    && dispatchCount !== undefined
    && Number.isFinite(Number(dispatchCount))
  const countLabel = hasDispatchCount
    ? ` · Despachos únicos: ${Number(dispatchCount)}`
    : ''
  return `Período: ${from} al ${to} · Base: fecha del despacho${countLabel}`
}

function productsFromDispatch(despacho) {
  return Array.isArray(despacho?.productos)
    ? despacho.productos.filter(Boolean)
    : []
}

function isGeneratedRow(row) {
  const eventType = String(row?.tipo || '').toLowerCase()
  const commissionState = String(row?.estado || row?.estado_comision || row?.comisiones?.estado || '').toLowerCase()
  return eventType === 'generada' || commissionState === 'generada'
}

function rawCommissionTotal(row) {
  const eventTotal = row?.monto
  const nestedTotal = row?.comisiones?.totalcomision
  return asNumber(
    eventTotal !== undefined && eventTotal !== null
      ? eventTotal
      : nestedTotal !== undefined && nestedTotal !== null
        ? nestedTotal
        : row?.totalcomision ?? row?.total_com ?? row?.despacho_comision_total,
  )
}

function rawCommissionParts(row, total) {
  const nested = row?.comisiones || row
  let cabilla = asNumber(nested?.comisioncabilla)
  let otros = asNumber(nested?.comisionotros)
  const partsTotal = cabilla + otros

  if (partsTotal <= 0 && total > 0) {
    cabilla = asNumber(nested?.pctcabilla) > 0 ? total : 0
    otros = total - cabilla
  } else if (partsTotal > 0 && Math.abs(partsTotal - total) > 0.01 && total > 0) {
    const factor = total / partsTotal
    cabilla = round2(cabilla * factor)
    otros = round2(total - cabilla)
  }

  return { cabilla, otros }
}

function productLabel(product) {
  const name = product?.nombre_snap || product?.nombre || 'Comisión generada'
  const code = product?.codigo_snap || product?.codigo
  return code ? `[${code}] ${name}` : name
}

function productIsExcluded(product) {
  if (product?.es_prestamo || product?.esPrestamo) return true
  const name = String(product?.nombre_snap || product?.nombre || '').trim().toLowerCase()
  return name.startsWith('corte')
}

function isCabillaProduct(product, seller, config) {
  const configuredCategory = String(config?.comision_categoria_cabilla || 'cabilla').trim().toLowerCase()
  const category = String(product?.producto?.categoria || product?.categoria || '').trim().toLowerCase()
  const name = String(product?.nombre_snap || product?.nombre || '').trim().toLowerCase()
  const matchesCategory = category.length > 0 && (
    category === configuredCategory
    || category.includes(configuredCategory)
    || configuredCategory.includes(category)
  )
  const matchesName = name.includes(configuredCategory)
  const externalCement = !!seller?.es_externo && (category === 'cemento' || name.includes('cemento'))
  return matchesCategory || matchesName || externalCement
}

/**
 * Normaliza una fila directa de comisiones o un evento antiguo/nuevo del Worker.
 * La API ya entrega filas generadas prorrateadas; solo las filas legacy reciben
 * el factor no-CxC en esta capa defensiva.
 */
export function normalizarComisionGenerada(row, options = {}) {
  const fallbackSeller = options.vendedor || null
  const seller = sellerFromRow(row, fallbackSeller)
  const despacho = despachoFromRow(row)
  const products = productsFromDispatch(despacho)
  const totalRaw = rawCommissionTotal(row)

  const paymentSource = despacho?.forma_pago_cliente != null && despacho.forma_pago_cliente !== ''
    ? despacho.forma_pago_cliente
    : despacho?.forma_pago
  const excludedByPayment = isDonationPayment(paymentSource) || isLoanPayment(paymentSource)
  const generated = isGeneratedRow(row)
  const paymentFraction = asNumber(row?.fraccion_no_cxc ?? row?.comisiones?.fraccion_no_cxc ?? getNonCxcFraction(despacho).fraction)
  const apiAlreadyApplied = row?.comision_no_cxc_aplicada === true || row?.comisiones?.comision_no_cxc_aplicada === true
  const sourceLegacy = row?.sourceLegacy === true || (!apiAlreadyApplied && !generated)

  // Para filas generadas por el Worker, totalcomision ya es la comisión efectiva.
  // Solo las filas legacy reciben el factor no-CxC en esta capa defensiva.
  const allProductsExcluded = products.length > 0 && products.every(productIsExcluded)
  const excludedRow = excludedByPayment || allProductsExcluded
  const paymentAdjustedTotal = excludedRow
    ? 0
    : round2(apiAlreadyApplied || generated ? totalRaw : totalRaw * paymentFraction)
  const rawParts = rawCommissionParts(row, totalRaw)
  const partFactor = totalRaw > 0 ? paymentAdjustedTotal / totalRaw : 1
  const baseCabilla = excludedRow ? 0 : round2(rawParts.cabilla * partFactor)
  const baseOtros = excludedRow ? 0 : round2(paymentAdjustedTotal - baseCabilla)
  const workerProductAdjustmentApplied = row?.productos_exclusion_aplicada === true
    || row?.comisiones?.productos_exclusion_aplicada === true
  const productAdjustment = sourceLegacy && !excludedRow && !workerProductAdjustmentApplied
    ? adjustLegacyCommissionForExcludedProducts({
      products,
      comisioncabilla: baseCabilla,
      comisionotros: baseOtros,
      perfil: seller,
      config: options.config || {},
    })
    : {
      cabilla: baseCabilla,
      otros: baseOtros,
      total: round2(baseCabilla + baseOtros),
      applied: workerProductAdjustmentApplied,
    }
  const total = excludedRow ? 0 : round2(productAdjustment.total)
  const comisioncabilla = excludedRow ? 0 : round2(productAdjustment.cabilla)
  const comisionotros = excludedRow ? 0 : round2(productAdjustment.otros)
  const productosExclusionAplicada = workerProductAdjustmentApplied || productAdjustment.applied
  const otrasExclusionesCalculadas = sourceLegacy && !workerProductAdjustmentApplied
    ? round2(paymentAdjustedTotal - total)
    : asNumber(row?.comision_otras_exclusiones ?? row?.comisiones?.comision_otras_exclusiones)
  const tasa = asNumber(options.rate)
  const numero = despacho?.numero || row?.despachonumero || row?.despacho_numero || '---'
  const cliente = clientNameFromRow(row, despacho)
  const fecha = row?.creado_en || row?.creadoen || row?.fecha || despacho?.creado_en || new Date().toISOString()
  const fechaDespacho = despacho?.creado_en || despacho?.creadoEn || row?.despacho_creado_en || null
  const grossCommissionValue = row?.totalcomision_bruta ?? row?.comisiones?.totalcomision_bruta
  const policySource = row?.fuente_calculo || row?.comisiones?.fuente_calculo || null

  return {
    id: row?.id || row?.comisiones?.id || `${seller.id}-${numero}-${fecha}`,
    despachoid: row?.despachoid || row?.comisiones?.despachoid || despacho?.id || null,
    vendedor: seller,
    despacho,
    products,
    totalcomision: total,
    comisioncabilla,
    comisionotros,
    pctcabilla: asNumber(row?.pctcabilla ?? row?.comisiones?.pctcabilla),
    pctotros: asNumber(row?.pctotros ?? row?.comisiones?.pctotros),
    valor: asNumber(despacho?.total_usd ?? despacho?.totalusd ?? row?.valor),
    despachonumero: numero,
    clienteNombre: String(cliente).toUpperCase(),
    creadoen: fecha,
    fechaDespacho,
    tasa_snapshot: tasa,
    estado: 'generada',
    excludedByPayment: excludedRow,
    excludedByProducts: allProductsExcluded,
    legacyScaledBy: sourceLegacy ? paymentFraction : 1,
    sourceLegacy,
    totalcomision_bruta: grossCommissionValue == null ? null : asNumber(grossCommissionValue),
    comision_cxc_excluida: asNumber(row?.comision_cxc_excluida ?? row?.comisiones?.comision_cxc_excluida),
    comision_otras_exclusiones: otrasExclusionesCalculadas,
    productos_exclusion_aplicada: productosExclusionAplicada,
    fraccion_no_cxc: paymentFraction,
    fraccion_comision_aplicada: asNumber(row?.fraccion_comision_aplicada ?? row?.comisiones?.fraccion_comision_aplicada ?? (sourceLegacy ? paymentFraction : 1)),
    comision_no_cxc_aplicada: apiAlreadyApplied || generated,
    fuente_calculo: policySource || (productosExclusionAplicada ? 'legacy_read_prorated_products' : null),
    politica_comision: row?.politica_comision || row?.comisiones?.politica_comision || 'fecha_despacho_no_cxc',
  }
}

export function expandCommissionRows(rows, options = {}) {
  const expanded = []

  rows.forEach(row => {
    const normalized = normalizarComisionGenerada(row, options)
    if (normalized.totalcomision <= 0) return

    const products = normalized.products.filter(product => !productIsExcluded(product))
    if (products.length === 0) {
      // Si la fila tenía productos pero todos eran préstamos/cortes, no debe
      // reaparecer en el PDF como una comisión genérica.
      if (normalized.products.length > 0) return
      expanded.push({
        ...normalized,
        descripcion: 'COMISIÓN GENERADA',
        codigo: '',
        pct: normalized.pctotros || normalized.pctcabilla || 0,
      })
      return
    }

    const allProducts = normalized.products
    const hasExcludedProducts = allProducts.some(productIsExcluded)
    const bucketDefinitions = [
      {
        key: 'cabilla',
        items: products.filter(product => isCabillaProduct(product, normalized.vendedor, options.config)),
        storedTotal: round2(normalized.comisioncabilla),
      },
      {
        key: 'otros',
        items: products.filter(product => !isCabillaProduct(product, normalized.vendedor, options.config)),
        storedTotal: round2(normalized.comisionotros),
      },
    ]

    // Legacy rows may have been calculated before product-level exclusions were
    // enforced. Remove the excluded product share instead of reallocating it
    // to valid products. Rows from 238 already carry the net stored amount.
    const bucketExpected = new Map()
    if (normalized.sourceLegacy && hasExcludedProducts && !normalized.productos_exclusion_aplicada) {
      allProducts.forEach(product => {
        const value = Math.max(0, asNumber(product.total_linea_usd ?? product.total_linea_neto ?? product.total))
        if (value <= 0 || productIsExcluded(product)) return
        const pct = getComisionPctForItem(product, options.config || {}, normalized.vendedor)
        const key = isCabillaProduct(product, normalized.vendedor, options.config) ? 'cabilla' : 'otros'
        bucketExpected.set(key, (bucketExpected.get(key) || 0) + value * pct / 100)
      })
      const allExpected = new Map()
      allProducts.forEach(product => {
        const value = Math.max(0, asNumber(product.total_linea_usd ?? product.total_linea_neto ?? product.total))
        if (value <= 0) return
        const pct = getComisionPctForItem(product, options.config || {}, normalized.vendedor)
        const key = isCabillaProduct(product, normalized.vendedor, options.config) ? 'cabilla' : 'otros'
        allExpected.set(key, (allExpected.get(key) || 0) + value * pct / 100)
      })
      bucketExpected.forEach((eligibleExpected, key) => {
        const allValue = allExpected.get(key) || 0
        const storedTotal = bucketDefinitions.find(bucket => bucket.key === key)?.storedTotal || 0
        bucketExpected.set(key, allValue > 0 ? round2(storedTotal * eligibleExpected / allValue) : 0)
      })
    }

    const buckets = bucketDefinitions.map(bucket => ({
      key: bucket.key,
      items: bucket.items,
      total: normalized.sourceLegacy && hasExcludedProducts && !normalized.productos_exclusion_aplicada
        ? (bucketExpected.get(bucket.key) || 0)
        : bucket.storedTotal,
    }))
    const allocations = new Map()

    buckets.forEach(bucket => {
      if (bucket.items.length === 0) return
      const bucketValue = bucket.items.reduce((sum, product) => sum + Math.max(0, asNumber(product.total_linea_usd ?? product.total_linea_neto ?? product.total)), 0)
      let allocated = 0
      bucket.items.forEach((product, index) => {
        const value = Math.max(0, asNumber(product.total_linea_usd ?? product.total_linea_neto ?? product.total))
        const weight = bucketValue > 0 ? value / bucketValue : 1 / bucket.items.length
        const itemCommission = index === bucket.items.length - 1
          ? round2(bucket.total - allocated)
          : round2(bucket.total * weight)
        allocated = round2(allocated + itemCommission)
        allocations.set(product, {
          itemCommission,
          itemCabilla: bucket.key === 'cabilla' ? itemCommission : 0,
        })
      })
    })

    products.forEach(product => {
      const value = round2(Math.max(0, asNumber(product.total_linea_usd ?? product.total_linea_neto ?? product.total)))
      const allocation = allocations.get(product) || { itemCommission: 0, itemCabilla: 0 }
      const itemCommission = round2(allocation.itemCommission)
      const itemCabilla = round2(allocation.itemCabilla)
      // % nominal almacenado en la fila (autoritativo: es el que aplicó la
      // función de BD, incluido split 1.5%/0.5%), elegido por bucket del
      // producto. Nunca el % derivado del prorrateo de centavos (0.48% etc.).
      const esCabillaItem = isCabillaProduct(product, normalized.vendedor, options.config)
      const pctNominal = (esCabillaItem ? normalized.pctcabilla : normalized.pctotros)
        || (esCabillaItem ? normalized.pctotros : normalized.pctcabilla)
        || getComisionPctForItem(product, options.config || {}, normalized.vendedor)
        || 0
      expanded.push({
        ...normalized,
        codigo: product.codigo_snap || product.codigo || '',
        descripcion: productLabel(product).toUpperCase(),
        valor: value,
        pct: pctNominal,
        totalcomision: itemCommission,
        comisioncabilla: itemCabilla,
        comisionotros: round2(itemCommission - itemCabilla),
      })
    })
  })

  return expanded
}

function sellerSummary(rows) {
  const map = new Map()
  rows.forEach(row => {
    const seller = row.vendedor
    if (!map.has(seller.id)) {
      map.set(seller.id, {
        id: seller.id,
        nombre: seller.nombre,
        color: seller.color,
        esExterno: seller.es_externo,
        generadoUsd: 0,
        count: 0,
        dispatchKeys: new Set(),
      })
    }
    const summary = map.get(seller.id)
    summary.generadoUsd = round2(summary.generadoUsd + row.totalcomision)
    const dispatchKey = getCommissionDispatchKey(row)
    if (dispatchKey !== null && dispatchKey !== undefined && dispatchKey !== '') {
      summary.dispatchKeys.add(String(dispatchKey))
    }
  })
  return [...map.values()]
    .map(summary => ({ ...summary, count: summary.dispatchKeys.size, dispatchKeys: undefined }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export function calcularResumenComisionesGeneradas(rows, ajustesManuales = {}, rate = 0) {
  const sellers = sellerSummary(rows).map(seller => {
    const adjustment = ajustesManuales[seller.id] || {}
    const cxc = Math.max(0, asNumber(adjustment.cxc))
    const descuentoCarro = Math.max(0, asNumber(adjustment.descuentoCarro))
    const totalPagarUsd = round2(seller.generadoUsd + cxc - descuentoCarro)
    return {
      ...seller,
      cxcManualUsd: cxc,
      descuentoCarroUsd: descuentoCarro,
      totalPagarUsd,
      totalPagarBs: rate > 0 ? round2(totalPagarUsd * rate) : 0,
    }
  })

  return {
    sellers,
    totalGeneradoUsd: round2(sellers.reduce((sum, seller) => sum + seller.generadoUsd, 0)),
    totalCxcManualUsd: round2(sellers.reduce((sum, seller) => sum + seller.cxcManualUsd, 0)),
    totalDescuentoCarroUsd: round2(sellers.reduce((sum, seller) => sum + seller.descuentoCarroUsd, 0)),
    totalPagarUsd: round2(sellers.reduce((sum, seller) => sum + seller.totalPagarUsd, 0)),
    totalPagarBs: rate > 0
      ? round2((sellers.reduce((sum, seller) => sum + seller.totalPagarUsd, 0)) * rate)
      : 0,
  }
}

function drawHeader(doc, config, title, subtitle) {
  const y = drawPremiumHeader({
    doc,
    logoData: LOGO_LISTA_PRECIOS,
    config,
    title,
    subtitle,
    customBgColor: [255, 255, 255],
    customAccentColor: [0, 0, 0],
    customTextColor: [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor: [0, 0, 0],
    centerBusinessName: true,
  })
  drawWatermark(doc)
  return finiteY(y)
}

function finiteY(value, fallback = MARGIN + 10) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function ensureCommissionPage(doc, y, needed, config, title) {
  const currentY = finiteY(y)
  const required = Number.isFinite(Number(needed)) ? Math.max(0, Number(needed)) : 0
  if (currentY + required > PAGE_H - 35) {
    doc.addPage()
    return finiteY(drawHeader(doc, config, title, 'Continuación'))
  }
  return currentY
}

function drawTableHeader(doc, columns, y) {
  y = finiteY(y)
  const headerFontSize = 6.6
  const lineHeight = 2.8
  const topPadding = 3.2
  const bottomPadding = 2.2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(headerFontSize)
  const preparedColumns = columns.map(column => ({
    ...column,
    lines: doc.splitTextToSize(column.label, Math.max(8, column.w - 2)),
  }))
  const maxLines = preparedColumns.reduce((max, column) => Math.max(max, column.lines.length), 1)
  const headerHeight = Math.max(8, topPadding + maxLines * lineHeight + bottomPadding)

  doc.setDrawColor(210, 215, 225)
  doc.setLineWidth(0.3)
  const lineY = finiteY(y)
  const bottomLineY = finiteY(y + headerHeight, lineY + 8)
  doc.line(MARGIN, lineY, MARGIN + CONTENT_W, lineY)
  doc.line(MARGIN, bottomLineY, MARGIN + CONTENT_W, bottomLineY)
  doc.setTextColor(80, 90, 110)
  preparedColumns.forEach(column => {
    const align = column.align || 'left'
    const x = align === 'right'
      ? column.x + column.w - 2
      : align === 'center'
        ? column.x + column.w / 2
        : column.x + 1
    column.lines.forEach((line, index) => doc.text(line, x, y + topPadding + index * lineHeight, { align }))
  })
  return y + headerHeight + 1.5
}

function drawDetailedTables(doc, rows, rate, title, config, range, dispatchCount = null) {
  let y = drawHeader(doc, config, title, formatCommissionPeriod(range, dispatchCount))
  const columns = [
    { label: 'Fecha despacho', x: MARGIN, w: 20 },
    { label: 'Cliente', x: MARGIN + 20, w: 32 },
    { label: 'Despacho', x: MARGIN + 52, w: 15 },
    { label: 'Producto / Descripción', x: MARGIN + 67, w: 45 },
    { label: 'Valor ($)', x: MARGIN + 112, w: 18, align: 'right' },
    { label: '%', x: MARGIN + 130, w: 8, align: 'right' },
    { label: 'Comisión ($)', x: MARGIN + 138, w: 24, align: 'right' },
    { label: 'Comisión (Bs)', x: MARGIN + 162, w: 26, align: 'right' },
  ]

  const groups = new Map()
  rows.forEach(row => {
    const key = row.vendedor.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })

  const groupEntries = [...groups.entries()]
  groupEntries.forEach(([_sellerId, sellerRows], groupIndex) => {
    y = ensureCommissionPage(doc, y, 22, config, title)
    const seller = sellerRows[0].vendedor
    const color = hexToRgb(seller.color || '#1B365D')
    doc.setFillColor(...color)
    doc.circle(MARGIN + 3, y + 3, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_DARK)
    const sellerName = seller.nombre.toUpperCase()
    doc.text(sellerName, MARGIN + 7, y + 4)
    if (seller.codigo) {
      const curX = MARGIN + 7 + doc.getTextWidth(sellerName)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(110, 120, 135)
      doc.text(` [${seller.codigo.toUpperCase()}]`, curX, y + 4)
    }
    y += 8
    y = drawTableHeader(doc, columns, y)

    sellerRows.forEach((row, index) => {
      const descriptionLines = doc.splitTextToSize(row.descripcion || 'COMISIÓN GENERADA', columns[3].w - 2)
      const clientLines = doc.splitTextToSize(row.clienteNombre || '---', columns[1].w - 2)
      const lineCount = Math.max(descriptionLines.length, clientLines.length, 1)
      const rowHeight = Math.max(8, 3.2 + lineCount * 3.2)
      const nextPageY = ensureCommissionPage(doc, y, rowHeight + 2, config, title)
      if (nextPageY !== y) y = drawTableHeader(doc, columns, nextPageY)

      if (index % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, rowHeight, 'F')
      }

      const middleY = y + rowHeight / 2 + 1
      const commissionBs = rate > 0 ? row.totalcomision * rate : 0
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.2)
      doc.setTextColor(...C_DARK)
      doc.text(fmtFechaCorta(row.fechaDespacho || row.creadoen), columns[0].x + 1, middleY)
      doc.text(clientLines, columns[1].x + 1, y + 3.5)
      doc.text(`#${row.despachonumero}`, columns[2].x + 1, middleY)
      doc.text(descriptionLines, columns[3].x + 1, y + 3.5)
      doc.text(fmtUsd(row.valor), columns[4].x + columns[4].w - 2, middleY, { align: 'right' })
      doc.text(`${row.pct || 0}%`, columns[5].x + columns[5].w - 2, middleY, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(row.totalcomision), columns[6].x + columns[6].w - 2, middleY, { align: 'right' })
      doc.setTextColor(...C_EMERALD)
      doc.text(rate > 0 ? fmtBs(commissionBs) : 'N/D', columns[7].x + columns[7].w - 2, middleY, { align: 'right' })
      y += rowHeight
    })

    y = ensureCommissionPage(doc, y, 10, config, title)
    doc.setDrawColor(210, 215, 225)
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_PRIMARY)
    const subtotal = sellerRows.reduce((sum, row) => sum + row.totalcomision, 0)
    const subtotalBs = rate > 0 ? subtotal * rate : 0
    const subtotalLabel = seller.codigo ? `Subtotal ${seller.nombre} [${seller.codigo.toUpperCase()}]:` : `Subtotal ${seller.nombre}:`
    doc.text(subtotalLabel, MARGIN + 2, y + 5)
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(subtotal), columns[6].x + columns[6].w - 2, y + 5, { align: 'right' })
    doc.setTextColor(...C_EMERALD)
    doc.text(rate > 0 ? fmtBs(subtotalBs) : 'N/D', columns[7].x + columns[7].w - 2, y + 5, { align: 'right' })
    y += 10

    if (groupIndex < groupEntries.length - 1) y += 3
  })

  y = ensureCommissionPage(doc, y, 12, config, title)
  const total = rows.reduce((sum, row) => sum + row.totalcomision, 0)
  const totalBs = rate > 0 ? total * rate : 0
  doc.setDrawColor(...C_PRIMARY)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C_PRIMARY)
  doc.text('TOTAL COMISIÓN GENERADA:', MARGIN + 2, y + 6)
  doc.setTextColor(...C_DARK)
  doc.text(fmtUsd(total), columns[6].x + columns[6].w - 2, y + 6, { align: 'right' })
  doc.setTextColor(...C_EMERALD)
  doc.text(rate > 0 ? fmtBs(totalBs) : 'N/D', columns[7].x + columns[7].w - 2, y + 6, { align: 'right' })
  return y + 12
}

function drawSummaryTable(doc, summary, rate, range, config, title, dispatchCount = null) {
  let y = drawHeader(doc, config, title, formatCommissionPeriod(range, dispatchCount))
  const columns = [
    { label: 'VENDEDOR', x: MARGIN, w: 32 },
    { label: 'COMISIÓN PERÍODO ($)', x: MARGIN + 32, w: 31, align: 'right' },
    { label: 'CxC MANUAL ($)', x: MARGIN + 63, w: 32, align: 'right' },
    { label: 'DESCUENTO CARRO ($)', x: MARGIN + 95, w: 29, align: 'right' },
    { label: 'TOTAL A PAGAR ($)', x: MARGIN + 124, w: 31, align: 'right' },
    { label: 'TOTAL Bs', x: MARGIN + 155, w: 33, align: 'right' },
  ]
  y = drawTableHeader(doc, columns, y)

  summary.sellers.forEach((seller, index) => {
    y = ensureCommissionPage(doc, y, 10, config, title)
    if (index % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 8.5, 'F')
    }
    const color = hexToRgb(seller.color || '#1B365D')
    doc.setFillColor(...color)
    doc.circle(MARGIN + 3, y + 3, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_DARK)
    const summarySellerLabel = seller.codigo ? `${seller.nombre} [${seller.codigo.toUpperCase()}]` : seller.nombre
    doc.text(summarySellerLabel, MARGIN + 7, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(seller.generadoUsd), columns[1].x + columns[1].w - 2, y + 4, { align: 'right' })
    doc.setTextColor(180, 83, 9)
    doc.text(seller.cxcManualUsd > 0 ? fmtUsd(seller.cxcManualUsd) : '—', columns[2].x + columns[2].w - 2, y + 4, { align: 'right' })
    doc.setTextColor(...C_RED)
    doc.text(seller.descuentoCarroUsd > 0 ? fmtUsd(seller.descuentoCarroUsd) : '—', columns[3].x + columns[3].w - 2, y + 4, { align: 'right' })
    doc.setTextColor(...C_DARK)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(seller.totalPagarUsd), columns[4].x + columns[4].w - 2, y + 4, { align: 'right' })
    doc.setTextColor(...C_EMERALD)
    doc.text(rate > 0 ? fmtBs(seller.totalPagarBs) : 'N/D', columns[5].x + columns[5].w - 2, y + 4, { align: 'right' })
    y += 8.5
  })

  y = ensureCommissionPage(doc, y, 12, config, title)
  doc.setDrawColor(210, 215, 225)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_PRIMARY)
  doc.text('TOTAL GENERAL:', MARGIN + 2, y + 5)
  doc.setTextColor(...C_DARK)
  doc.text(fmtUsd(summary.totalGeneradoUsd), columns[1].x + columns[1].w - 2, y + 5, { align: 'right' })
  doc.setTextColor(180, 83, 9)
  doc.text(fmtUsd(summary.totalCxcManualUsd), columns[2].x + columns[2].w - 2, y + 5, { align: 'right' })
  doc.setTextColor(...C_RED)
  doc.text(fmtUsd(summary.totalDescuentoCarroUsd), columns[3].x + columns[3].w - 2, y + 5, { align: 'right' })
  doc.setTextColor(...C_DARK)
  doc.text(fmtUsd(summary.totalPagarUsd), columns[4].x + columns[4].w - 2, y + 5, { align: 'right' })
  doc.setTextColor(...C_EMERALD)
  doc.text(rate > 0 ? fmtBs(summary.totalPagarBs) : 'N/D', columns[5].x + columns[5].w - 2, y + 5, { align: 'right' })
  return y + 12
}

function finishPdf(doc, config, action, filename) {
  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0], 'Comisiones generadas · liquidación externa')
  if (action === 'return') {
    return doc
  }
  if (action === 'print') {
    doc.autoPrint()
    const url = doc.output('bloburl')
    if (typeof document !== 'undefined' && url) {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.src = url
      document.body.appendChild(iframe)
      iframe.onload = () => {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
        setTimeout(() => {
          document.body.removeChild(iframe)
          URL.revokeObjectURL(url)
        }, 10000)
      }
    }
  } else {
    doc.save(filename)
  }
  return doc
}

export async function generarComisionesPDF({
  comisiones = [],
  vendedor = null,
  _tipoVendedor = null,
  rango = null,
  config = {},
  action = 'download',
  formato = 'detallado',
  tasaEuro = null,
  tasaAplicada = null,
  tipoTasa = 'Euro BCV',
  ajustesManuales = {},
  modoCorteSemanal = false,
}) {
  const rate = asNumber(tasaAplicada ?? tasaEuro)
  if (rate <= 0) throw new Error('No hay una tasa de liquidación válida disponible para generar el PDF')

  const normalized = (comisiones || [])
    .map(row => normalizarComisionGenerada(row, { vendedor, rate, config }))
    .filter(row => row.totalcomision > 0)
  const rows = expandCommissionRows(normalized, { vendedor, rate, config })
  const uniqueDispatchCount = countUniqueDispatches(normalized)
  const title = modoCorteSemanal ? 'Corte semanal de comisiones' : vendedor ? `Comisiones - ${vendedor.nombre}` : 'Reporte de Comisiones'
  const titleWithRate = `${title} · ${String(tipoTasa || 'Euro BCV')}`
  const filenameBase = vendedor ? vendedor.nombre.replace(/\s+/g, '_') : 'General'
  const suffix = formato === 'resumido' ? 'Resumido' : modoCorteSemanal ? 'Detallado' : 'General'
  const filename = `Comisiones_${suffix}_${filenameBase}_${new Date().toISOString().slice(0, 10)}.pdf`
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  if (formato === 'resumido') {
    const summary = calcularResumenComisionesGeneradas(normalized, ajustesManuales, rate)
    drawSummaryTable(doc, summary, rate, rango, config, titleWithRate, uniqueDispatchCount)
  } else {
    drawDetailedTables(doc, rows, rate, titleWithRate, config, rango, uniqueDispatchCount)
  }

  return finishPdf(doc, config, action, filename)
}
