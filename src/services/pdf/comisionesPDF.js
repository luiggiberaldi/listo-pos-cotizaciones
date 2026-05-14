// src/services/pdf/comisionesPDF.js
// Genera PDF profesional de Reporte de Comisiones — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_GRAY,
  fmtUsd, fmtBs, fmtFecha, fmtFechaCorta,
  hexToRgb, drawWatermark, checkPage,
} from './pdfShared'

// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
export async function generarComisionesPDF({ comisiones, vendedor = null, resumen = null, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)

  // NORMALIZAR: unificar naming antes de procesar (soporte para Worker API y RPC)
  function normalizarComision(c) {
    const rawEstado = (c.estado || c.estado_comision || 'pendiente').toLowerCase()
    
    return {
      ...c,
      // Totales (Prioridad a RPC si existen, luego Worker, luego default)
      totalcomision: Number(c.total_com || c.totalcomision || c.despacho_comision_total || 0),
      comisioncabilla: Number(c.comisioncabilla || 0),
      comisionotros: Number(c.comisionotros || 0),
      // Valor del item (si aplica)
      valor: Number(c.total || 0),
      pct: Number(c.comision_pct || c.pct || 0),
      // Producto
      codigo: c.codigo || '',
      descripcion: (c.descripcion || c.nombre_snap || '').toUpperCase(),
      // Número de despacho
      despachonumero: c.despacho_numero || c.despachonumero || c.despacho?.numero || '---',
      montopagado: Number(c.despacho_comision_liberada || c.montopagado || 0),
      // Tasa
      tasa_snapshot: Number(
        c.tasa ||
        c.tasa_snapshot || 
        c.despacho?.tasa_snapshot || 
        c.cotizacion?.tasa_bcv_snapshot || 
        0
      ),
      // Mapeo de estados: 'pagada' es el único estado que suma al pagado, resto son pendientes
      estado: rawEstado,
      creadoen: c.fecha || c.creadoen || new Date().toISOString()
    }
  }

  const comisionesNorm = (comisiones || []).map(normalizarComision)
  // Si hay descripciones significativas, es el reporte detallado
  const esDetallado = comisionesNorm.some(c => c.descripcion && c.descripcion !== '---')

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 36
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Hazard derecho
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
    try { doc.addImage(logoData, 'PNG', MARGIN + 8, 3, 30, 30) } catch (_) {}
  }

  // Título
  const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
  doc.setFont('times', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C_WHITE)
  let n1 = config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.'
  if (n1.trim().toUpperCase() === 'PRUEBA' || n1.trim() === '') n1 = 'CONSTRUACERO CARABOBO C.A.'
  const nombreNeg = n1.split(' ')
  doc.text((nombreNeg[0] || '').toUpperCase(), textCenterX, 16, { align: 'center' })
  if (nombreNeg.length > 1) {
    doc.setFontSize(12)
    doc.text(nombreNeg.slice(1).join(' ').toUpperCase(), textCenterX, 23, { align: 'center' })
  }

  // Subtítulo
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Reporte de Comisiones', PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtFecha(new Date().toISOString(), 'short-month'), PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  y = HDR_H + 6

  // Watermark
  drawWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. INFO VENDEDOR (si aplica)
  // ══════════════════════════════════════════════════════════════════════════
  if (vendedor) {
    const vColor = hexToRgb(vendedor.color)
    doc.setFillColor(vColor[0], vColor[1], vColor[2])
    doc.roundedRect(MARGIN, y, 4, 10, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...C_DARK)
    doc.text(vendedor.nombre, MARGIN + 7, y + 7)
    y += 14
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. RESUMEN
  // ══════════════════════════════════════════════════════════════════════════
  const pendientes = comisionesNorm.filter(c => c.estado !== 'pagada')
  const pagadas = comisionesNorm.filter(c => c.estado === 'pagada')
  const totalPendiente = pendientes.reduce((s, c) => s + c.totalcomision, 0)
  const totalPagado = pagadas.reduce((s, c) => s + c.montopagado, 0)
  const totalGeneral = totalPendiente + totalPagado

  // Cuadro resumen
  const boxH = 18
  const boxW = CONTENT_W / 3
  const boxes = [
    { label: 'Generado Histórico', value: fmtUsd(totalGeneral), count: `${comisionesNorm.length} comisiones`, color: C_PRIMARY },
    { label: 'Total Pagado', value: fmtUsd(totalPagado), count: `${pagadas.length} pagadas`, color: C_EMERALD },
    { label: 'Saldo Pendiente', value: fmtUsd(totalPendiente), count: `${pendientes.length} por pagar`, color: C_AMBER },
  ]

  boxes.forEach((box, i) => {
    const bx = MARGIN + i * boxW
    doc.setFillColor(box.color[0], box.color[1], box.color[2])
    doc.roundedRect(bx + 1, y, boxW - 2, boxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_WHITE)
    doc.text(box.label, bx + 4, y + 5.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(box.value, bx + 4, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(box.count, bx + 4, y + 16)
  })

  y += boxH + 8

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TABLA DE COMISIONES
  // ══════════════════════════════════════════════════════════════════════════
  // Header de la tabla
  let cols = []
  
  if (esDetallado) {
    cols = vendedor
      ? [
          { label: 'Fecha', x: MARGIN, w: 16 },
          { label: 'Nº Doc', x: MARGIN + 16, w: 12 },
          { label: 'Producto / Descripción', x: MARGIN + 28, w: 55 },
          { label: 'Valor ($)', x: MARGIN + 83, w: 15, align: 'right' },
          { label: '%', x: MARGIN + 98, w: 8, align: 'right' },
          { label: 'Com ($)', x: MARGIN + 106, w: 15, align: 'right' },
          { label: 'Tasa (Bs)', x: MARGIN + 121, w: 15, align: 'right' },
          { label: 'Com (Bs)', x: MARGIN + 136, w: 18, align: 'right' },
          { label: 'Estado', x: MARGIN + 154, w: 18, align: 'center' },
        ]
      : [
          { label: 'Vendedor', x: MARGIN, w: 18 },
          { label: 'Nº Doc', x: MARGIN + 18, w: 12 },
          { label: 'Producto / Descripción', x: MARGIN + 30, w: 50 },
          { label: 'Valor ($)', x: MARGIN + 80, w: 15, align: 'right' },
          { label: '%', x: MARGIN + 95, w: 8, align: 'right' },
          { label: 'Com ($)', x: MARGIN + 103, w: 15, align: 'right' },
          { label: 'Tasa (Bs)', x: MARGIN + 118, w: 15, align: 'right' },
          { label: 'Com (Bs)', x: MARGIN + 133, w: 18, align: 'right' },
          { label: 'Estado', x: MARGIN + 151, w: 18, align: 'center' },
        ]
  } else {
    cols = vendedor
      ? [
          { label: 'Fecha', x: MARGIN, w: 18 },
          { label: 'Nº Doc', x: MARGIN + 18, w: 15 },
          { label: 'Cabilla ($)', x: MARGIN + 33, w: 22, align: 'right' },
          { label: 'Otros ($)', x: MARGIN + 55, w: 22, align: 'right' },
          { label: 'Total Com ($)', x: MARGIN + 77, w: 25, align: 'right' },
          { label: 'Abonado ($)', x: MARGIN + 102, w: 22, align: 'right' },
          { label: 'Tasa (Bs)', x: MARGIN + 124, w: 18, align: 'right' },
          { label: 'Com. (Bs)', x: MARGIN + 142, w: 25, align: 'right' },
          { label: 'Estado', x: MARGIN + 167, w: 25, align: 'center' },
        ]
      : [
          { label: 'Vendedor', x: MARGIN, w: 25 },
          { label: 'Fecha', x: MARGIN + 25, w: 18 },
          { label: 'Nº Doc', x: MARGIN + 43, w: 15 },
          { label: 'Total Com ($)', x: MARGIN + 58, w: 25, align: 'right' },
          { label: 'Abonado ($)', x: MARGIN + 83, w: 22, align: 'right' },
          { label: 'Tasa (Bs)', x: MARGIN + 105, w: 18, align: 'right' },
          { label: 'Com. (Bs)', x: MARGIN + 123, w: 25, align: 'right' },
          { label: 'Estado', x: MARGIN + 148, w: 25, align: 'center' },
        ]
  }

  function drawTableHeader(doc, yPos) {
    // Solo líneas sutiles, sin fondo gris pesado
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos, MARGIN + CONTENT_W, yPos)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    cols.forEach(col => {
      const align = col.align || 'left'
      let posX = col.x + 1
      if (align === 'right') posX = col.x + col.w - 2
      if (align === 'center') posX = col.x + (col.w / 2)
      doc.text(col.label, posX, yPos + 5, { align })
    })
    return yPos + 9
  }

  y = drawTableHeader(doc, y)

  // Variables para totalizar al final
  let sumCabillaUsd = 0
  let sumOtrosUsd = 0
  let sumTotalUsd = 0
  let sumAbonadoUsd = 0
  let sumTotalBs = 0

  // Filas
  comisionesNorm.forEach((c, idx) => {
    const rowH = 6
    y = checkPage(doc, y, rowH + 2)

    if (y < MARGIN + 12) {
      y = drawTableHeader(doc, y)
    }

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)

    const tasa = c.tasa_snapshot
    const comBs = tasa > 0 ? c.totalcomision * tasa : 0
    const esPend = c.estado !== 'pagada'
    const textoEstado = esPend ? 'Pendiente' : 'Pagada'

    // Sumar a totales
    sumCabillaUsd += c.comisioncabilla
    sumOtrosUsd += c.comisionotros
    sumTotalUsd += c.totalcomision
    sumAbonadoUsd += c.montopagado
    sumTotalBs += comBs

    if (esDetallado) {
      if (vendedor) {
        doc.text(fmtFechaCorta(c.creadoen), cols[0].x + 1, y + 3)
        doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3)
        
        doc.setFontSize(5.5)
        const desc = `${c.codigo ? '['+c.codigo+'] ' : ''}${c.descripcion || '—'}`
        const splitDesc = doc.splitTextToSize(desc, cols[2].w - 2)
        doc.text(splitDesc, cols[2].x + 1, y + 2.5)
        doc.setFontSize(6.5)

        doc.text(fmtUsd(c.valor), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' })
        doc.text(`${c.pct}%`, cols[4].x + cols[4].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(c.totalcomision), cols[5].x + cols[5].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'normal')
        doc.text(`Bs ${tasa}`, cols[6].x + cols[6].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtBs(comBs), cols[7].x + cols[7].w - 2, y + 3, { align: 'right' })

        // Estado
        doc.setFontSize(6)
        doc.setTextColor(...(esPend ? C_AMBER : C_EMERALD))
        doc.text(textoEstado, cols[8].x + (cols[8].w / 2), y + 3, { align: 'center' })
        doc.setFontSize(6.5)
      } else {
        doc.setFont('helvetica', 'bold')
        const vName = (c.vendedornombre || c.vendedor?.nombre || '—').split(' ').slice(0, 2).join(' ')
        doc.text(vName, cols[0].x + 1, y + 3)
        
        doc.setFont('helvetica', 'normal')
        doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3)

        doc.setFontSize(5.5)
        const desc = `${c.codigo ? '['+c.codigo+'] ' : ''}${c.descripcion || '—'}`
        const splitDesc = doc.splitTextToSize(desc, cols[2].w - 2)
        doc.text(splitDesc, cols[2].x + 1, y + 2.5)
        doc.setFontSize(6.5)

        doc.text(fmtUsd(c.valor), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' })
        doc.text(`${c.pct}%`, cols[4].x + cols[4].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(c.totalcomision), cols[5].x + cols[5].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'normal')
        doc.text(`Bs ${tasa}`, cols[6].x + cols[6].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtBs(comBs), cols[7].x + cols[7].w - 2, y + 3, { align: 'right' })

        doc.setFontSize(6)
        doc.setTextColor(...(esPend ? C_AMBER : C_EMERALD))
        doc.text(textoEstado, cols[8].x + (cols[8].w / 2), y + 3, { align: 'center' })
        doc.setFontSize(6.5)
      }
    } else {
      if (vendedor) {
        doc.text(fmtFechaCorta(c.creadoen), cols[0].x + 1, y + 3)
        doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3)
        
        doc.text(fmtUsd(c.comisioncabilla), cols[2].x + cols[2].w - 2, y + 3, { align: 'right' })
        doc.text(fmtUsd(c.comisionotros), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(c.totalcomision), cols[4].x + cols[4].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'normal')
        doc.text(c.montopagado > 0 ? fmtUsd(c.montopagado) : '—', cols[5].x + cols[5].w - 2, y + 3, { align: 'right' })
        
        doc.text(`Bs ${tasa}`, cols[6].x + cols[6].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtBs(comBs), cols[7].x + cols[7].w - 2, y + 3, { align: 'right' })

        // Estado
        doc.setFontSize(6)
        doc.setTextColor(...(esPend ? C_AMBER : C_EMERALD))
        doc.text(textoEstado, cols[8].x + (cols[8].w / 2), y + 3, { align: 'center' })
        doc.setFontSize(6.5)
      } else {
        // General
        doc.setFont('helvetica', 'bold')
        const vName = (c.vendedornombre || c.vendedor?.nombre || '—').split(' ').slice(0, 2).join(' ')
        doc.text(vName, cols[0].x + 1, y + 3)
        
        doc.setFont('helvetica', 'normal')
        doc.text(fmtFechaCorta(c.creadoen), cols[1].x + 1, y + 3)
        doc.text(`#${c.despachonumero}`, cols[2].x + 1, y + 3)

        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(c.totalcomision), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'normal')
        doc.text(c.montopagado > 0 ? fmtUsd(c.montopagado) : '—', cols[4].x + cols[4].w - 2, y + 3, { align: 'right' })
        
        doc.text(`Bs ${tasa}`, cols[5].x + cols[5].w - 2, y + 3, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.text(fmtBs(comBs), cols[6].x + cols[6].w - 2, y + 3, { align: 'right' })

        // Estado
        doc.setFontSize(6)
        doc.setTextColor(...(esPend ? C_AMBER : C_EMERALD))
        doc.text(textoEstado, cols[7].x + (cols[7].w / 2), y + 3, { align: 'center' })
        doc.setFontSize(6.5)
      }
    }

    y += rowH
  })

  // Línea final y TOTALIZACIÓN
  y = checkPage(doc, y, 10)
  doc.setDrawColor(210, 215, 225)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 4

  // Fila de gran total
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('TOTALES:', MARGIN + 2, y + 1)
  
  if (esDetallado) {
    if (vendedor) {
      doc.text(fmtUsd(sumTotalUsd), cols[5].x + cols[5].w - 2, y + 1, { align: 'right' })
      doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1, { align: 'right' })
    } else {
      doc.text(fmtUsd(sumTotalUsd), cols[5].x + cols[5].w - 2, y + 1, { align: 'right' })
      doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1, { align: 'right' })
    }
  } else {
    if (vendedor) {
      doc.text(fmtUsd(sumCabillaUsd), cols[2].x + cols[2].w - 2, y + 1, { align: 'right' })
      doc.text(fmtUsd(sumOtrosUsd), cols[3].x + cols[3].w - 2, y + 1, { align: 'right' })
      doc.text(fmtUsd(sumTotalUsd), cols[4].x + cols[4].w - 2, y + 1, { align: 'right' })
      doc.text(fmtUsd(sumAbonadoUsd), cols[5].x + cols[5].w - 2, y + 1, { align: 'right' })
      doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1, { align: 'right' })
    } else {
      doc.text(fmtUsd(sumTotalUsd), cols[3].x + cols[3].w - 2, y + 1, { align: 'right' })
      doc.text(fmtUsd(sumAbonadoUsd), cols[4].x + cols[4].w - 2, y + 1, { align: 'right' })
      doc.text(fmtBs(sumTotalBs), cols[6].x + cols[6].w - 2, y + 1, { align: 'right' })
    }
  }
  
  y += 6

  // ══════════════════════════════════════════════════════════════════════════
  // 6. RESUMEN POR VENDEDOR (si es reporte general)
  // ══════════════════════════════════════════════════════════════════════════
  if (!vendedor) {
    const porVendedor = {}
    comisionesNorm.forEach(c => {
      const vName = c.vendedornombre || c.vendedor?.nombre || 'Sin Asesor'
      if (!porVendedor[vName]) {
        porVendedor[vName] = {
          nombre: vName,
          color: c.vendedorcolor || c.vendedor?.color || '#1B365D',
          total: 0, pendiente: 0, pagado: 0, count: 0,
        }
      }
      const v = porVendedor[vName]

      const monto = c.totalcomision
      v.total += monto
      v.count++
      if (c.estado !== 'pagada') v.pendiente += monto
      else v.pagado += monto
    })

    const vendedoresList = Object.values(porVendedor).sort((a, b) => b.total - a.total)
    y = checkPage(doc, y, 15 + vendedoresList.length * 7)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Resumen por Vendedor', MARGIN, y + 4)
    y += 8

    // Mini tabla
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Vendedor', MARGIN + 2, y + 4)
    doc.text('Comisiones', MARGIN + 50, y + 4)
    doc.text('Pendiente', MARGIN + 80, y + 4)
    doc.text('Pagado', MARGIN + 115, y + 4)
    doc.text('Total', MARGIN + 148, y + 4)
    y += 8

    vendedoresList.forEach((v, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }

      const vColor = hexToRgb(v.color)
      doc.setFillColor(vColor[0], vColor[1], vColor[2])
      doc.circle(MARGIN + 3, y + 2, 1.5, 'F')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(v.nombre, MARGIN + 7, y + 3)

      doc.setFont('helvetica', 'normal')
      doc.text(String(v.count), MARGIN + 55, y + 3)
      doc.setTextColor(...C_AMBER)
      doc.text(fmtUsd(v.pendiente), MARGIN + 80, y + 3)
      doc.setTextColor(...C_EMERALD)
      doc.text(fmtUsd(v.pagado), MARGIN + 115, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...C_DARK)
      doc.text(fmtUsd(v.total), MARGIN + 148, y + 3)
      y += 6
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    // Línea footer
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    // Texto
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    let fn1 = config.nombre_negocio || 'Construacero Carabobo C.A.'
    if (fn1.trim().toUpperCase() === 'PRUEBA' || fn1.trim() === '') fn1 = 'Construacero Carabobo C.A.'
    doc.text(fn1, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }

  // Guardar
  const titulo = vendedor
    ? `Comisiones_${vendedor.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`
    : `Comisiones_General_${new Date().toISOString().slice(0, 10)}`
  doc.save(`${titulo}.pdf`)
}

// ─── Generar Reporte de Ventas PDF ───────────────────────────────────────────
export async function generarReporteVentasPDF({ reporte, rango, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 36
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  const hazW = 40
  const hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_PRIMARY)
  for (let k = 0; k < 15; k++) {
    doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)
  }

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 8, 3, 30, 30) } catch (_) {}
  }

  const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
  doc.setFont('times', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C_WHITE)
  let n2 = config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.'
  if (n2.trim().toUpperCase() === 'PRUEBA' || n2.trim() === '') n2 = 'CONSTRUACERO CARABOBO C.A.'
  const nombreNeg2 = n2.split(' ')
  doc.text((nombreNeg2[0] || '').toUpperCase(), textCenterX, 16, { align: 'center' })
  if (nombreNeg2.length > 1) {
    doc.setFontSize(12)
    doc.text(nombreNeg2.slice(1).join(' ').toUpperCase(), textCenterX, 23, { align: 'center' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Reporte de Ventas', PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`${rango.from} — ${rango.to}`, PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  y = HDR_H + 6

  // Watermark
  drawWatermark(doc)

  const kpis = reporte.kpis || {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2. KPIs
  // ══════════════════════════════════════════════════════════════════════════
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 16
  const kpiData = [
    { label: 'Ventas Totales', value: fmtUsd(kpis.totalVentas) },
    { label: 'Despachos', value: String(kpis.numDespachos || 0) },
    { label: 'Ticket Promedio', value: fmtUsd(kpis.ticketPromedio) },
    { label: 'Comisiones', value: fmtUsd(kpis.totalComisiones) },
  ]

  kpiData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    doc.setFillColor(...C_PRIMARY)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_WHITE)
    doc.text(kpi.label, bx + 3, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(kpi.value, bx + 3, y + 12.5)
  })
  y += kpiBoxH + 8

  // ══════════════════════════════════════════════════════════════════════════
  // 3. POR VENDEDOR
  // ══════════════════════════════════════════════════════════════════════════
  const porVendedor = reporte.porVendedor || []
  if (porVendedor.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Ventas por Vendedor', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Vendedor', MARGIN + 2, y + 4)
    doc.text('Despachos', MARGIN + 55, y + 4)
    doc.text('Ventas USD', MARGIN + 85, y + 4)
    doc.text('Comisiones', MARGIN + 125, y + 4)
    y += 8

    porVendedor.forEach((v, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      if (v.vendedorColor) {
        const vc = hexToRgb(v.vendedorColor)
        doc.setFillColor(vc[0], vc[1], vc[2])
        doc.circle(MARGIN + 3, y + 2, 1.5, 'F')
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(v.vendedor || '—', MARGIN + 7, y + 3)
      doc.setFont('helvetica', 'normal')
      doc.text(String(v.count || 0), MARGIN + 58, y + 3)
      doc.text(fmtUsd(v.totalUsd), MARGIN + 85, y + 3)
      doc.text(fmtUsd(v.comision), MARGIN + 125, y + 3)
      y += 6
    })
    y += 6
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. POR CLIENTE (top 10)
  // ══════════════════════════════════════════════════════════════════════════
  const porCliente = reporte.porCliente || []
  if (porCliente.length > 0) {
    y = checkPage(doc, y, 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Top Clientes', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Cliente', MARGIN + 2, y + 4)
    doc.text('Compras', MARGIN + 90, y + 4)
    doc.text('Total USD', MARGIN + 125, y + 4)
    y += 8

    porCliente.slice(0, 10).forEach((c, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text((c.cliente || '—').substring(0, 40), MARGIN + 2, y + 3)
      doc.text(String(c.count || 0), MARGIN + 95, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(c.totalUsd), MARGIN + 125, y + 3)
      y += 6
    })
    y += 6
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. POR CATEGORÍA (con barras visuales)
  // ══════════════════════════════════════════════════════════════════════════
  const porCategoria = reporte.porCategoria || []
  if (porCategoria.length > 0) {
    y = checkPage(doc, y, 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Ventas por Categoría', MARGIN, y + 4)
    y += 8

    const catTotal = porCategoria.reduce((s, c) => s + c.totalUsd, 0)
    porCategoria.forEach((cat, idx) => {
      y = checkPage(doc, y, 10)
      const pct = catTotal > 0 ? ((cat.totalUsd / catTotal) * 100).toFixed(1) : '0.0'
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(`${(cat.categoria || '—').substring(0, 25)} (${cat.unidades || 0} uds.)`, MARGIN + 2, y + 3)
      doc.text(`${pct}%`, MARGIN + 80, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(cat.totalUsd), MARGIN + 100, y + 3)

      // Mini barra
      const barX = MARGIN + 130
      const barW = CONTENT_W - 130
      doc.setFillColor(230, 233, 240)
      doc.roundedRect(barX, y, barW, 3, 1, 1, 'F')
      const fillW = barW * (Number(pct) / 100)
      if (fillW > 0) {
        doc.setFillColor(...C_PRIMARY)
        doc.roundedRect(barX, y, Math.max(fillW, 2), 3, 1, 1, 'F')
      }
      y += 7
    })
    y += 4
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FORMAS DE PAGO
  // ══════════════════════════════════════════════════════════════════════════
  const porFormaPago = reporte.porFormaPago || []
  if (porFormaPago.length > 0) {
    y = checkPage(doc, y, 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Formas de Pago', MARGIN, y + 4)
    y += 8

    const fpTotal = porFormaPago.reduce((s, fp) => s + fp.totalUsd, 0)
    porFormaPago.forEach((fp, idx) => {
      y = checkPage(doc, y, 10)
      const pct = fpTotal > 0 ? ((fp.totalUsd / fpTotal) * 100).toFixed(1) : '0.0'
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(`${fp.formaPago} (${fp.count} desp.)`, MARGIN + 2, y + 3)
      doc.text(`${pct}%`, MARGIN + 80, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(fp.totalUsd), MARGIN + 100, y + 3)

      // Mini barra
      const barX = MARGIN + 130
      const barW = CONTENT_W - 130
      doc.setFillColor(230, 233, 240)
      doc.roundedRect(barX, y, barW, 3, 1, 1, 'F')
      const fillW = barW * (Number(pct) / 100)
      if (fillW > 0) {
        doc.setFillColor(...C_PRIMARY)
        doc.roundedRect(barX, y, Math.max(fillW, 2), 3, 1, 1, 'F')
      }
      y += 7
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    let fn2 = config.nombre_negocio || 'Construacero Carabobo C.A.'
    if (fn2.trim().toUpperCase() === 'PRUEBA' || fn2.trim() === '') fn2 = 'Construacero Carabobo C.A.'
    doc.text(fn2, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }

  doc.save(`Reporte_Ventas_${rango.from}_${rango.to}.pdf`)
}
