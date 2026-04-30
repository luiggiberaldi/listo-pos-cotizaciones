// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Entrega — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  CUENTAS_BANCARIAS,
  fmtUsd, fmtBs, fmtBcvUsd, fmtPrecio, fmtTotal, fmtFecha,
  hexToRgb, drawCheck, drawWatermark, drawAnuladaWatermark,
} from './pdfShared'

export async function generarDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numDes = `N°- ${String(despacho.cotizacion?.numero ?? despacho.numero).padStart(5, '0')}`

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA HORIZONTAL COMPACTA (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 20

  // Logo a la izquierda (más pequeño)
  try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) {}

  // Nombre del negocio centrado
  const centerX = PAGE_W / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C_DARK)
  doc.text('CONSTRUACERO CARABOBO, C.A.', centerX, 16, { align: 'center' })

  // RIF centrado
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('RIF.: J-50115913-0', centerX, 22, { align: 'center' })

  // Línea separadora
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)

  y = HDR_H + 17

  // ── Marca de agua central ──
  drawWatermark(doc)
  if (despacho.estado === 'anulada') drawAnuladaWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula profesional
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente_factura || despacho.cliente || {}
  const vendedorTlf = despacho.vendedor?.telefono ? ` — ${despacho.vendedor.telefono}` : ''

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
  const rowH = 7       // altura de cada fila pequeña
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
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central (3 filas de alto): NOTA DE ENTREGA
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('NOTA DE ENTREGA', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas (label + valor por fila)
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC / Correlativo
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
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
  doc.setFontSize(8)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(diaNombre, rValX + rightValW / 2, f2Y + rowH / 2 + 1, { align: 'center' })

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
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
  doc.setFontSize(8)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 1)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.2)
  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')

  doc.rect(MARGIN + clienteLblW, f4Y, clienteValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const clienteNombre = cliente.nombre || '—'
  const maxClienteW = clienteValW - 4
  let cNombre = clienteNombre
  if (doc.getTextWidth(cNombre) > maxClienteW) {
    while (cNombre.length > 1 && doc.getTextWidth(cNombre + '…') > maxClienteW) cNombre = cNombre.slice(0, -1)
    cNombre += '…'
  }
  doc.text(cNombre, MARGIN + clienteLblW + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(cliente.rif_cedula || '—', MARGIN + clienteLblW + clienteValW + rifLblW + rifValW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 5: DIRECCIÓN (ancho completo) ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.rect(MARGIN, f5Y, dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + rowH / 2 + 1)

  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ') || '—'
  const maxDirW = CONTENT_W - dirLblW - 4
  let dStr = dirStr
  if (doc.getTextWidth(dStr) > maxDirW) {
    while (dStr.length > 1 && doc.getTextWidth(dStr + '…') > maxDirW) dStr = dStr.slice(0, -1)
    dStr += '…'
  }
  doc.text(dStr, MARGIN + dirLblW + 2, f5Y + rowH / 2 + 1)

  // ── Fila 6: TELÉFONO + VENDEDOR ──
  const f6Y = f5Y + rowH
  const tlfLblW = 25
  const tlfValW = 35
  const vendLblW = 25
  const vendValW = CONTENT_W - tlfLblW - tlfValW - vendLblW

  doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(cliente.telefono || '—', MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)

  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const vendStr = (despacho.vendedor?.nombre || '—') + vendedorTlf
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
  const ROW_H_BASE = 6.5

  // Cabecera tabla
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
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

  items.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    const lineH = 4.5
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 4)

    if (y + ROW_H > PAGE_H - 108) { doc.addPage(); y = MARGIN }

    doc.setLineWidth(0.2)
    doc.setDrawColor(200, 200, 200)
    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    const midY = y + ROW_H / 2 + 1.2
    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.setFontSize(8)
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    doc.setFontSize(9)

    // Render all lines of the description
    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH
    descLines.forEach((line, idx) => {
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })

    doc.text(item.unidad_snap || '—', COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    const precioText = fmtPrecio(item.precio_unit_usd, monedaPDF, tasa, factorBcv)
    const totalText = fmtPrecio(item.total_linea_usd, monedaPDF, tasa, factorBcv)
    doc.setFontSize(10.5)
    doc.text(precioText, COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(totalText, COLS[5].x + COLS[5].w - 2, midY, { align: 'right' })
    doc.setFontSize(9)

    y += ROW_H
  })

  // Notas Adicionales
  if (despacho.notas?.trim()) {
    y += 3
    if (y > PAGE_H - 65) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS:', MARGIN, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    lineas.forEach(lin => {
      y += 5
      doc.text(lin, MARGIN, y + 4)
    })
    y += 4
  }

  y += 2

  // ── Layout fijo: posiciones calculadas desde el fondo ──
  const sloganY = PAGE_H - 33

  const total = Number(despacho.total_usd || 0)
  const flete = Number(despacho.flete_usd || 0)
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  const totalFinal = total - descuentoTotal
  const hasFlete = flete > 0
  const hasDescuento = descuentoTotal > 0
  const ivaPct = Number(config.iva_pct) || 16
  const montoGravado = totalFinal - flete  // IVA solo sobre productos, no flete
  const baseImponible = montoGravado / (1 + ivaPct / 100)
  const ivaAmount = montoGravado - baseImponible
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const refPago = despacho.referencia_pago || ''

  // ══════════════════════════════════════════════════════════════════════════
  // 4. BLOQUE COMBINADO: Crédito + Transporte (izq) | Desglose (der) + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  const comboLeftW = Math.round(CONTENT_W * 0.62)
  const comboRightW = CONTENT_W - comboLeftW
  const dataRowH = 7

  // Columna derecha: desglose
  const rightItems = [
    { label: 'Base', value: fmtTotal(baseImponible, monedaPDF, tasa, factorBcv) },
    { label: `IVA ${ivaPct}%`, value: fmtTotal(ivaAmount, monedaPDF, tasa, factorBcv) },
  ]
  if (hasFlete) rightItems.push({ label: 'Flete', value: fmtTotal(flete, monedaPDF, tasa, factorBcv) })
  if (hasDescuento) rightItems.push({ label: 'Descuento', value: '-' + fmtTotal(descuentoTotal, monedaPDF, tasa, factorBcv), color: [180, 100, 0] })
  if (refPago) rightItems.push({ label: 'Ref:', value: refPago })

  // Columna izquierda: crédito + datos transporte
  // Helper: divide segmentos en múltiples líneas si exceden el ancho disponible
  function splitSegmentsIntoLines(segments, fontSize, maxW) {
    const lines = []
    let currentSegs = []
    let currentW = 0
    const pad = 6 // margen interno izq+der
    for (const seg of segments) {
      doc.setFont('helvetica', seg.bold ? 'bold' : 'normal')
      doc.setFontSize(fontSize)
      const segW = doc.getTextWidth(seg.text)
      if (currentSegs.length > 0 && currentW + segW > maxW - pad) {
        lines.push([...currentSegs])
        currentSegs = []
        currentW = 0
      }
      currentSegs.push(seg)
      currentW += segW
    }
    if (currentSegs.length > 0) lines.push(currentSegs)
    return lines
  }

  const leftLines = [{ text: '8 DÍAS DE CRÉDITO CONTINUO', bold: true, size: 9 }]
  if (transportista) {
    const tNom = transportista.nombre || ''
    const tCI = transportista.rif || ''
    const tColor = transportista.color || ''
    const choferSegs = [
      { text: 'Chofer: ', bold: false }, { text: tNom, bold: true },
      { text: '  —  CI: ', bold: false }, { text: tCI, bold: true },
      { text: '  —  Color: ', bold: false }, { text: tColor, bold: true },
    ]
    for (const segs of splitSegmentsIntoLines(choferSegs, 8, comboLeftW)) {
      leftLines.push({ segments: segs, size: 8 })
    }
    const tVeh = transportista.vehiculo || ''
    const tPlaca = transportista.zona_cobertura || ''
    const tChuto = transportista.placa_chuto || ''
    const tBatea = transportista.placa_batea || ''
    const vehSegs = [
      { text: 'Vehículo: ', bold: false }, { text: tVeh, bold: true },
      { text: '  —  Placa: ', bold: false }, { text: tPlaca, bold: true },
    ]
    if (tChuto) vehSegs.push({ text: '  —  Chuto: ', bold: false }, { text: tChuto, bold: true })
    if (tBatea) vehSegs.push({ text: '  —  Batea: ', bold: false }, { text: tBatea, bold: true })
    for (const segs of splitSegmentsIntoLines(vehSegs, 8, comboLeftW)) {
      leftLines.push({ segments: segs, size: 8 })
    }
  }

  const numComboRows = Math.max(leftLines.length, rightItems.length)
  const totalBarH = 10
  const comboBottom = sloganY - 9
  const comboTop = comboBottom - totalBarH - numComboRows * dataRowH

  // Dibujar filas de datos
  const rightOffset = numComboRows - rightItems.length
  for (let r = 0; r < numComboRows; r++) {
    const ry = comboTop + r * dataRowH

    // Celda izquierda
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, ry, comboLeftW, dataRowH, 'S')
    if (r < leftLines.length) {
      const line = leftLines[r]
      doc.setFontSize(line.size)
      doc.setTextColor(...C_DARK)
      if (line.segments) {
        let cx = MARGIN + 3
        for (const seg of line.segments) {
          doc.setFont('helvetica', seg.bold ? 'bold' : 'normal')
          doc.text(seg.text, cx, ry + dataRowH / 2 + 1)
          cx += doc.getTextWidth(seg.text)
        }
      } else {
        doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
        const maxTW = comboLeftW - 6
        let txt = line.text
        if (doc.getTextWidth(txt) > maxTW) {
          while (txt.length > 1 && doc.getTextWidth(txt + '…') > maxTW) txt = txt.slice(0, -1)
          txt += '…'
        }
        doc.text(txt, MARGIN + 3, ry + dataRowH / 2 + 1)
      }
    }

    // Celda derecha
    doc.rect(MARGIN + comboLeftW, ry, comboRightW, dataRowH, 'S')
    const ri = r - rightOffset
    if (ri >= 0 && ri < rightItems.length) {
      const item = rightItems[ri]
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      if (item.color) doc.setTextColor(...item.color)
      else doc.setTextColor(...C_DARK)
      doc.text(item.label, MARGIN + comboLeftW + 3, ry + dataRowH / 2 + 1)
      doc.text(item.value, MARGIN + CONTENT_W - 3, ry + dataRowH / 2 + 1, { align: 'right' })
    }
  }

  // Barra TOTAL (ancho completo)
  const totTopY = comboTop + numComboRows * dataRowH
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, totTopY, CONTENT_W, totalBarH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_WHITE)
  doc.text(`Total:  ${fmtTotal(totalFinal, monedaPDF, tasa, factorBcv)}`, MARGIN + CONTENT_W - 4, totTopY + 7, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. CONDICIONES (izq) + CUENTAS BANCARIAS (der) — encima del bloque combinado
  // ══════════════════════════════════════════════════════════════════════════
  const condiciones = [
    'Precios Sujetos a cambios sin previo aviso.',
    'El cliente se encarga de descargar la mercancía.',
  ]
  const condPadding = 2
  const condLineH = 4.5
  const condBoxH = 6 + condiciones.length * condLineH + condPadding * 2
  const halfW = CONTENT_W / 2 - 2
  const condTopY = comboTop - 5 - condBoxH

  // ── Condiciones (izquierda) ──
  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, condTopY, halfW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C_DARK)
  doc.text('CONDICIONES GENERALES:', MARGIN + condPadding, condTopY + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(MARGIN + condPadding, condTopY + condPadding + 5.5, MARGIN + halfW - condPadding, condTopY + condPadding + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  let condY = condTopY + condPadding + 9.5
  condiciones.forEach(c => {
    doc.text(`• ${c}`, MARGIN + condPadding, condY)
    condY += condLineH
  })

  // ── Cuentas bancarias (derecha) ──
  const rightX = MARGIN + halfW + 4

  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(rightX, condTopY, halfW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('Transferencias a nombre de ' + (config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.').toUpperCase(), rightX + condPadding, condTopY + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(rightX + condPadding, condTopY + condPadding + 5.5, rightX + halfW - condPadding, condTopY + condPadding + 5.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let cuentaY = condTopY + condPadding + 9.5
  CUENTAS_BANCARIAS.forEach(cuenta => {
    doc.text(cuenta, rightX + condPadding, cuentaY)
    cuentaY += condLineH
  })

  // ── Slogan ──
  if (y < sloganY) {
    doc.setFont('helvetica', 'bolditalic')
    doc.setFontSize(16)
    doc.setTextColor(...C_DARK)
    doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER LIMPIO (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    // Línea separadora
    const footerY = ph - 28
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

    // Dirección
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)

    const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
    const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

    doc.text(addr1, PAGE_W / 2, footerY + 5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W / 2, footerY + 9, { align: 'center' })

    // Teléfono y correo
    doc.setFontSize(8)
    const tel = config.telefono_negocio || ''
    const email = config.email_negocio || ''
    const contactLine = [tel, email].filter(Boolean).join('     |     ')
    if (contactLine) {
      doc.setFont('helvetica', 'normal')
      doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
    }
  }

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const filename = `${numDes.replace(/ /g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
}
