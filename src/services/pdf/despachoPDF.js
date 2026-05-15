// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Entrega — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtUsd, fmtBs, fmtBcvUsd, fmtPrecio, fmtTotal, fmtFecha, fmtTelefono,
  hexToRgb, drawCheck, drawWatermark, drawAnuladaWatermark,
} from './pdfShared'

export async function generarDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numDes = `N°- ${String(despacho.cotizacion?.numero ?? despacho.numero).padStart(5, '0')}`
  let pageNum = 1
  // isLargeDoc se definirá después de calcular itemsToRender (con flete/corte)

  const drawHeader = (doc, num) => {
    const HDR_H = 20
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) {}
    const centerX = PAGE_W / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.setTextColor(...C_DARK)
    doc.text('CONSTRUACERO CARABOBO, C.A.', centerX, 16, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('RIF.: J-50115913-0', centerX, 22, { align: 'center' })
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)
    return HDR_H + 17
  }

  y = drawHeader(doc, numDes)

  // ── Marca de agua central ──
  drawWatermark(doc)
  if (despacho.estado === 'anulada') drawAnuladaWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula profesional
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente_factura || despacho.cliente || {}
  const vendedorTlf = despacho.vendedor?.telefono ? ` — ${fmtTelefono(despacho.vendedor.telefono)}` : ''

  // Nombre del día
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  // Helper para dibujar una celda con borde
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  function drawCell(x, cy, w, h, label, value, opts = {}) {
    // Borde de la celda
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(gridLW)
    doc.rect(x, cy, w, h, 'S')

    if (opts.fill) {
      doc.setFillColor(...(opts.fillColor || [240, 240, 240]))
      doc.rect(x + 0.15, cy + 0.15, w - 0.3, h - 0.3, 'F')
    }

    const pad = 2
    const midY = cy + h / 2

    if (label && value !== undefined) {
      // Label + valor
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(opts.labelSize || 8)
      doc.setTextColor(...C_DARK)
      doc.text(label, x + pad, midY + 0.5)
      const lblW = doc.getTextWidth(label + ' ')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(opts.valSize || 10)
      const valStr = String(value)
      const maxW = w - lblW - pad * 2 - 1
      let displayVal = valStr
      if (doc.getTextWidth(displayVal) > maxW && maxW > 0) {
        while (displayVal.length > 1 && doc.getTextWidth(displayVal + '…') > maxW) {
          displayVal = displayVal.slice(0, -1)
        }
        displayVal += '…'
      }
      doc.text(displayVal, x + pad + lblW, midY + 0.5)
    } else if (label) {
      // Solo texto centrado (título)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(opts.fontSize || 12)
      doc.setTextColor(...C_DARK)
      if (opts.center) {
        doc.text(label, x + w / 2, midY + 1, { align: 'center' })
      } else {
        doc.text(label, x + pad, midY + 1)
      }
    }
  }

  // ── Fila 1-3: Header con título y datos de correlativo/fecha ──
  const gY = y - 4    // inicio de la cuadrícula
  const rowH = 6       // altura de cada fila pequeña
  const leftColW = 38  // "DEPARTAMENTO DE VENTAS"
  const rightLblW = 22 // columna label derecha (ODC, DIA, FECHA)
  const rightValW = 38 // columna valor derecha
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW // columna central

  // Celda izquierda (3 filas de alto): DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central (3 filas de alto): NOTA DE ENTREGA
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('NOTA DE ENTREGA', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas (label + valor por fila)
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC / Correlativo
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(numDes, rValX + rightValW / 2, gY + rowH / 2 + 1, { align: 'center' })

  // Fila 2: DIA
  const f2Y = gY + rowH
  doc.rect(rLblX, f2Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(diaNombre, rValX + rightValW / 2, f2Y + rowH / 2 + 1, { align: 'center' })

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(fmtFecha(despacho.creado_en), rValX + rightValW / 2, f3Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 4: CLIENTE + R.I.F / Cédula ──
  const f4Y = gY + tripleH
  const clienteLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 1)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.2)
  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')

  doc.rect(MARGIN + clienteLblW, f4Y, clienteValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const clienteNombre = (cliente.nombre || '—').toUpperCase()
  const maxClienteW = clienteValW - 4
  let cNombre = clienteNombre
  if (doc.getTextWidth(cNombre) > maxClienteW) {
    while (cNombre.length > 1 && doc.getTextWidth(cNombre + '…') > maxClienteW) cNombre = cNombre.slice(0, -1)
    cNombre += '…'
  }
  doc.text(cNombre, MARGIN + clienteLblW + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(cliente.rif_cedula || '—', MARGIN + clienteLblW + clienteValW + rifLblW + rifValW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 5: DIRECCIÓN (altura dinámica para texto largo) ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ').toUpperCase() || '—'
  const maxDirW = CONTENT_W - dirLblW - 4
  const dirLines = doc.splitTextToSize(dirStr, maxDirW)
  const dirLineH = 4.5
  const dirRowH = Math.max(rowH, dirLines.length * dirLineH + 2.5)

  // Celda label DIRECCIÓN
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, f5Y, dirLblW, dirRowH, 'S')
  doc.setTextColor(...C_DARK)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + dirRowH / 2 + 1)

  // Celda valor DIRECCIÓN — con wrap
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, dirRowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirTextStartY = f5Y + (dirRowH - dirLines.length * dirLineH) / 2 + dirLineH - 1
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
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(fmtTelefono(cliente.telefono) || '—', MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)

  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const vendStr = (despacho.vendedor?.nombre?.toUpperCase() || '—') + vendedorTlf
  const maxVendW = vendValW - 4
  let vStr = vendStr
  if (doc.getTextWidth(vStr) > maxVendW) {
    while (vStr.length > 1 && doc.getTextWidth(vStr + '…') > maxVendW) vStr = vStr.slice(0, -1)
    vStr += '…'
  }
  doc.text(vStr, MARGIN + tlfLblW + tlfValW + vendLblW + 2, f6Y + rowH / 2 + 1)

  y = f6Y + rowH + 2

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
  const ROW_H_BASE = 6.0

  // Cabecera tabla
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 6.5, { align: col.align })
  })
  y += 9

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
    const lineH = 4.0
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 2)

    let limitY = PAGE_H - 40 // Margen de seguridad para el footer
    
    // BALANCEO INTELIGENTE: Si hay más de 20 items, cortamos antes en la Pág 1
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 120 // Forzamos un reparto más equitativo
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDes)
      // Redraw table header on new page
      doc.setFillColor(60, 60, 60)
      doc.rect(MARGIN, y, CONTENT_W, 9, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_WHITE)
      COLS.forEach(col => {
        let tx = col.x + 2
        if (col.align === 'center') tx = col.x + col.w / 2
        else if (col.align === 'right') tx = col.x + col.w - 2
        doc.text(col.label, tx, y + 6.5, { align: col.align })
      })
      y += 9
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

    const midY = y + ROW_H / 2 + 1.2
    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.setFontSize(6.5)
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    doc.setFontSize(9)

    // Render all lines of the description
    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH
    descLines.forEach((line, idx) => {
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })

    doc.text((item.unidad_snap || '-').toUpperCase(), COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    const precioText = fmtPrecio(item.precio_unit_usd, monedaPDF, tasa, factorBcv)
    const totalText = fmtPrecio(item.total_linea_usd, monedaPDF, tasa, factorBcv)

    // Auto-reducir fuente si el texto no cabe
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

  // ── Layout fijo: posiciones calculadas desde el fondo ──
  // Si es un documento grande y todavía estamos en la página 1, forzamos página para los totales
  // No forzar salto de página artificial, el limitY ya se encarga de dejar espacio
  y = y + 2

  const sloganY = PAGE_H - 33

  const total = Number(despacho.total_usd || 0)
  const flete = Number(despacho.flete_usd || 0)
  const corte = Number(despacho.corte_usd || 0)
  const montoExento = flete + corte
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  const totalFinal = total - descuentoTotal
  const hasExento = montoExento > 0
  const hasFlete = flete > 0
  const hasDescuento = descuentoTotal > 0
  const ivaPct = Number(config.iva_pct) || 16
  const montoGravado = totalFinal - montoExento  // IVA solo sobre productos, no exentos
  const baseImponible = montoGravado / (1 + ivaPct / 100)
  const ivaAmount = montoGravado - baseImponible
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const refPago = despacho.referencia_pago || ''

  // ══════════════════════════════════════════════════════════════════════════
  // 4. BLOQUE COMBINADO: Crédito + Transporte (izq) | Desglose (der) + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  // Columna derecha: desglose
  const rightItems = [
    { label: 'Base', value: fmtTotal(baseImponible, monedaPDF, tasa, factorBcv) },
    { label: `IVA ${ivaPct}%`, value: fmtTotal(ivaAmount, monedaPDF, tasa, factorBcv) },
  ]
  if (hasExento) rightItems.push({ label: 'Monto Exento', value: fmtTotal(montoExento, monedaPDF, tasa, factorBcv) })
  if (hasDescuento) rightItems.push({ label: 'Descuento', value: '-' + fmtTotal(descuentoTotal, monedaPDF, tasa, factorBcv), color: [180, 100, 0] })
  if (refPago) rightItems.push({ label: 'Ref:', value: refPago })

  const numComboRows = rightItems.length
  const totalBarH = 8
  const CREDIT_ROW_H = 6
  const CHOFER_H = 20  // header(6) + fila1(7) + fila2(7)
  const creditRowY = sloganY - 5 - CHOFER_H - CREDIT_ROW_H
  const choferGridY = creditRowY + CREDIT_ROW_H
  const comboBottom = creditRowY - 2
  const dataRowH = 5
  const comboTop = comboBottom - totalBarH - numComboRows * dataRowH

  // Notas Adicionales — ancladas 2mm sobre el bloque de totales
  if (despacho.notas?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const notasLineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    const notasH = 5 + notasLineas.length * 5
    const notasStartY = comboTop - 2 - notasH

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS:', MARGIN, notasStartY + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    notasLineas.forEach((lin, i) => {
      doc.text(lin, MARGIN, notasStartY + 4 + 5 + i * 5)
    })
  }

  // Dibujar filas de datos
  const comboLeftW = CONTENT_W - 90
  const comboRightW = CONTENT_W - comboLeftW

  for (let r = 0; r < numComboRows; r++) {
    const ry = comboTop + r * dataRowH

    // Celda derecha
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN + comboLeftW, ry, comboRightW, dataRowH, 'S')
    
    const item = rightItems[r]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    if (item.color) doc.setTextColor(...item.color)
    else doc.setTextColor(...C_DARK)
    doc.text(item.label, MARGIN + comboLeftW + 3, ry + dataRowH / 2 + 1)
    doc.text(item.value, MARGIN + CONTENT_W - 3, ry + dataRowH / 2 + 1, { align: 'right' })
  }

  // Barra TOTAL (alineada con cuadrícula derecha)
  const totTopY = comboTop + numComboRows * dataRowH
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN + comboLeftW, totTopY, comboRightW, totalBarH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_WHITE)
  doc.text('Total:', MARGIN + comboLeftW + 3, totTopY + 7)
  doc.text(fmtTotal(totalFinal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 3, totTopY + 7, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — cuadrícula fija encima del slogan
  // ══════════════════════════════════════════════════════════════════════════

  // Fila: 8 DÍAS DE CRÉDITO CONTINUO
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, creditRowY, CONTENT_W, CREDIT_ROW_H, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('8 DÍAS DE CRÉDITO CONTINUO', MARGIN + 3, creditRowY + CREDIT_ROW_H / 2 + 1.5)

  // Grid del chofer
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferGridY, CONTENT_W, 6, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferGridY, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferGridY + 4)

  const CHOFER_ROW_H = 7
  const choferRow1Y = choferGridY + 6
  const choferRow2Y = choferRow1Y + CHOFER_ROW_H
  const col3W = CONTENT_W / 3
  const col4W = CONTENT_W / 4
  const choferRow1Fields = [
    { label: 'CHOFER',  val: (transportista?.nombre      || '').toUpperCase() },
    { label: 'C.I.',   val: (transportista?.rif          || '').toUpperCase() },
    { label: 'COLOR',  val: (transportista?.color        || '').toUpperCase() },
  ]
  const choferRow2Fields = [
    { label: 'VEHÍCULO',    val: (transportista?.vehiculo    || '').toUpperCase() },
    { label: 'PLACA CHUTO', val: (transportista?.placa_chuto || '').toUpperCase() },
    { label: 'PLACA BATEA', val: (transportista?.placa_batea || '').toUpperCase() },
  ]
  if (!hasFlete) choferRow2Fields.push({ label: 'FLETE', val: '' })

  function drawChoferRow(fields, ry, colW) {
    fields.forEach((f, i) => {
      const fx = MARGIN + i * colW
      doc.setDrawColor(120, 120, 120)
      doc.setLineWidth(0.3)
      doc.rect(fx, ry, colW, CHOFER_ROW_H, 'S')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(100, 100, 100)
      doc.text(f.label, fx + 2, ry + 2.5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(0, 0, 0)
      if (f.val) doc.text(f.val, fx + 2, ry + 5.8)
    })
  }
  drawChoferRow(choferRow1Fields, choferRow1Y, col3W)
  drawChoferRow(choferRow2Fields, choferRow2Y, !hasFlete ? col4W : col3W)

  // ── Slogan ──
  if (y < sloganY) {
    doc.setFont('helvetica', 'bolditalic')
    doc.setFontSize(12)
    doc.setTextColor(...C_DARK)
    doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER LIMPIO (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  // Footer SOLO en la última página — en páginas intermedias el espacio queda libre
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
  const ph = PAGE_H
  {

    // Línea separadora
    const footerY = ph - 28
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

    // Dirección
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)

    const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
    const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

    doc.text(addr1, PAGE_W / 2, footerY + 5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W / 2, footerY + 9, { align: 'center' })

    // Teléfono y correo
    doc.setFontSize(8)
    const tel = fmtTelefono(config.telefono_negocio) || ''
    const email = config.email_negocio || ''
    const contactLine = [tel, email].filter(Boolean).join('     |     ')
    if (contactLine) {
      doc.setFont('helvetica', 'normal')
      doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
    }
  }

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const clienteNombreDes = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaDes = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `${numDes.replace(/ /g, '_')}_${clienteNombreDes}_${fechaDes}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
}
