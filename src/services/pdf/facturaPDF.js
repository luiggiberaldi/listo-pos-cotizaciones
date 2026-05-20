// src/services/pdf/facturaPDF.js
// Genera PDF profesional de Factura — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtFecha, fmtTelefono,
  fmtBsShort, fmtBcvUsd, fmtUsd,
  drawWatermark, drawAnuladaWatermark,
} from './pdfShared'

// Formateadores locales de la Factura — sin prefijo "Bs" (solo cifras)
function fmtPrecioFac(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBsShort(Number(n || 0) * tasa)
  if ((moneda === 'bcv' || moneda === 'mixto_bcv') && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  return fmtUsd(n)
}

function fmtTotalFac(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBsShort(Number(n || 0) * tasa)
  if (moneda === 'bcv' && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(n)} / ${fmtBsShort(Number(n || 0) * tasa)}`
  if (moneda === 'mixto_bcv' && factorBcv > 0 && tasa > 0) return `${fmtBcvUsd(Number(n || 0) * factorBcv)} / ${fmtBsShort(Number(n || 0) * tasa)}`
  return fmtUsd(n)
}

export async function generarFacturaPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false, nroFactura = '', nroControl = '' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numFac = `FAC- ${String(nroFactura).padStart(5, '0')}`
  const displayControl = String(nroControl).toUpperCase()
  let pageNum = 1

  const esMembrete = config.nota_entrega_plantilla === 'membrete'

  const drawHeader = (doc, num) => {
    if (pageNum > 1) {
      const HDR_H = 15
      if (!esMembrete) {
        try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 4, 12, 12) } catch (_) {}
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(...C_DARK)
        doc.text('CONSTRUACERO CARABOBO, C.A.', MARGIN + 14, 10)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text(`FACTURA N° ${String(nroFactura).padStart(5, '0')}`, PAGE_W - MARGIN, 10, { align: 'right' })
        doc.setLineWidth(0.4)
        doc.setDrawColor(...C_DARK)
        doc.line(MARGIN, 14, PAGE_W - MARGIN, 14)
        return 19
      }
      return 19 + 20
    }

    if (!esMembrete) {
      return 15 // Empieza a 15mm de arriba
    }
    return 50 // Empieza a 50mm de arriba (5cm) si es membrete pre-impreso
  }

  y = drawHeader(doc, numFac)

  // ── Marca de agua central ──
  if (!esMembrete) {
    drawWatermark(doc)
  }
  if (despacho.estado === 'anulada') {
    drawAnuladaWatermark(doc)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula profesional
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente_factura || despacho.cliente || {}
  const vendedorResponsable = cliente.vendedor || despacho.vendedor
  const tlfVendedor = vendedorResponsable?.telefono || despacho.vendedor?.telefono
  const vendedorTlf = tlfVendedor ? ` — ${fmtTelefono(tlfVendedor)}` : ''

  // Helper para dibujar una celda con borde
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  // ── Fila 1-3: Header con título y datos de factura/fecha ──
  const gY = y - 4    // inicio de la cuadrícula
  const rowH = 5      // altura de cada fila pequeña
  const rightLblW = 22 // columna label derecha (CONTROL, FECHA)
  const rightValW = 38 // columna valor derecha
  const titleW = CONTENT_W - rightLblW - rightValW // columna de título fusionada (totalmente izquierda + centro)

  const col1W = 62
  const col2W = titleW - col1W // 130 - 62 = 68mm
  
  // Dividimos la dirección en líneas para ver cuántas son
  const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ').toUpperCase() || '—'
  const maxDirW = col2W - 6 // dejar 3mm de margen en cada lado
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  const dirLines = doc.splitTextToSize(dirStr, maxDirW)

  // Nombre del cliente
  const cNombre = (cliente.nombre || '').toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const cNameLines = doc.splitTextToSize(cNombre, col1W - 6) // dejar 3mm a cada lado

  // Ahora calculamos la altura requerida
  const col1Needed = 3.5 + cNameLines.length * 3.5 + 4.5 + 4.5 + 2 // CLIENTE label + líneas del nombre + RIF + TELÉFONO + padding
  const col2Needed = 4.5 + 4 + dirLines.length * 3.5 + 2 // VENDEDOR + DIRECCIÓN label + líneas dirección + padding

  // Altura final de la cabecera
  const headerTotalH = esMembrete ? Math.max(20, col1Needed, col2Needed) : 20
  const tripleH = headerTotalH

  // Celda de título fusionada (grande, a la izquierda y centro)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, titleW, headerTotalH, 'S')
  
  const clientInHeader = esMembrete

  if (!esMembrete) {
    // Dibujar logo y datos dentro de la celda de título
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN + 2.5, gY + (headerTotalH - 16) / 2, 16, 16) } catch (_) {}
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C_DARK)
    doc.text('CONSTRUACERO CARABOBO, C.A.', MARGIN + 21, gY + 6.5)
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`RIF: ${rif}`, MARGIN + 21, gY + 11.5)
    
    const tel = fmtTelefono(config.telefono_negocio) || ''
    if (tel) {
      doc.text(`TELÉFONO: ${tel}`, MARGIN + 21, gY + 16)
    }
  } else {
    // Colocamos los datos del cliente dentro de la celda para aprovechar el espacio en dos columnas
    const col1X = MARGIN + 3
    const col2X = MARGIN + col1W + 3

    // Línea separadora vertical entre columna 1 y columna 2
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(gridLW)
    doc.line(MARGIN + col1W, gY, MARGIN + col1W, gY + headerTotalH)
    
    // --- COLUMNA 1: CLIENTE & RIF & TELÉFONO ---
    // Label CLIENTE
    let curY = gY + 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text('CLIENTE:', col1X, curY)
    
    // Nombre del Cliente (puede ser en más de una línea)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    cNameLines.forEach((line) => {
      curY += 3.5
      doc.text(line, col1X, curY)
    })

    // RIF del Cliente (debajo del nombre)
    curY += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text('R.I.F. / C.I.:', col1X, curY)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    const rifText = (cliente.rif_cedula || cliente.rif || '—').toUpperCase()
    doc.text(rifText, col1X + 16, curY)

    // TELÉFONO del Cliente
    curY += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text('TELÉFONO:', col1X, curY)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    const tlfText = cliente.telefono ? fmtTelefono(cliente.telefono) : 'S/T'
    doc.text(tlfText, col1X + 16, curY)

    // --- COLUMNA 2: DIRECCIÓN & VENDEDOR ---
    // Dirección
    let curY2 = gY + 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text('DIRECCIÓN:', col2X, curY2)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    dirLines.forEach((line) => {
      curY2 += 3.5
      doc.text(line, col2X, curY2)
    })

    // Vendedor
    curY2 += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text('VENDEDOR:', col2X, curY2)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    const vNombre = (vendedorResponsable?.nombre || '').toUpperCase()
    const vStr = `${vNombre}${vendedorTlf}`
    // Cortar vendedor si excede el ancho de col2W
    const maxVendWidth = col2W - 18
    let vD = vStr
    if (doc.getTextWidth(vD) > maxVendWidth) {
      while (vD.length > 1 && doc.getTextWidth(vD + '…') > maxVendWidth) vD = vD.slice(0, -1)
      vD += '…'
    }
    doc.text(vD, col2X + 14, curY2)
  }

  // 3 celdas derechas (label + valor por fila)
  const rLblX = MARGIN + titleW
  const rValX = rLblX + rightLblW

  const rRowH1 = headerTotalH / 3
  const rRowH2 = headerTotalH / 3
  const rRowH3 = headerTotalH - rRowH1 - rRowH2

  const rRow1Y = gY
  const rRow2Y = gY + rRowH1
  const rRow3Y = gY + rRowH1 + rRowH2

  // Fila 1: FACTURA N°
  doc.rect(rLblX, rRow1Y, rightLblW, rRowH1, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_DARK)
  doc.text('FACTURA N°', rLblX + rightLblW / 2, rRow1Y + rRowH1 / 2 + 0.8, { align: 'center' })
  
  doc.rect(rValX, rRow1Y, rightValW, rRowH1, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(String(nroFactura).padStart(5, '0'), rValX + rightValW / 2, rRow1Y + rRowH1 / 2 + 0.8, { align: 'center' })

  // Fila 2: N° CONTROL
  doc.rect(rLblX, rRow2Y, rightLblW, rRowH2, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text('N° CONTROL', rLblX + rightLblW / 2, rRow2Y + rRowH2 / 2 + 0.8, { align: 'center' })
  
  doc.rect(rValX, rRow2Y, rightValW, rRowH2, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(displayControl, rValX + rightValW / 2, rRow2Y + rRowH2 / 2 + 0.8, { align: 'center' })

  // Fila 3: FECHA
  doc.rect(rLblX, rRow3Y, rightLblW, rRowH3, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text('FECHA:', rLblX + rightLblW / 2, rRow3Y + rRowH3 / 2 + 0.8, { align: 'center' })
  
  doc.rect(rValX, rRow3Y, rightValW, rRowH3, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(fmtFecha(despacho.creado_en), rValX + rightValW / 2, rRow3Y + rRowH3 / 2 + 0.8, { align: 'center' })

  let yAfterHeader = gY + tripleH + 2

  if (!clientInHeader) {
    // ── Fila 4: CLIENTE + R.I.F / Cédula ──
    const f4Y = gY + tripleH
    const clienteLblW = 25
    const rifLblW = 22
    const rifValW = 38
    const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 0.8)
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')

    doc.rect(MARGIN + clienteLblW, f4Y, clienteValW, rowH, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    const clienteNombre = (cliente.nombre || '—').toUpperCase()
    const maxClienteW = clienteValW - 4
    let cNombre = clienteNombre
    if (doc.getTextWidth(cNombre) > maxClienteW) {
      while (cNombre.length > 1 && doc.getTextWidth(cNombre + '…') > maxClienteW) cNombre = cNombre.slice(0, -1)
      cNombre += '…'
    }
    doc.text(cNombre, MARGIN + clienteLblW + 2, f4Y + rowH / 2 + 0.8)

    doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 0.8, { align: 'center' })

    doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')
    doc.setFont('helvetica', 'bold')
    let rifValFontSize = 9.5
    doc.setFontSize(rifValFontSize)
    const rifText = cliente.rif_cedula || '—'
    const maxRifW = rifValW - 4
    while (doc.getTextWidth(rifText) > maxRifW && rifValFontSize > 6) {
      rifValFontSize -= 0.5
      doc.setFontSize(rifValFontSize)
    }
    doc.text(rifText, MARGIN + clienteLblW + clienteValW + rifLblW + rifValW / 2, f4Y + rowH / 2 + 0.8, { align: 'center' })

    // ── Fila 5: DIRECCIÓN (altura dinámica para texto largo) ──
    const f5Y = f4Y + rowH
    const dirLblW = 25
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ').toUpperCase() || '—'
    const maxDirW = CONTENT_W - dirLblW - 4
    const dirLines = doc.splitTextToSize(dirStr, maxDirW)
    const dirLineH = 3.8
    const dirRowH = Math.max(rowH, dirLines.length * dirLineH + 2.0)

    // Celda label DIRECCIÓN
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(gridLW)
    doc.rect(MARGIN, f5Y, dirLblW, dirRowH, 'S')
    doc.setTextColor(...C_DARK)
    doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + dirRowH / 2 + 0.8)

    // Celda valor DIRECCIÓN — con wrap
    doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, dirRowH, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    const dirTextStartY = f5Y + (dirRowH - dirLines.length * dirLineH) / 2 + dirLineH - 0.8
    dirLines.forEach((line, idx) => {
      doc.text(line, MARGIN + dirLblW + 2, dirTextStartY + idx * dirLineH)
    })

    // ── Fila 6: TELÉFONO + VENDEDOR ──
    const f6Y = f5Y + dirRowH
    const tlfLblW = 25
    const tlfValW = 35
    const vendLblW = 25
    const vendValW = CONTENT_W - tlfLblW - tlfValW - vendLblW

    doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 0.8)

    doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
    doc.setFont('helvetica', 'bold')
    let tlfFontSize = 9.5
    doc.setFontSize(tlfFontSize)
    const tlfText = fmtTelefono(cliente.telefono) || '—'
    const maxTlfW = tlfValW - 4
    while (doc.getTextWidth(tlfText) > maxTlfW && tlfFontSize > 6) {
      tlfFontSize -= 0.5
      doc.setFontSize(tlfFontSize)
    }
    doc.text(tlfText, MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 0.8)

    doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 0.8)

    doc.setFillColor(235, 235, 240)
    doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    const vendStr = (vendedorResponsable?.nombre?.toUpperCase() || '—') + vendedorTlf
    const maxVendW = vendValW - 4
    let vStr = vendStr
    if (doc.getTextWidth(vStr) > maxVendW) {
      while (vStr.length > 1 && doc.getTextWidth(vStr + '…') > maxVendW) vStr = vStr.slice(0, -1)
      vStr += '…'
    }
    doc.text(vStr, MARGIN + tlfLblW + tlfValW + vendLblW + 2, f6Y + rowH / 2 + 0.8)

    yAfterHeader = f6Y + rowH + 2
  }

  y = yAfterHeader

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'TOTAL BCV'  : 'TOTAL'
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 11,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 11,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 87,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 118,  w: 11,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 129,  w: 27,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 156,  w: 32,  align: 'right'  },
  ]
  const ROW_H_BASE = 5.2

  // Cabecera tabla
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 5.3, { align: col.align })
  })
  y += 7.5

  // Items
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  const itemsToRender = [...items]
  const fleteVal = Number(despacho.flete_usd || 0)
  if (fleteVal > 0) {
    itemsToRender.push({
      cantidad: 1,
      codigo_snap: 'FTL1005632',
      nombre_snap: 'SERVICIO DE FLETE (E)',
      unidad_snap: 'UND',
      precio_unit_usd: fleteVal,
      total_linea_usd: fleteVal,
      tiene_descuento: false
    })
  }

  const corteVal = Number(despacho.corte_usd || 0)
  if (corteVal > 0) {
    itemsToRender.push({
      cantidad: 1,
      codigo_snap: 'CRT1254698',
      nombre_snap: 'SERVICIO DE CORTE (E)',
      unidad_snap: 'UND',
      precio_unit_usd: corteVal,
      total_linea_usd: corteVal,
      tiene_descuento: false
    })
  }

  const isLargeDoc = itemsToRender.length >= 23

  itemsToRender.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const descLines = doc.splitTextToSize((item.nombre_snap || '').toUpperCase(), COLS[2].w - 4)
    const lineH = 3.6
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 1.2)

    let limitY = PAGE_H - 40 // Margen de seguridad para el footer
    
    // BALANCEO INTELIGENTE: Si hay más de 20 items, cortamos antes en la Pág 1
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 120
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numFac)
      // Redraw table header
      doc.setFillColor(60, 60, 60)
      doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_WHITE)
      COLS.forEach(col => {
        let tx = col.x + 2
        if (col.align === 'center') tx = col.x + col.w / 2
        else if (col.align === 'right') tx = col.x + col.w - 2
        doc.text(col.label, tx, y + 5.3, { align: col.align })
      })
      y += 7.5
    }

    doc.setLineWidth(0.2)
    doc.setDrawColor(200, 200, 200)
    if (item.tiene_descuento) {
      doc.setFillColor(235, 235, 240)
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'FD')
    } else {
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    }
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    const midY = y + ROW_H / 2 + 1.0
    const isFlete = (item.nombre_snap || '').toUpperCase().includes('FLETE') || (item.codigo_snap || '').startsWith('FTL')
    const cantDisplay = item.cantidad ?? (isFlete ? 1 : '')
    let cantSize = 9
    doc.setFontSize(cantSize)
    const cantText = String(cantDisplay)
    const maxCantW = COLS[0].w - 1.5
    while (doc.getTextWidth(cantText) > maxCantW && cantSize > 6) {
      cantSize -= 0.5
      doc.setFontSize(cantSize)
    }
    doc.text(cantText, COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    let codSize = 6.5
    doc.setFontSize(codSize)
    const codText = item.codigo_snap || '—'
    const maxCodW = COLS[1].w - 2
    while (doc.getTextWidth(codText) > maxCodW && codSize > 4.5) {
      codSize -= 0.5
      doc.setFontSize(codSize)
    }
    doc.text(codText, COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })

    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH - 0.8
    descLines.forEach((line, idx) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })

    let uniSize = 9
    doc.setFontSize(uniSize)
    const uniText = (item.unidad_snap || '-').toUpperCase()
    const maxUniW = COLS[3].w - 1.5
    while (doc.getTextWidth(uniText) > maxUniW && uniSize > 6) {
      uniSize -= 0.5
      doc.setFontSize(uniSize)
    }
    doc.text(uniText, COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    const precioText = fmtPrecioFac(item.precio_unit_usd, monedaPDF, tasa, factorBcv)
    const totalText = fmtPrecioFac(item.total_linea_usd, monedaPDF, tasa, factorBcv)

    const fitTextCol = (text, col, baseFontSize, bold) => {
      const maxW = col.w - 4
      let fs = baseFontSize
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      while (fs > 6) {
        doc.setFontSize(fs)
        if (doc.getTextWidth(text) <= maxW) break
        fs -= 0.5
      }
      doc.setFontSize(fs)
      doc.text(text, col.x + col.w - 2, midY, { align: 'right' })
    }

    fitTextCol(precioText, COLS[4], 10.5, false)
    fitTextCol(totalText, COLS[5], 10.5, true)
    doc.setFontSize(9)

    y += ROW_H
  })

  y += 2
  y = y + 2

  // Margen superior membrete: 50mm (5cm) | Margen inferior: 25mm (2.5cm)
  // creditRowY = sloganY - 4 - CREDIT_ROW_H → borde inferior = sloganY - 4 = PAGE_H - 25
  const sloganY = PAGE_H - 21

  // ── Cálculo del IVA (16% sumado) ──
  const total = Number(despacho.total_usd || 0)
  const flete = Number(despacho.flete_usd || 0)
  const corte = Number(despacho.corte_usd || 0)
  const montoExento = flete + corte
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  const totalFinal = total - descuentoTotal

  const baseImponible = totalFinal - montoExento  // El total de los productos (después de descuentos, excluyendo flete/corte) es la Base Imponible
  const ivaPct = 16
  const ivaAmount = baseImponible * (ivaPct / 100)  // Se le suma el 16% de IVA
  const totalFacturaFinal = baseImponible + ivaAmount + montoExento

  const hasExento = montoExento > 0
  const hasFlete = flete > 0
  const hasDescuento = descuentoTotal > 0
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const refPago = despacho.referencia_pago || ''

  // ══════════════════════════════════════════════════════════════════════════
  // 4. BLOQUE COMBINADO: Crédito + Transporte (izq) | Desglose (der) + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  // Desglose de totales de factura
  const rightItems = [
    { label: 'SubTotal:', value: fmtTotalFac(total, monedaPDF, tasa, factorBcv) },
    { label: 'Descuento:', value: fmtTotalFac(descuentoTotal, monedaPDF, tasa, factorBcv) },
    { label: 'Exento:', value: fmtTotalFac(montoExento, monedaPDF, tasa, factorBcv) },
    { label: 'Base Gravable:', value: fmtTotalFac(baseImponible, monedaPDF, tasa, factorBcv) },
    { label: `IVA ${ivaPct}%:`, value: fmtTotalFac(ivaAmount, monedaPDF, tasa, factorBcv) },
    { label: 'IGTF 3%:', value: fmtTotalFac(0, monedaPDF, tasa, factorBcv) }
  ]

  if (refPago) {
    rightItems.push({ label: 'Ref:', value: refPago })
  }

  const numComboRows = rightItems.length
  const totalBarH = 5.5
  const CREDIT_ROW_H = 4.5
  const creditRowY = sloganY - 4 - CREDIT_ROW_H
  const comboBottom = creditRowY - 2
  const dataRowH = 3.6
  const comboTop = comboBottom - totalBarH - numComboRows * dataRowH

  // Notas Adicionales
  if (despacho.notes?.trim() || despacho.notas?.trim()) {
    const notasTexto = (despacho.notes || despacho.notas || '').trim()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const notasLineas = doc.splitTextToSize(notasTexto, CONTENT_W)
    const notasH = 3 + notasLineas.length * 4.5
    const notasStartY = comboTop - 2 - notasH

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS:', MARGIN, notasStartY + 3)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    notasLineas.forEach((lin, i) => {
      doc.text(lin, MARGIN, notasStartY + 3 + 4.5 + i * 4.5)
    })
  }

  // Dibujar desglose
  const comboLeftW = CONTENT_W - 90
  const comboRightW = CONTENT_W - comboLeftW

  for (let r = 0; r < numComboRows; r++) {
    const ry = comboTop + r * dataRowH

    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN + comboLeftW, ry, comboRightW, dataRowH, 'S')
    
    const item = rightItems[r]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.2)
    doc.setTextColor(...C_DARK)
    doc.text(item.label, MARGIN + comboLeftW + 3, ry + dataRowH / 2 + 0.8)
    doc.text(item.value, MARGIN + CONTENT_W - 3, ry + dataRowH / 2 + 0.8, { align: 'right' })
  }

  // Barra TOTAL Factura
  const totTopY = comboTop + numComboRows * dataRowH
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN + comboLeftW, totTopY, comboRightW, totalBarH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('Total Factura:', MARGIN + comboLeftW + 3, totTopY + 4.8)
  doc.text(fmtTotalFac(totalFacturaFinal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 3, totTopY + 4.8, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. CONDICIONES DE PAGO
  // ══════════════════════════════════════════════════════════════════════════
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, creditRowY, CONTENT_W, CREDIT_ROW_H, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C_DARK)
  doc.text('8 DÍAS DE CRÉDITO CONTINUO', MARGIN + 3, creditRowY + CREDIT_ROW_H / 2 + 1.0)

  // ── Slogan ──
  if (y < sloganY) {
    if (!esMembrete) {
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(12)
      doc.setTextColor(...C_DARK)
      doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
    }
  }

  // ── FOOTER LIMPIO ──
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H
    if (!esMembrete) {
      const footerY = ph - 28
      doc.setLineWidth(0.8)
      doc.setDrawColor(...C_DARK)
      doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)

      const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
      const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

      doc.text(addr1, PAGE_W / 2, footerY + 5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.text(addr2, PAGE_W / 2, footerY + 9, { align: 'center' })

      doc.setFontSize(8)
      const tel = fmtTelefono(config.telefono_negocio) || ''
      const email = config.email_negocio || ''
      const contactLine = [tel, email].filter(Boolean).join('     |     ')
      if (contactLine) {
        doc.setFont('helvetica', 'normal')
        doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
      }
    }
  }

  // ── Guardar o devolver blob ──
  const clienteNombreDes = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaDes = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `FACTURA_${numFac.replace(/ /g, '_')}_${clienteNombreDes}_${fechaDes}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
