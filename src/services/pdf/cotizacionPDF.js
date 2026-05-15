// src/services/pdf/cotizacionPDF.js
// Genera PDF profesional de Cotización — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_ACCENT, C_DARK, C_WHITE,
  CUENTAS_BANCARIAS,
  fmtFecha, fmtPrecio, fmtTotal, fmtTelefono,
  hexToRgb, drawWatermark, drawSimplifiedHeader,
  checkPage
} from './pdfShared'

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false, monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0 }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  // Factor BCV: cuántos dólares BCV equivale 1 USDT (ej: 1.30)
  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const logoData = await cargarLogo(config.logo_url)
  const rif = config.rif_negocio || 'J-50115913-0'

  const drawHeader = (doc, num) => {
    const HDR_H = 40
    doc.setFillColor(...C_PRIMARY)
    doc.rect(0, 0, PAGE_W, HDR_H, 'F')

    // Decoraciones: Cuadrícula de puntos
    const vColor = hexToRgb(cotizacion.vendedor?.color)
    doc.setFillColor(...vColor)
    for(let i = 0; i < 4; i++) {
      for(let j = 0; j < 6; j++) {
        doc.circle(MARGIN + i * 2.5, 4 + j * 2.5, 0.4, 'F')
      }
    }

    // Cuadro derecho con franjas diagonales "Hazard"
    const hazW = 40
    const hazX = PAGE_W - hazW
    doc.setFillColor(...C_DARK)
    doc.rect(hazX, 0, hazW, 14, 'F')
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_PRIMARY)
    for (let k = 0; k < 15; k++) {
      doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)
    }

    // Logo
    if (logoData) {
      try { doc.addImage(logoData, 'PNG', MARGIN + 12, 4, 32, 32) } catch (_) {}
    }

    // Títulos Negocio
    const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
    doc.setFont('times', 'bold')
    doc.setTextColor(...C_WHITE)
    doc.setFontSize(22)
    doc.text('CONSTRUACERO', textCenterX, 18, { align: 'center' })
    doc.setFontSize(14)
    doc.text('CARABOBO C.A.', textCenterX, 27, { align: 'center' })

    // "Cotización" + número
    doc.setFontSize(13)
    doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 10, { align: 'right' })
    doc.setFontSize(11)
    doc.text(num, PAGE_W - MARGIN, HDR_H - 4, { align: 'right' })

    return HDR_H + 6
  }


  const numDisplay = `Nº- ${String(cotizacion.numero).padStart(5, '0')}`
  let pageNum = 1

  y = drawHeader(doc, numDisplay)

  // ── Marca de agua central ──
  drawWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula con celdas
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = cotizacion.cliente || {}

  // Encabezado tipo "COTIZACIÓN:"
  const cotBarY = y - 4
  doc.setFillColor(248, 248, 248)
  doc.rect(MARGIN, cotBarY, CONTENT_W, 7, 'F')
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, cotBarY, CONTENT_W, 7, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C_DARK)
  doc.text('COTIZACIÓN:', MARGIN + 3, cotBarY + 5)
  y = cotBarY + 7

  const ROW_H_INFO = 6
  const halfW = CONTENT_W / 2
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  // Helper para dibujar celda con label + valor
  const drawCell = (x, cellY, w, label, val, opts = {}) => {
    doc.rect(x, cellY, w, ROW_H_INFO, 'S')
    if (opts.fill) {
      doc.setFillColor(240, 240, 240)
      doc.rect(x, cellY, w, ROW_H_INFO, 'F')
      doc.rect(x, cellY, w, ROW_H_INFO, 'S')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(`${label}:`, x + 2, cellY + 4.5)
    const lblW = doc.getTextWidth(`${label}: `)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text(String(val || '—'), x + 2 + lblW + 1, cellY + 4.8)
  }

  // Fila 1: Emisión (ancho completo)
  drawCell(MARGIN, y, CONTENT_W, 'Emisión', fmtFecha(cotizacion.creado_en))
  y += ROW_H_INFO

  // Fila 2: Cliente | R.I.F / Cédula
  drawCell(MARGIN, y, halfW, 'Cliente', (cliente.nombre || '').toUpperCase())
  drawCell(MARGIN + halfW, y, halfW, 'R.I.F / Cédula', cliente.rif_cedula)
  y += ROW_H_INFO

  // Fila 3: Teléfono | Correo
  drawCell(MARGIN, y, halfW, 'Teléfono', fmtTelefono(cliente.telefono))
  drawCell(MARGIN + halfW, y, halfW, 'Correo', cliente.email)
  y += ROW_H_INFO

  // Fila 4: Vendedor (ancho completo, fondo gris)
  const vendedorStr = (cotizacion.vendedor?.nombre?.toUpperCase() || '—') + (cotizacion.vendedor?.telefono ? ` — ${fmtTelefono(cotizacion.vendedor.telefono)}` : '')
  drawCell(MARGIN, y, CONTENT_W, 'Vendedor', vendedorStr, { fill: true })
  y += ROW_H_INFO

  // Fila 5: Dirección Fiscal (ancho completo) — multilínea si es larga
  const dirFiscal = [cliente.direccion, cliente.ciudad?.toUpperCase(), cliente.estado?.toUpperCase()].filter(Boolean).join(', ') || '—'
  {
    const dirLabel = 'Dirección Fiscal'
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const dirLblW = doc.getTextWidth(`${dirLabel}: `)
    const dirAvailW = CONTENT_W - 2 - dirLblW - 3 // margen izq + derecho
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    const dirLines = doc.splitTextToSize(String(dirFiscal), dirAvailW)
    const dirLineH = 4.5
    const dirCellH = Math.max(ROW_H_INFO, dirLines.length * dirLineH + 3)
    doc.setLineWidth(0.2)
    doc.setDrawColor(200, 200, 200)
    doc.rect(MARGIN, y, CONTENT_W, dirCellH, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(`${dirLabel}:`, MARGIN + 2, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    dirLines.forEach((line, idx) => {
      doc.text(line, MARGIN + 2 + dirLblW + 1, y + 4.8 + idx * dirLineH)
    })
    y += dirCellH
  }

  y += 3

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : monedaPDF === 'bcv' ? 'PRECIO BCV' : monedaPDF === 'mixto_bcv' ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : monedaPDF === 'bcv' ? 'TOTAL BCV'  : monedaPDF === 'mixto_bcv' ? 'TOTAL BCV' : 'TOTAL'
  // Anchos fijos que funcionan para cualquier moneda
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 10,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 10,   w: 16,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 26,   w: 98,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 124,  w: 9,   align: 'center' },
    { label: precioLabel,    x: MARGIN + 133,  w: 27,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 160,  w: 28,  align: 'right'  },
  ]
  const ROW_H_BASE = 6.0


  // Cabecera tabla
  doc.setFillColor(...C_ACCENT)
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

  const itemsToRender = [...items]
  const fleRef = Number(cotizacion.costo_envio_usd || 0)
  const corRef = Number(cotizacion.corte_usd || 0)
  if (fleRef > 0) itemsToRender.push({ codigo_snap: 'FTL1005632', nombre_snap: 'SERVICIO DE FLETE', unidad_snap: 'UND', precio_unit_usd: fleRef, total_linea_usd: fleRef, isExento: true })
  if (corRef > 0) itemsToRender.push({ codigo_snap: 'CRT1254698', nombre_snap: 'SERVICIO DE CORTE', unidad_snap: 'UND', precio_unit_usd: corRef, total_linea_usd: corRef, isExento: true })

  const isLargeDoc = itemsToRender.length >= 23

  itemsToRender.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const descLines = doc.splitTextToSize((item.nombre_snap || '').toUpperCase(), COLS[2].w - 4)
    const lineH = 4.0
    const rowH = Math.max(ROW_H_BASE, descLines.length * lineH + 2)

    let limitY = PAGE_H - 40 // Margen de seguridad para el footer
    
    // BALANCEO INTELIGENTE: 
    // Si el documento tiene más de 20 items, forzamos un corte temprano en la pág 1
    // para que la pág 2 no quede vacía y el documento se vea equilibrado.
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 110 // Deja espacio para que ~12-15 items pasen a la siguiente página
    }
    
    if (y + rowH > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDisplay)
      // Redraw table header
      doc.setFillColor(...C_ACCENT)
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
    if (item.isExento) {
      doc.setFillColor(245, 250, 255)
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'FD')
    } else {
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'S')
    }
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + rowH) })

    const midY = y + rowH / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.setFontSize(6.5)
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    doc.setFontSize(9)
    // Render all lines of the description
    const descStartY = y + (rowH - descLines.length * lineH) / 2 + lineH
    descLines.forEach((line, idx) => {
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })
    // UNID: auto-shrink si el texto no cabe (ej. "ROLLO")
    ;(() => {
      const unidText = (item.unidad_snap || '-').toUpperCase()
      const maxW = COLS[3].w - 1
      let fs = 9
      doc.setFont('helvetica', 'normal')
      while (fs > 6) { doc.setFontSize(fs); if (doc.getTextWidth(unidText) <= maxW) break; fs -= 0.5 }
      doc.text(unidText, COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })
      doc.setFontSize(9)
    })()

    const tasaEfectiva = tasa > 0 ? tasa : Number(cotizacion.tasa_bcv_snapshot || 0)
    const precioText = fmtPrecio(item.precio_unit_usd, monedaPDF, tasaEfectiva, factorBcv)
    const totalText = fmtPrecio(item.total_linea_usd, monedaPDF, tasaEfectiva, factorBcv)

    // Auto-reducir fuente si el precio no cabe en la columna
    const fitText = (text, col, baseFontSize, bold) => {
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

    fitText(precioText, COLS[4], 10.5, false)
    fitText(totalText, COLS[5], 10.5, true)
    doc.setFontSize(9)

    y += rowH
  })

  // 4. CONDICIONES + TOTALES + NOTAS
  // Calculamos la altura de cada bloque para ubicarlos anclados al fondo
  const bTotW = (monedaPDF === 'mixto' || monedaPDF === 'mixto_bcv') ? 90 : 75
  const bTotX = PAGE_W - MARGIN - bTotW
  const bLeftW = bTotX - MARGIN - 5
  const bConds = ['Precios Sujetos a cambios sin previo aviso.', 'El cliente se encarga de descargar la mercancía.']
  const bCP = 2, bCTH = 6, bCLH = 5.0
  const bBoxH = bCTH + bConds.length * bCLH + bCP * 2 + 1 // Altura bloque Condiciones
  
  const bSub = Number(cotizacion.subtotal_usd || 0)
  const bDesc = Number(cotizacion.descuento_usd || 0)
  const bTot = Number(cotizacion.total_usd || 0)
  const bTasa = tasa > 0 ? tasa : Number(cotizacion.tasa_bcv_snapshot || 0)
  const bExento = Number(cotizacion.costo_envio_usd || 0) + Number(cotizacion.corte_usd || 0)
  
  const bLines = [{ label: 'Subtotal:', val: fmtPrecio(bSub, monedaPDF, bTasa, factorBcv) }]
  if (bDesc > 0) bLines.push({ label: 'Descuento:', val: '-' + fmtPrecio(bDesc, monedaPDF, bTasa, factorBcv), color: [220, 38, 38] })
  if (bExento > 0) bLines.push({ label: 'Exento:', val: fmtPrecio(bExento, monedaPDF, bTasa, factorBcv), color: [50, 100, 180] })
  
  const bLH = 7
  const bTH = (bLines.length + 1) * bLH + 4
  const totalsTotalH = bTH + 10 - 2 // La caja redondeada + la caja azul de Total

  const blockH = Math.max(bBoxH, totalsTotalH)

  let notasH = 0
  let notasLineas = []
  if (cotizacion.notas_cliente?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    notasLineas = doc.splitTextToSize(cotizacion.notas_cliente.trim(), bLeftW)
    notasH = 5 + notasLineas.length * 5 // 5mm margen + lineas
  }

  // Verificamos si todo esto cabe
  const totalNeededH = (notasH > 0 ? notasH + 2 : 0) + blockH + 2 + 8 // 8 = altura slogan
  y = checkPage(doc, y, totalNeededH, (d) => drawSimplifiedHeader(d, logoData, config, `Cotización (Cont.) ${numDisplay}`))

  // ── Slogan — fijo 10mm sobre el footer (PAGE_H - 35) ──
  const sloganY = PAGE_H - 35
  const topOfSlogan = sloganY - 6 // ~ top de 16pt

  // Bloque Totales/Condiciones -> ANCLADO 2mm por encima del slogan
  const blockFinalY = topOfSlogan - 2 - blockH
  
  // Si por alguna razón la tabla llega súper abajo, respetamos y para no solapar la tabla
  const finalY = Math.max(y + 6 + (notasH > 0 ? notasH + 2 : 0), blockFinalY)

  // DIBUJAR NOTAS (2mm sobre Condiciones)
  if (notasH > 0) {
    const notasStartY = finalY - 2 - notasH
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_ACCENT)
    doc.text('NOTAS:', MARGIN, notasStartY + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    notasLineas.forEach((lin, i) => {
      doc.text(lin, MARGIN, notasStartY + 4 + 5 + i * 5)
    })
  }

  // DIBUJAR CONDICIONES
  doc.setFillColor(230, 242, 255); doc.setDrawColor(...C_ACCENT); doc.setLineWidth(0.5)
  doc.roundedRect(MARGIN, finalY, bLeftW, bBoxH, 1.5, 1.5, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C_PRIMARY)
  doc.text('CONDICIONES GENERALES:', MARGIN + bCP, finalY + bCP + 4.5)
  doc.setDrawColor(...C_ACCENT); doc.setLineWidth(0.3)
  doc.line(MARGIN + bCP, finalY + bCP + bCTH, MARGIN + bLeftW - bCP, finalY + bCP + bCTH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C_DARK)
  let bCY = finalY + bCP + bCTH + 4.5
  bConds.forEach(c => { doc.text('\u2022 ' + c, MARGIN + bCP, bCY); bCY += bCLH })

  // DIBUJAR TOTALES
  doc.setFillColor(250, 250, 250); doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3)
  doc.roundedRect(bTotX, finalY, bTotW, bTH, 1.5, 1.5, 'FD')
  let bTy = finalY + 5
  bLines.forEach(l => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...(l.color || C_DARK))
    doc.text(l.label, bTotX + 4, bTy); doc.text(l.val, bTotX + bTotW - 4, bTy, { align: 'right' })
    bTy += bLH
  })
  doc.setFillColor(...C_ACCENT); doc.rect(bTotX, bTy - 2, bTotW, 10, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...C_WHITE)
  doc.text('Total:', bTotX + 4, bTy + 5)
  doc.text(fmtTotal(bTot, monedaPDF, bTasa, factorBcv), bTotX + bTotW - 4, bTy + 5, { align: 'right' })

  // DIBUJAR SLOGAN
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(16)
  doc.setTextColor(...C_DARK)
  doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })



  // ══════════════════════════════════════════════════════════════════════════
  // 5. FOOTER CON FRANJA DE PRECAUCIÓN
  // ══════════════════════════════════════════════════════════════════════════
  // Footer en páginas finales
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H
    {

    // Franja negra superior con las diagonales
    const hazardY = ph - 30
    doc.setFillColor(...C_DARK)
    doc.rect(0, hazardY, PAGE_W, 4, 'F')

    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.8)
    for(let k = 1; k < 20; k++) {
      doc.line(k * 4, hazardY, k * 4 - 3, hazardY + 4)
      doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 3, hazardY + 4)
    }

    // Franja principal azul
    doc.setFillColor(...C_PRIMARY)
    doc.rect(0, ph - 29, PAGE_W, 29, 'F')

    // ── Icono pin ubicación + dirección ──
    doc.setFillColor(...C_WHITE)
    doc.setDrawColor(...C_WHITE)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_WHITE)

    const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
    const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

    // Pin a la izquierda de addr1
    const addr1W = doc.getTextWidth(addr1)
    const addr1X = PAGE_W/2 - addr1W/2
    const pinX = addr1X - 4
    const pinY = ph - 21
    doc.circle(pinX, pinY - 0.3, 1.4, 'F')
    doc.triangle(pinX - 1.2, pinY, pinX + 1.2, pinY, pinX, pinY + 2.4, 'F')

    doc.text(addr1, PAGE_W/2, ph - 19.5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W/2, ph - 15, { align: 'center' })

    const tel = fmtTelefono(config.telefono_negocio) || ''
    const email = config.email_negocio || ''
    if (tel || email) {
      const parts = []
      if (tel && tel !== '—') parts.push({ icon: 'phone', text: tel })
      if (email) parts.push({ icon: 'mail', text: email })

      // Calcular ancho total para centrar
      doc.setFont('helvetica', 'normal')
      const gap = 12
      let totalW = 0
      parts.forEach((p, i) => {
        totalW += 5 + doc.getTextWidth(p.text)
        if (i < parts.length - 1) totalW += gap
      })

      let cx = PAGE_W/2 - totalW/2
      const cy = ph - 7

      parts.forEach((p, i) => {
        doc.setFillColor(...C_WHITE)
        doc.setDrawColor(...C_WHITE)
        if (p.icon === 'phone') {
          // Icono teléfono: rectángulo redondeado
          doc.setLineWidth(0.4)
          doc.roundedRect(cx, cy - 2.2, 1.6, 2.8, 0.3, 0.3, 'S')
          doc.setLineWidth(0.3)
          doc.line(cx + 0.3, cy + 0.2, cx + 1.3, cy + 0.2)
        } else {
          // Icono sobre: rectángulo + V
          doc.setLineWidth(0.3)
          doc.rect(cx, cy - 1.8, 2.4, 1.8, 'S')
          doc.line(cx, cy - 1.8, cx + 1.2, cy - 0.6)
          doc.line(cx + 2.4, cy - 1.8, cx + 1.2, cy - 0.6)
        }
        doc.setTextColor(...C_WHITE)
        doc.text(p.text, cx + 4, cy)
        cx += 5 + doc.getTextWidth(p.text) + gap
      })
    }
    } // fin bloque footer inner
  } // fin for páginas footer

  const clienteNombreCot = (cotizacion.cliente?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaCot = (cotizacion.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `${numDisplay.replace(/\s+/g, '_')}_${clienteNombreCot}_${fechaCot}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
