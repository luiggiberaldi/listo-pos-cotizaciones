// src/services/pdf/ordenDespachoPDF.js
// Genera PDF de Orden de Despacho — sin footer, cuentas, slogan ni condiciones
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtUsd, fmtBs, fmtBcvUsd, fmtPrecio, fmtTotal, fmtFecha, fmtTelefono,
  drawCheck, drawWatermark, drawAnuladaWatermark, drawAprobadoWatermark,
} from './pdfShared'

export async function generarOrdenDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0
  let y = 0

  const numDes = `N°- ${String(despacho.cotizacion?.numero ?? despacho.numero).padStart(5, '0')}`
  let pageNum = 1

  const drawHeader = (doc, num) => {
    const HDR_H = 20
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) {}
    const centerX = PAGE_W / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...C_DARK)
    doc.text('CONSTRUACERO CARABOBO C.A.', centerX, 16, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.text('RIF.: J-50115913-0', centerX, 22, { align: 'center' })
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)
    return HDR_H + 17
  }

  y = drawHeader(doc, numDes)

  // ── Marca de agua central ──
  drawWatermark(doc)
  if (despacho.estado === 'anulada') {
    drawAnuladaWatermark(doc)
  } else if ((despacho.estado === 'despachada' || despacho.estado === 'entregada') && despacho.aprobado_por_nombre) {
    drawAprobadoWatermark(doc, despacho.aprobado_por_nombre)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente_factura || despacho.cliente || {}
  const vendedorTlf = despacho.vendedor?.telefono ? ` — ${fmtTelefono(despacho.vendedor.telefono)}` : ''

  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  // ── Fila 1-3: Header con título y datos ──
  const gY = y - 4
  const rowH = 7
  const leftColW = 38
  const rightLblW = 22
  const rightValW = 38
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW

  // Celda izquierda: DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central: ORDEN DE DESPACHO
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ORDEN DE DESPACHO', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC
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

  // ── Fila 4: CLIENTE + RIF ──
  const f4Y = gY + tripleH
  const clienteLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 1)

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
  doc.setFontSize(7.5)
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
  doc.setFontSize(8)
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
  doc.setFontSize(8)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(fmtTelefono(cliente.telefono) || '—', MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
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
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 91,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 122,  w: 11,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 133,  w: 27,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 160,  w: 28,  align: 'right'  },
  ]
  const ROW_H_BASE = 6.0

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
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    const lineH = 4.0
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 2)

    let limitY = PAGE_H - 40 // Margen de seguridad estándar
    
    // BALANCEO INTELIGENTE: Si hay más de 20 items, repartimos entre páginas
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 130 // Reparto equitativo para ODC
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDes)
      // Redraw table header
      doc.setFillColor(60, 60, 60)
      doc.rect(MARGIN, y, CONTENT_W, 9, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
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

  // Notas Adicionales — se renderizan ancladas sobre el recuadro de forma de pago (ver más abajo)
  y += 4

  // Si es un doc grande y aún estamos en la pág 1, forzamos página para totales y chofer
  if (isLargeDoc && pageNum === 1) {
    doc.addPage()
    pageNum++
    y = drawHeader(doc, numDes)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Layout fijo desde el fondo: Chofer en footer, Totales encima
  // ══════════════════════════════════════════════════════════════════════════
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const tieneTransporte = !!transportista

  // Datos del chofer fijos al fondo de la página (footer)
  const CHOFER_H = 20
  const choferY = PAGE_H - MARGIN - CHOFER_H

  // Total 6mm más alto que antes (originalmente ~36mm offset, ahora 30mm)
  const totW = (monedaPDF === 'mixto' || monedaPDF === 'mixto_bcv') ? 90 : 75
  const totX = PAGE_W - MARGIN - totW
  const total = Number(despacho.total_usd || 0)
  const flete = Number(despacho.flete_usd || 0)
  const corte = Number(despacho.corte_usd || 0)
  const montoExento = flete + corte
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  
  // En orden de despacho ahora SIEMPRE se muestra el exento
  const subtotal = total - montoExento
  const totalFinal = total - descuentoTotal
  const hasExentoReal = montoExento > 0
  const hasFleteReal = flete > 0
  const hasDescuento = descuentoTotal > 0

  // Posicionar recuadro unificado fijo sobre el chofer
  // Si hay exento, el desglose ocupa 14mm (Subtotal + Exento), si no, 7mm (solo Subtotal)
  const desgloseH = (hasExentoReal ? 14 : 7) + (hasDescuento ? 7 : 0)
  const ty = choferY - 24 - desgloseH

  // Parsear formas de pago (JSON array o string legacy)
  let formasPagoArr = []
  const fpRaw = formaPago || despacho.forma_pago || ''
  try {
    const parsed = JSON.parse(fpRaw)
    if (Array.isArray(parsed)) formasPagoArr = parsed
  } catch {
    if (fpRaw) formasPagoArr = [{ metodo: fpRaw, monto: null }]
  }

  // Con un solo método de pago siempre mostrar el total real (incluye flete/corte)
  if (formasPagoArr.length === 1) {
    formasPagoArr[0].monto = totalFinal
  }

  // Notas Adicionales — ancladas 2mm sobre el recuadro de forma de pago
  if (despacho.notas?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const notasLineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    const notasH = 5 + notasLineas.length * 5
    const notasStartY = ty - 2 - notasH

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

  // Fila FORMA DE PAGO — solo los elegidos con checkbox y palomita
  const fpY = ty
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, fpY, CONTENT_W, 9, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', MARGIN + 3, fpY + 6)

  const checkSize = 3.5
  let cx = MARGIN + 38
  formasPagoArr.forEach(fp => {
    const nombre = (fp.metodo || '').toUpperCase()
    if (!nombre) return
    const boxY = fpY + 2.5
    // Checkbox
    doc.setDrawColor(80, 80, 80)
    doc.setLineWidth(0.3)
    doc.rect(cx, boxY, checkSize, checkSize, 'S')

    // Dibuja la palomita (check) si está aprobado
    if (despacho.aprobado_por_nombre) {
      doc.setLineWidth(0.6)
      doc.setDrawColor(30, 80, 160) // Color azul institucional (mismo que marca de agua de aprobación)
      doc.line(cx + 0.6, boxY + 1.8, cx + 1.6, boxY + 2.8)
      doc.line(cx + 1.6, boxY + 2.8, cx + 3.1, boxY + 0.5)
      doc.setLineWidth(0.3)
    }

    const monto = fp.monto != null && fp.monto !== '' ? ` $${Number(fp.monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
    const txt = nombre + monto
    // Label
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_DARK)
    doc.text(txt, cx + checkSize + 1.2, fpY + 6)
    cx += checkSize + 1.2 + doc.getTextWidth(txt) + 4
  })

  // Desglose Subtotal + Exento (si aplica) + Descuento
  let desY = fpY + 9
  
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.2)

  // Subtotal
  doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Subtotal', MARGIN + 4, desY + 5)
  doc.text(fmtTotal(subtotal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
  desY += 7

  if (hasExentoReal) {
    doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
    doc.text('Monto Exento', MARGIN + 4, desY + 5)
    doc.text(fmtTotal(montoExento, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
    desY += 7
  }

  if (hasDescuento) {
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(180, 100, 0)
    doc.text('Descuento', MARGIN + 4, desY + 5)
    doc.text('-' + fmtTotal(descuentoTotal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
  }

  // Barra oscura TOTAL (alineada con cuadrícula)
  const totTopY = fpY + 9 + desgloseH
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, totTopY, CONTENT_W, 10, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_WHITE)
  doc.text('Total:', MARGIN + 4, totTopY + 7)
  doc.text(fmtTotal(totalFinal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, totTopY + 7, { align: 'right' })



  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — fijo al fondo (footer)
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferY + 4)

  // Grid: fila 1 = 3 cols, fila 2 = 4 cols
  const ROW_H = 7
  const row1Y = choferY + 6
  const row2Y = row1Y + ROW_H
  const col3W = CONTENT_W / 3
  const col4W = CONTENT_W / 4
  const BLANK = ''
  const row1Fields = [
    { label: 'CHOFER', val: (transportista?.nombre || '').toUpperCase() },
    { label: 'C.I.', val: (transportista?.rif || '').toUpperCase() },
    { label: 'COLOR', val: (transportista?.color || '').toUpperCase() },
  ]
  const row2Fields = [
    { label: 'VEHÍCULO', val: (transportista?.vehiculo || '').toUpperCase() },
  ]
  row2Fields.push({ label: 'PLACA CHUTO', val: (transportista?.placa_chuto || '').toUpperCase() })
  row2Fields.push({ label: 'PLACA BATEA', val: (transportista?.placa_batea || '').toUpperCase() })
  if (!hasExentoReal) {
    row2Fields.push({ label: 'FLETE', val: '' })
  }
  function drawRow(fields, ry, colW) {
    fields.forEach((f, i) => {
      const fx = MARGIN + i * colW
      doc.setDrawColor(120, 120, 120)
      doc.setLineWidth(0.3)
      doc.rect(fx, ry, colW, ROW_H, 'S')
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
  drawRow(row1Fields, row1Y, col3W)
  drawRow(row2Fields, row2Y, !hasFleteReal ? col4W : col3W)

  // ── NO cuentas, NO slogan, NO condiciones ──

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const clienteNombreODC = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaODC = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `ODC_${numDes.replace(/ /g, '_')}_${clienteNombreODC}_${fechaODC}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
