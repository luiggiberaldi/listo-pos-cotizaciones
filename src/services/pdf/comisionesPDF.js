// src/services/pdf/comisionesPDF.js
// Genera PDF profesional de Reporte de Comisiones — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_GRAY,
  fmtUsd, fmtBs, fmtFecha, fmtFechaCorta,
  hexToRgb, drawWatermark, checkPage, drawSimplifiedHeader,
} from './pdfShared'

// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
export async function generarComisionesPDF({ comisiones, vendedor = null, tipoVendedor = null, resumen = null, rango = null, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)

  const handlePageAdd = (d) => {
    let rightTitle = 'Reporte de Comisiones'
    if (tipoVendedor === 'internos') rightTitle = 'Comisiones (Vendedores Internos)'
    else if (tipoVendedor === 'externos') rightTitle = 'Comisiones (Vendedores Externos)'
    else if (vendedor) rightTitle = `Comisiones - ${vendedor.nombre}`
    return drawSimplifiedHeader(d, logoData, config, rightTitle)
  }

  function drawStatusBadge(d, estado, x, y, w, h) {
    let bgColor = [241, 245, 249] // slate 100
    let borderColor = [226, 232, 240] // slate 200
    let textColor = [71, 85, 105] // slate 600
    let text = 'PENDIENTE'
    
    if (estado === 'pagada') {
      bgColor = [236, 253, 245] // emerald 50
      borderColor = [167, 243, 208] // emerald 200
      textColor = [4, 120, 87] // emerald 700
      text = 'PAGADA'
    } else if (estado === 'cta_cobrar') {
      bgColor = [254, 242, 242] // red 50 (#FEF2F2)
      borderColor = [254, 202, 202] // red 200 (#FECACA)
      textColor = [185, 28, 28] // red 700 (#B91C1C)
      text = 'CTA X COBRAR'
    } else {
      bgColor = [255, 251, 235] // amber 50
      borderColor = [253, 230, 138] // amber 200
      textColor = [180, 83, 9] // amber 700
      text = 'PENDIENTE'
    }
    
    d.setFillColor(...bgColor)
    d.roundedRect(x, y - h + 1, w, h, 1, 1, 'F')
    
    d.setDrawColor(...borderColor)
    d.setLineWidth(0.2)
    d.roundedRect(x, y - h + 1, w, h, 1, 1, 'S')
    
    d.setFont('helvetica', 'bold')
    d.setFontSize(5.5)
    d.setTextColor(...textColor)
    d.text(text, x + w / 2, y - h / 2 + 1.2, { align: 'center' })
  }

  // NORMALIZAR: unificar naming antes de procesar (soporte para Worker API y RPC)
  function normalizarComision(c) {
    const rawEstado = (c.estado_comision || c.estado || 'pendiente').toLowerCase()
    
    return {
      ...c,
      vendedor: c.vendedor || (c.asesor ? { nombre: c.asesor, color: c.asesor_color || '#1B365D' } : null),
      // Totales (Prioridad a RPC si existen, luego Worker, luego default)
      totalcomision: Number(c.total_com ?? c.totalcomision ?? c.despacho_comision_total ?? 0),
      comisioncabilla: Number(c.comisioncabilla ?? 0),
      comisionotros: Number(c.comisionotros ?? 0),
      // Valor del item (si aplica)
      valor: Number(c.total ?? 0),
      pct: Number(c.comision_pct ?? c.pct ?? 0),
      // Producto
      codigo: c.codigo || '',
      descripcion: (c.descripcion || c.nombre_snap || '').toUpperCase(),
      // Número de despacho
      despachonumero: c.despacho_numero || c.despachonumero || c.despacho?.numero || '---',
      montopagado: Number(c.despacho_comision_liberada ?? c.montopagado ?? 0),
      // Tasa
      tasa_snapshot: Number(
        c.tasa ??
        c.tasa_snapshot ?? 
        c.despacho?.tasa_snapshot ?? 
        c.cotizacion?.tasa_bcv_snapshot ?? 
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
  let subTitleText = 'Reporte de Comisiones'
  if (tipoVendedor === 'internos') subTitleText = 'Reporte de Comisiones — Vendedores Internos'
  else if (tipoVendedor === 'externos') subTitleText = 'Reporte de Comisiones — Vendedores Externos'
  doc.text(subTitleText, PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  let subHeaderDate = fmtFecha(new Date().toISOString(), 'short-month')
  if (rango && (rango.from || rango.to)) {
    subHeaderDate = `Periodo: ${rango.from ? fmtFechaCorta(rango.from) : 'Inicio'} al ${rango.to ? fmtFechaCorta(rango.to) : 'Fin'}`
  }
  doc.text(subHeaderDate, PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

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
    const esExterno = !!vendedor.es_externo || (vendedor.markup_pct != null && Number(vendedor.markup_pct) > 0);
    const labelV = esExterno ? `${vendedor.nombre} — Vendedor Externo (+${vendedor.markup_pct || 0}%)` : `${vendedor.nombre} — Vendedor Interno`;
    doc.text(labelV, MARGIN + 7, y + 7)
    y += 14
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. RESUMEN
  // ══════════════════════════════════════════════════════════════════════════
  const pends = comisionesNorm.filter(c => c.estado === 'pendiente')
  const cxc = comisionesNorm.filter(c => c.estado === 'cta_cobrar')
  const pagadas = comisionesNorm.filter(c => c.estado === 'pagada')
  
  // 1) "Saldo Pendiente": sum( max(totalcomision - montopagado, 0) ) para estados pendiente y cta_cobrar
  const totalPendiente = comisionesNorm
    .filter(c => ['pendiente', 'cta_cobrar'].includes(c.estado))
    .reduce((s, c) => s + Math.max(c.totalcomision - (c.montopagado || 0), 0), 0)
    
  // Desglose de pendientes
  const totalPendienteRegular = comisionesNorm
    .filter(c => c.estado === 'pendiente')
    .reduce((s, c) => s + Math.max(c.totalcomision - (c.montopagado || 0), 0), 0)

  const totalPendienteCxc = comisionesNorm
    .filter(c => c.estado === 'cta_cobrar')
    .reduce((s, c) => s + Math.max(c.totalcomision - (c.montopagado || 0), 0), 0)
    
  // 2) "Total Pagado": sum(COALESCE(montopagado, 0)) de todas
  const totalPagado = comisionesNorm.reduce((s, c) => s + (c.montopagado || 0), 0)
  
  // 3) "Generado Histórico": sum(totalcomision) de todas
  const totalGeneral = comisionesNorm.reduce((s, c) => s + c.totalcomision, 0)

  // Cuadro resumen premium
  const boxH = 18
  const boxW = CONTENT_W / 3
  const boxes = [
    { 
      label: 'Generado Histórico', 
      value: fmtUsd(totalGeneral), 
      count: `${comisionesNorm.length} comisiones`, 
      bgColor: [248, 250, 252], // Slate 50
      borderColor: [226, 232, 240], // Slate 200
      textColor: [15, 23, 42], // Slate 900
      badgeColor: [100, 116, 139] // Slate 500
    },
    { 
      label: 'Total Pagado', 
      value: fmtUsd(totalPagado), 
      count: `${pagadas.length} pagadas`, 
      bgColor: [236, 253, 245], // Emerald 50
      borderColor: [167, 243, 208], // Emerald 200
      textColor: [4, 120, 87], // Emerald 700
      badgeColor: [5, 150, 105] // Emerald 600
    },
    { 
      label: 'Saldo Pendiente', 
      value: fmtUsd(totalPendiente), 
      count: `${pends.length} pend / ${cxc.length} cxc`, 
      bgColor: [255, 251, 235], // Amber 50
      borderColor: [253, 230, 138], // Amber 200
      textColor: [180, 83, 9], // Amber 700
      badgeColor: [217, 119, 6] // Amber 600
    },
  ]

  boxes.forEach((box, i) => {
    const bx = MARGIN + i * boxW
    
    // Draw background
    doc.setFillColor(...box.bgColor)
    doc.roundedRect(bx + 1, y, boxW - 2, boxH, 2.5, 2.5, 'F')
    
    // Draw border
    doc.setDrawColor(...box.borderColor)
    doc.setLineWidth(0.4)
    doc.roundedRect(bx + 1, y, boxW - 2, boxH, 2.5, 2.5, 'S')
    
    // Draw content
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...box.badgeColor)
    doc.text(box.label.toUpperCase(), bx + 4.5, y + 5.5)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...box.textColor)
    doc.text(box.value, bx + 4.5, y + 11.5)
    
    if (i === 2) {
      // Dibujar desglose premium
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.2)
      doc.setTextColor(217, 119, 6) // Amber 600
      const txtReg = `Reg: ${fmtUsd(totalPendienteRegular)}  ·  `
      doc.text(txtReg, bx + 4.5, y + 15.5)
      const offset = doc.getTextWidth(txtReg)
      doc.setTextColor(185, 28, 28) // Red 700
      doc.text(`CxC: ${fmtUsd(totalPendienteCxc)}`, bx + 4.5 + offset, y + 15.5)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...box.badgeColor)
      doc.text(box.count, bx + 4.5, y + 15.5)
    }
  })

  y += boxH + 4

  // DRAW VISUAL BREAKDOWN BAR (Barra de progreso)
  if (totalGeneral > 0) {
    const barH = 5
    const barW = CONTENT_W
    const pctPagado = (totalPagado / totalGeneral) * 100
    const pctPendiente = (totalPendiente / totalGeneral) * 100
    const wPagado = (totalPagado / totalGeneral) * barW

    y = checkPage(doc, y, 14)
    
    // Label
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    doc.text('Distribución de Liquidación:', MARGIN + 1, y + 3)
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_GRAY)
    const labelPct = `${pctPagado.toFixed(1)}% Pagado · ${pctPendiente.toFixed(1)}% Pendiente`
    doc.text(labelPct, MARGIN + CONTENT_W - 1, y + 3, { align: 'right' })
    
    y += 4.5

    // Background track
    doc.setFillColor(241, 245, 249) // Gray 100
    doc.roundedRect(MARGIN, y, barW, barH, 1.5, 1.5, 'F')

    // Emerald fill (Pagado)
    if (wPagado > 0) {
      doc.setFillColor(16, 185, 129) // Emerald 500
      doc.roundedRect(MARGIN, y, wPagado, barH, 1.5, 1.5, 'F')
    }

    // Amber fill (Pendiente)
    if (barW - wPagado > 0.5) {
      doc.setFillColor(245, 158, 11) // Amber 500
      doc.roundedRect(MARGIN + wPagado, y, barW - wPagado, barH, 1.5, 1.5, 'F')
      
      // Draw divider line if both parts exist
      if (wPagado > 0 && wPagado < barW) {
        doc.setFillColor(255, 255, 255)
        doc.rect(MARGIN + wPagado - 0.2, y, 0.4, barH, 'F')
      }
    }

    y += barH + 6
  } else {
    y += 4
  }

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

  // Clasificación de comisiones en internos y externos
  const comisionesInternos = comisionesNorm.filter(c => {
    const esExterno = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0);
    return !esExterno;
  });
  const comisionesExternos = comisionesNorm.filter(c => {
    const esExterno = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0);
    return esExterno;
  });

  // Función auxiliar para dibujar un grupo de comisiones
  function dibujarGrupoTabla(titulo, items) {
    if (items.length === 0) {
      y = checkPage(doc, y, 15, handlePageAdd);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...C_DARK);
      doc.text(titulo, MARGIN, y + 4);
      y += 6;
      
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...C_GRAY);
      doc.text('No hay comisiones registradas en este grupo.', MARGIN + 2, y + 4);
      y += 8;
      return { totalUsd: 0, cabillaUsd: 0, otrosUsd: 0, abonadoUsd: 0, totalBs: 0 };
    }

    y = checkPage(doc, y, 18, handlePageAdd);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C_DARK);
    doc.text(titulo, MARGIN, y + 4);
    y += 7;

    y = drawTableHeader(doc, y);

    let subCabillaUsd = 0;
    let subOtrosUsd = 0;
    let subTotalUsd = 0;
    let subAbonadoUsd = 0;
    let subTotalBs = 0;

    items.forEach((c, idx) => {
      const rowH = 6;
      y = checkPage(doc, y, rowH + 2, handlePageAdd);

      if (y < MARGIN + 12) {
        y = drawTableHeader(doc, y);
      }

      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253);
        doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...C_DARK);

      const tasa = c.tasa_snapshot;
      const comBs = tasa > 0 ? c.totalcomision * tasa : 0;

      // Sumar a subtotales
      subCabillaUsd += c.comisioncabilla;
      subOtrosUsd += c.comisionotros;
      subTotalUsd += c.totalcomision;
      subAbonadoUsd += c.montopagado;
      subTotalBs += comBs;

      if (esDetallado) {
        if (vendedor) {
          doc.text(fmtFechaCorta(c.creadoen), cols[0].x + 1, y + 3);
          doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3);
          
          doc.setFontSize(5.5);
          const desc = `${c.codigo ? '['+c.codigo+'] ' : ''}${c.descripcion || '—'}`;
          const splitDesc = doc.splitTextToSize(desc, cols[2].w - 2);
          doc.text(splitDesc, cols[2].x + 1, y + 2.5);
          doc.setFontSize(6.5);

          doc.text(fmtUsd(c.valor), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' });
          doc.text(`${c.pct}%`, cols[4].x + cols[4].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(fmtUsd(c.totalcomision), cols[5].x + cols[5].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'normal');
          doc.text(tasa > 0 ? `Bs ${tasa}` : 'N/D', cols[6].x + cols[6].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(tasa > 0 ? fmtBs(comBs) : 'N/D', cols[7].x + cols[7].w - 2, y + 3, { align: 'right' });

          drawStatusBadge(doc, c.estado, cols[8].x, y + 3.5, cols[8].w, 4);
        } else {
          doc.setFont('helvetica', 'bold');
          const isExt = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0);
          const markupSuffix = isExt ? ` (E)` : '';
          const vName = `${c.vendedor?.nombre || 'Sin asesor'}${markupSuffix}`;
          const vNameLines = doc.splitTextToSize(vName, cols[0].w - 2);
          doc.text(vNameLines[0], cols[0].x + 1, y + 3);
          
          doc.setFont('helvetica', 'normal');
          doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3);

          doc.setFontSize(5.5);
          const desc = `${c.codigo ? '['+c.codigo+'] ' : ''}${c.descripcion || '—'}`;
          const splitDesc = doc.splitTextToSize(desc, cols[2].w - 2);
          doc.text(splitDesc, cols[2].x + 1, y + 2.5);
          doc.setFontSize(6.5);

          doc.text(fmtUsd(c.valor), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' });
          doc.text(`${c.pct}%`, cols[4].x + cols[4].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(fmtUsd(c.totalcomision), cols[5].x + cols[5].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'normal');
          doc.text(tasa > 0 ? `Bs ${tasa}` : 'N/D', cols[6].x + cols[6].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(tasa > 0 ? fmtBs(comBs) : 'N/D', cols[7].x + cols[7].w - 2, y + 3, { align: 'right' });

          drawStatusBadge(doc, c.estado, cols[8].x, y + 3.5, cols[8].w, 4);
        }
      } else {
        if (vendedor) {
          doc.text(fmtFechaCorta(c.creadoen), cols[0].x + 1, y + 3);
          doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3);
          
          doc.text(fmtUsd(c.comisioncabilla), cols[2].x + cols[2].w - 2, y + 3, { align: 'right' });
          doc.text(fmtUsd(c.comisionotros), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(fmtUsd(c.totalcomision), cols[4].x + cols[4].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'normal');
          doc.text(c.montopagado > 0 ? fmtUsd(c.montopagado) : '—', cols[5].x + cols[5].w - 2, y + 3, { align: 'right' });
          
          doc.text(tasa > 0 ? `Bs ${tasa}` : 'N/D', cols[6].x + cols[6].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(tasa > 0 ? fmtBs(comBs) : 'N/D', cols[7].x + cols[7].w - 2, y + 3, { align: 'right' });

          drawStatusBadge(doc, c.estado, cols[8].x, y + 3.5, cols[8].w, 4);
        } else {
          doc.setFont('helvetica', 'bold');
          const isExt = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0);
          const markupSuffix = isExt ? ` (E)` : '';
          const vName = `${c.vendedor?.nombre || 'Sin asesor'}${markupSuffix}`;
          const vNameLines = doc.splitTextToSize(vName, cols[0].w - 2);
          doc.text(vNameLines[0], cols[0].x + 1, y + 3);
          
          doc.setFont('helvetica', 'normal');
          doc.text(fmtFechaCorta(c.creadoen), cols[1].x + 1, y + 3);
          doc.text(`#${c.despachonumero}`, cols[2].x + 1, y + 3);

          doc.setFont('helvetica', 'bold');
          doc.text(fmtUsd(c.totalcomision), cols[3].x + cols[3].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'normal');
          doc.text(c.montopagado > 0 ? fmtUsd(c.montopagado) : '—', cols[4].x + cols[4].w - 2, y + 3, { align: 'right' });
          
          doc.text(tasa > 0 ? `Bs ${tasa}` : 'N/D', cols[5].x + cols[5].w - 2, y + 3, { align: 'right' });
          
          doc.setFont('helvetica', 'bold');
          doc.text(tasa > 0 ? fmtBs(comBs) : 'N/D', cols[6].x + cols[6].w - 2, y + 3, { align: 'right' });

          drawStatusBadge(doc, c.estado, cols[7].x, y + 3.5, cols[7].w, 4);
        }
      }

      y += rowH;
    });

    // Subtotal del grupo
    y = checkPage(doc, y, 9, handlePageAdd);
    doc.setDrawColor(210, 215, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 3.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(80, 90, 110);
    doc.text(`Subtotal ${titulo}:`, MARGIN + 2, y);

    if (esDetallado) {
      doc.text(fmtUsd(subTotalUsd), cols[5].x + cols[5].w - 2, y, { align: 'right' });
      doc.text(fmtBs(subTotalBs), cols[7].x + cols[7].w - 2, y, { align: 'right' });
    } else {
      if (vendedor) {
        doc.text(fmtUsd(subCabillaUsd), cols[2].x + cols[2].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(subOtrosUsd), cols[3].x + cols[3].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(subTotalUsd), cols[4].x + cols[4].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(subAbonadoUsd), cols[5].x + cols[5].w - 2, y, { align: 'right' });
        doc.text(fmtBs(subTotalBs), cols[7].x + cols[7].w - 2, y, { align: 'right' });
      } else {
        doc.text(fmtUsd(subTotalUsd), cols[3].x + cols[3].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(subAbonadoUsd), cols[4].x + cols[4].w - 2, y, { align: 'right' });
        doc.text(fmtBs(subTotalBs), cols[6].x + cols[6].w - 2, y, { align: 'right' });
      }
    }
    y += 5.5;

    return { totalUsd: subTotalUsd, cabillaUsd: subCabillaUsd, otrosUsd: subOtrosUsd, abonadoUsd: subAbonadoUsd, totalBs: subTotalBs };
  }

  let sumCabillaUsd = 0;
  let sumOtrosUsd = 0;
  let sumTotalUsd = 0;
  let sumAbonadoUsd = 0;
  let sumTotalBs = 0;

  if (vendedor) {
    const res = dibujarGrupoTabla("Comisiones", comisionesNorm);
    sumCabillaUsd = res.cabillaUsd;
    sumOtrosUsd = res.otrosUsd;
    sumTotalUsd = res.totalUsd;
    sumAbonadoUsd = res.abonadoUsd;
    sumTotalBs = res.totalBs;
  } else {
    if (tipoVendedor !== 'externos') {
      const resInt = dibujarGrupoTabla("Vendedores Internos", comisionesInternos);
      sumCabillaUsd += resInt.cabillaUsd;
      sumOtrosUsd += resInt.otrosUsd;
      sumTotalUsd += resInt.totalUsd;
      sumAbonadoUsd += resInt.abonadoUsd;
      sumTotalBs += resInt.totalBs;
    }
    if (tipoVendedor !== 'internos') {
      const resExt = dibujarGrupoTabla("Vendedores Externos", comisionesExternos);
      sumCabillaUsd += resExt.cabillaUsd;
      sumOtrosUsd += resExt.otrosUsd;
      sumTotalUsd += resExt.totalUsd;
      sumAbonadoUsd += resExt.abonadoUsd;
      sumTotalBs += resExt.totalBs;
    }
  }

  // Línea final y TOTALIZACIÓN
  y = checkPage(doc, y, 10, handlePageAdd);
  doc.setDrawColor(210, 215, 225);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 4;

  // Fila de gran total
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C_DARK);
  doc.text('TOTAL GENERAL:', MARGIN + 2, y + 1);
  
  if (esDetallado) {
    doc.text(fmtUsd(sumTotalUsd), cols[5].x + cols[5].w - 2, y + 1, { align: 'right' });
    doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1, { align: 'right' });
  } else {
    if (vendedor) {
      doc.text(fmtUsd(sumCabillaUsd), cols[2].x + cols[2].w - 2, y + 1, { align: 'right' });
      doc.text(fmtUsd(sumOtrosUsd), cols[3].x + cols[3].w - 2, y + 1, { align: 'right' });
      doc.text(fmtUsd(sumTotalUsd), cols[4].x + cols[4].w - 2, y + 1, { align: 'right' });
      doc.text(fmtUsd(sumAbonadoUsd), cols[5].x + cols[5].w - 2, y + 1, { align: 'right' });
      doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1, { align: 'right' });
    } else {
      doc.text(fmtUsd(sumTotalUsd), cols[3].x + cols[3].w - 2, y + 1, { align: 'right' });
      doc.text(fmtUsd(sumAbonadoUsd), cols[4].x + cols[4].w - 2, y + 1, { align: 'right' });
      doc.text(fmtBs(sumTotalBs), cols[6].x + cols[6].w - 2, y + 1, { align: 'right' });
    }
  }
  
  y += 6;

  // ══════════════════════════════════════════════════════════════════════════
  // 6. RESUMEN POR VENDEDOR (si es reporte general)
  // ══════════════════════════════════════════════════════════════════════════
  if (!vendedor) {
    const porVendedor = {};
    comisionesNorm.forEach(c => {
      const vName = c.vendedornombre || c.vendedor?.nombre || 'Sin Asesor';
      if (!porVendedor[vName]) {
        porVendedor[vName] = {
          nombre: vName,
          color: c.vendedorcolor || c.vendedor?.color || '#1B365D',
          markup_pct: c.vendedor?.markup_pct ?? null,
          es_externo: c.vendedor?.es_externo ?? null,
          total: 0, pendiente: 0, pendienteReg: 0, pendienteCxc: 0, pagado: 0, count: 0,
        };
      }
      const v = porVendedor[vName];

      const monto = c.totalcomision;
      const saldo = Math.max(0, monto - (c.montopagado || 0));
      v.total += monto;
      v.count++;
      if (c.estado === 'pagada') {
        v.pagado += c.montopagado || monto;
      } else {
        v.pendiente += saldo;
        if (c.estado === 'cta_cobrar') v.pendienteCxc += saldo;
        else v.pendienteReg += saldo;
      }
    });

    const vendedoresList = Object.values(porVendedor).sort((a, b) => b.total - a.total);
    const vendedoresInternos = vendedoresList.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)));
    const vendedoresExternos = vendedoresList.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0));

    y = checkPage(doc, y, 15, handlePageAdd);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...C_DARK);
    doc.text('Resumen por Vendedor', MARGIN, y + 4);
    y += 8;

    function dibujarResumenGrupo(titulo, list) {
      if (list.length === 0) {
        y = checkPage(doc, y, 12, handlePageAdd);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...C_DARK);
        doc.text(titulo, MARGIN, y + 4);
        y += 6;
        
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(...C_GRAY);
        doc.text('No hay vendedores en este grupo.', MARGIN + 2, y + 4);
        y += 8;
        return { total: 0, pendiente: 0, pendienteReg: 0, pendienteCxc: 0, pagado: 0, count: 0 };
      }

      y = checkPage(doc, y, 15 + list.length * 10, handlePageAdd);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...C_DARK);
      doc.text(titulo, MARGIN, y + 4);
      y += 7;

      // Mini tabla header
      doc.setFillColor(240, 242, 245);
      doc.rect(MARGIN, y, CONTENT_W, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(80, 90, 110);
      doc.text('Vendedor', MARGIN + 2, y + 4);
      doc.text('Com.', MARGIN + 50, y + 4);
      doc.text('Pendiente (Reg / CxC)', MARGIN + 70, y + 4);
      doc.text('Pagado', MARGIN + 130, y + 4);
      doc.text('Total', MARGIN + 155, y + 4);
      y += 8;

      let subCount = 0;
      let subPend = 0;
      let subPendReg = 0;
      let subPendCxc = 0;
      let subPag = 0;
      let subTot = 0;

      list.forEach((v, idx) => {
        const rowH = (v.pendienteCxc > 0) ? 10 : 7;
        y = checkPage(doc, y, rowH + 1, handlePageAdd);
        if (idx % 2 === 0) {
          doc.setFillColor(252, 252, 253);
          doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F');
        }

        const vColor = hexToRgb(v.color);
        doc.setFillColor(vColor[0], vColor[1], vColor[2]);
        doc.circle(MARGIN + 3, y + 2.5, 1.5, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(...C_DARK);
        
        const esVendedorExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
        const displayName = esVendedorExterno
          ? (v.markup_pct != null && Number(v.markup_pct) > 0 ? `${v.nombre} (E) (+${v.markup_pct}%)` : `${v.nombre} (E)`)
          : v.nombre;
        doc.text(displayName, MARGIN + 7, y + 3);

        doc.setFont('helvetica', 'normal');
        doc.text(String(v.count), MARGIN + 53, y + 3);

        // Columna Pendiente: Regular arriba, CxC abajo
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C_AMBER); // Ámbar = Regular
        doc.text(fmtUsd(v.pendienteReg), MARGIN + 70, y + 3);
        
        if (v.pendienteCxc > 0) {
          doc.setFontSize(6.5);
          doc.setTextColor(185, 28, 28); // Rojo = CxC
          doc.text(`CxC: ${fmtUsd(v.pendienteCxc)}`, MARGIN + 70, y + 7.5);
          doc.setFontSize(7);
        }

        doc.setTextColor(...C_EMERALD);
        doc.text(fmtUsd(v.pagado), MARGIN + 130, y + 3);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C_DARK);
        doc.text(fmtUsd(v.total), MARGIN + 155, y + 3);
        
        subCount += v.count;
        subPend += v.pendiente;
        subPendReg += v.pendienteReg;
        subPendCxc += v.pendienteCxc;
        subPag += v.pagado;
        subTot += v.total;
        
        y += rowH;
      });

      // Subtotal de Resumen
      y = checkPage(doc, y, 12, handlePageAdd);
      doc.setDrawColor(220, 225, 235);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 4;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(80, 90, 110);
      doc.text(`Subtotal ${titulo}:`, MARGIN + 2, y);
      doc.text(String(subCount), MARGIN + 53, y);
      
      doc.setTextColor(...C_AMBER);
      doc.text(fmtUsd(subPendReg), MARGIN + 70, y);
      
      if (subPendCxc > 0) {
        doc.setFontSize(6.5);
        doc.setTextColor(185, 28, 28);
        doc.text(`CxC: ${fmtUsd(subPendCxc)}`, MARGIN + 70, y + 4.5);
        doc.setFontSize(7);
      }
      
      doc.setTextColor(...C_EMERALD);
      doc.text(fmtUsd(subPag), MARGIN + 130, y);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...C_DARK);
      doc.text(fmtUsd(subTot), MARGIN + 155, y);
      
      y += (subPendCxc > 0 ? 12 : 8);
      return { total: subTot, pendiente: subPend, pendienteReg: subPendReg, pendienteCxc: subPendCxc, pagado: subPag, count: subCount };
    }

    const rInt = tipoVendedor !== 'externos' ? dibujarResumenGrupo("Vendedores Internos", vendedoresInternos) : { total: 0, pendiente: 0, pendienteReg: 0, pendienteCxc: 0, pagado: 0, count: 0 };
    const rExt = tipoVendedor !== 'internos' ? dibujarResumenGrupo("Vendedores Externos", vendedoresExternos) : { total: 0, pendiente: 0, pendienteReg: 0, pendienteCxc: 0, pagado: 0, count: 0 };

    // Gran Total del Resumen
    y = checkPage(doc, y, 14, handlePageAdd);
    doc.setDrawColor(180, 190, 205);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;

    const gtPendReg = rInt.pendienteReg + rExt.pendienteReg;
    const gtPendCxc = rInt.pendienteCxc + rExt.pendienteCxc;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C_DARK);
    doc.text('TOTAL GENERAL VENDEDORES:', MARGIN + 2, y);
    doc.text(String(rInt.count + rExt.count), MARGIN + 53, y);
    doc.setTextColor(...C_AMBER);
    doc.text(fmtUsd(gtPendReg), MARGIN + 70, y);
    if (gtPendCxc > 0) {
      doc.setFontSize(6.5);
      doc.setTextColor(185, 28, 28);
      doc.text(`CxC: ${fmtUsd(gtPendCxc)}`, MARGIN + 70, y + 4.5);
      doc.setFontSize(7.5);
    }
    doc.setTextColor(...C_EMERALD);
    doc.text(fmtUsd(rInt.pagado + rExt.pagado), MARGIN + 130, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C_DARK);
    doc.text(fmtUsd(rInt.total + rExt.total), MARGIN + 155, y);
    
    y += (gtPendCxc > 0 ? 10 : 6);
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
  const suffix = tipoVendedor ? `_${tipoVendedor}` : ''
  const titulo = vendedor
    ? `Comisiones_${vendedor.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`
    : `Comisiones_General${suffix}_${new Date().toISOString().slice(0, 10)}`
  doc.save(`${titulo}.pdf`)
}

// ─── Generar Reporte de Ventas PDF ───────────────────────────────────────────
export async function generarReporteVentasPDF({ reporte, rango, config = {}, action = 'download' }) {
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

  let labelTitle = 'Reporte de Ventas';
  if (reporte.tipoFiltro === 'internos') {
    labelTitle = 'Reporte de Ventas — Internos';
  } else if (reporte.tipoFiltro === 'externos') {
    labelTitle = 'Reporte de Ventas — Externos';
  } else if (reporte.tipoFiltro === 'todos') {
    labelTitle = 'Reporte de Ventas';
  } else {
    const porVendedorTitle = reporte.porVendedor || []
    const internosCount = porVendedorTitle.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))).length;
    const externosCount = porVendedorTitle.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)).length;
    if (internosCount > 0 && externosCount === 0) {
      labelTitle = 'Reporte de Ventas — Internos';
    } else if (externosCount > 0 && internosCount === 0) {
      labelTitle = 'Reporte de Ventas — Externos';
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(labelTitle, PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
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
  const kpiBoxH = 22
  const kpiData = [
    { label: 'Ventas Netas (Sin Flete)', value: fmtUsd(kpis.totalVentas), sub: '(Solo mercancía)' },
    { label: 'Despachos', value: String(kpis.numDespachos || 0) },
    { label: 'Ticket Promedio', value: fmtUsd(kpis.ticketPromedio) },
    { label: 'Comisiones', value: fmtUsd(kpis.totalComisiones), sub: (kpis.totalComisiones > 0) ? `2%: ${fmtUsd((kpis.comisionCabilla2 || 0) + (kpis.comisionCabilla3 || 0))} | 3%: ${fmtUsd(kpis.comisionOtros || 0)}` : null },
  ]

  kpiData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    
    // Draw background (light gray/slate-50)
    doc.setFillColor(248, 250, 252)
    // Draw border (slate-200)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    
    // FD means Fill and Stroke (Draw)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')
    
    // Label text (dark gray / slate-600)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(71, 85, 105)
    doc.text(kpi.label, bx + 3.5, y + 6)
    
    // Value text (midnight blue / C_DARK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12.5)
    doc.setTextColor(...C_DARK)
    doc.text(kpi.value, bx + 3.5, y + 13.5)
    
    // Sub text (slate-400 / C_GRAY)
    if (kpi.sub) {
      if (kpi.label === 'Comisiones') {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(71, 85, 105) // Slate-600 (darker and more visible)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...C_GRAY)
      }
      doc.text(kpi.sub, bx + 3.5, y + 19)
    }
  })
  y += kpiBoxH + 8

  // ══════════════════════════════════════════════════════════════════════════
  // 3. POR VENDEDOR
  // ══════════════════════════════════════════════════════════════════════════
  const porVendedor = reporte.porVendedor || []
  if (porVendedor.length > 0) {
    const internos = porVendedor.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)));
    const externos = porVendedor.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C_DARK);
    doc.text('Ventas por Vendedor', MARGIN, y + 4);
    y += 8;

    function dibujarVentasGrupo(titulo, list) {
      if (list.length === 0) {
        y = checkPage(doc, y, 12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...C_DARK);
        doc.text(titulo, MARGIN, y + 4);
        y += 6;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...C_GRAY);
        doc.text('No hay registros en este grupo.', MARGIN + 2, y + 4);
        y += 8;
        return { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0 };
      }

      y = checkPage(doc, y, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...C_DARK);
      doc.text(titulo, MARGIN, y + 4);
      y += 7;

      // Tabla header
      doc.setFillColor(240, 242, 245);
      doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(80, 90, 110);
      doc.text('Vendedor', MARGIN + 2, y + 4.5);
      doc.text('Despachos', MARGIN + 55, y + 4.5);
      doc.text('Ventas USD', MARGIN + 85, y + 4.5);
      doc.text('Comisiones', MARGIN + 125, y + 4.5);
      y += 9;

      let subCount = 0;
      let subTotalUsd = 0;
      let subComision = 0;
      let subCabilla = 0;
      let subOtros = 0;

      list.forEach((v, idx) => {
        const rowH = (v.comision > 0) ? 11 : 8;
        y = checkPage(doc, y, rowH + 1);
        if (idx % 2 === 0) {
          doc.setFillColor(252, 252, 253);
          doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F');
        }
        if (v.vendedorColor) {
          const vc = hexToRgb(v.vendedorColor);
          doc.setFillColor(vc[0], vc[1], vc[2]);
          doc.circle(MARGIN + 3, y + 3.5, 1.8, 'F');
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...C_DARK);
        
        const esVendedorExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
        const displayName = esVendedorExterno
          ? (v.markup_pct != null && Number(v.markup_pct) > 0 ? `${v.vendedor} (E) (+${v.markup_pct}%)` : `${v.vendedor} (E)`)
          : v.vendedor;
        doc.text(displayName || '—', MARGIN + 7, y + 4.5);
        doc.text(fmtUsd(v.totalUsd), MARGIN + 85, y + 4.5);
        doc.text(fmtUsd(v.comision), MARGIN + 125, y + 4.5);
        
        doc.setFont('helvetica', 'normal');
        doc.text(String(v.count || 0), MARGIN + 58, y + 4.5);
        
        if (v.comision > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(71, 85, 105);
          const totalCabilla = (v.comisionCabilla2 || 0) + (v.comisionCabilla3 || 0);
          doc.text(`2%: ${fmtUsd(totalCabilla)} | 3%: ${fmtUsd(v.comisionOtros || 0)}`, MARGIN + 125, y + 8.5);
          
          subCabilla += totalCabilla;
          subOtros += (v.comisionOtros || 0);
        }
        
        subCount += (v.count || 0);
        subTotalUsd += (v.totalUsd || 0);
        subComision += (v.comision || 0);

        y += rowH;
      });

      // Subtotal de Ventas
      y = checkPage(doc, y, 10);
      doc.setDrawColor(210, 215, 225);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 90, 110);
      doc.text(`Subtotal ${titulo}`, MARGIN + 7, y + 4.5);
      doc.text(String(subCount), MARGIN + 58, y + 4.5);
      doc.text(fmtUsd(subTotalUsd), MARGIN + 85, y + 4.5);
      doc.text(fmtUsd(subComision), MARGIN + 125, y + 4.5);

      if (subComision > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(71, 85, 105);
        doc.text(`2%: ${fmtUsd(subCabilla)} | 3%: ${fmtUsd(subOtros)}`, MARGIN + 125, y + 8.5);
      }
      y += 12;
      return { count: subCount, totalUsd: subTotalUsd, comision: subComision, comisionCabilla: subCabilla, comisionOtros: subOtros };
    }

    let rInt = { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0 };
    let rExt = { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0 };

    const showInternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'internos' || !reporte.tipoFiltro);
    const showExternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'externos' || !reporte.tipoFiltro);

    if (showInternos) {
      rInt = dibujarVentasGrupo("Vendedores Internos", internos);
    }
    if (showExternos) {
      rExt = dibujarVentasGrupo("Vendedores Externos", externos);
    }

    // Fila de Total
    y = checkPage(doc, y, 12);
    doc.setFillColor(245, 247, 250);
    doc.rect(MARGIN, y - 1, CONTENT_W, 11, 'F');

    doc.setDrawColor(200, 204, 210);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1);

    const totalDespachos = rInt.count + rExt.count;
    const totalVentasUsd = rInt.totalUsd + rExt.totalUsd;
    const totalComisiones = rInt.comision + rExt.comision;
    const totalCabilla = rInt.comisionCabilla + rExt.comisionCabilla;
    const totalOtros = rInt.comisionOtros + rExt.comisionOtros;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C_DARK);
    doc.text('TOTAL GENERAL', MARGIN + 7, y + 4.5);
    
    doc.setFont('helvetica', 'bold');
    doc.text(String(totalDespachos), MARGIN + 58, y + 4.5);
    doc.text(fmtUsd(totalVentasUsd), MARGIN + 85, y + 4.5);
    doc.text(fmtUsd(totalComisiones), MARGIN + 125, y + 4.5);
    
    if (totalComisiones > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(`2%: ${fmtUsd(totalCabilla)} | 3%: ${fmtUsd(totalOtros)}`, MARGIN + 125, y + 9);
    }

    doc.line(MARGIN, y + 10, MARGIN + CONTENT_W, y + 10);
    y += 14;
    y += 6;
  }

  // Se eliminó la sección de Top Clientes y Ventas por Categoría por solicitud del usuario

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DESGLOSE DETALLADO DE VENTAS POR VENDEDOR
  // ══════════════════════════════════════════════════════════════════════════
  const despachosReporte = reporte.despachos || [];
  if (despachosReporte.length > 0 && porVendedor.length > 0) {
    const internos = porVendedor.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)));
    const externos = porVendedor.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0));

    const showInternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'internos' || !reporte.tipoFiltro);
    const showExternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'externos' || !reporte.tipoFiltro);

    // Unir la lista según el filtro para el desglose detallado
    const listadoParaDetalle = [];
    if (showInternos && internos.length > 0) {
      listadoParaDetalle.push({ titulo: "Desglose - Vendedores Internos", lista: internos });
    }
    if (showExternos && externos.length > 0) {
      listadoParaDetalle.push({ titulo: "Desglose - Vendedores Externos", lista: externos });
    }

    let seDibujoTituloSeccion = false;

    listadoParaDetalle.forEach(grupo => {
      let seDibujoTituloGrupo = false;

      grupo.lista.forEach(v => {
        // Encontrar despachos asociados al vendedor actual
        const susDespachos = despachosReporte.filter(d => 
          (d.asesor_id && d.asesor_id === v.id) || 
          (d.asesor_nombre && String(d.asesor_nombre).trim().toLowerCase() === String(v.vendedor).trim().toLowerCase())
        );

        if (susDespachos.length === 0) return;

        susDespachos.sort((a, b) => (Number(a.despacho_numero) || 0) - (Number(b.despacho_numero) || 0));

        // 1. Título General de la Sección
        if (!seDibujoTituloSeccion) {
          y = checkPage(doc, y, 22);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(...C_DARK);
          doc.text('Detalle de Ventas por Vendedor', MARGIN, y + 4);
          y += 8;
          seDibujoTituloSeccion = true;
        }

        // 2. Subtítulo del Grupo (ej. Desglose - Vendedores Internos)
        if (!seDibujoTituloGrupo) {
          y = checkPage(doc, y, 14);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(80, 90, 110);
          doc.text(grupo.titulo, MARGIN, y + 4);
          y += 6;
          seDibujoTituloGrupo = true;
        }

        // 3. Bloque del Vendedor
        // Aseguramos espacio para: Cabecera del vendedor (4mm) + Header de subtabla (6mm) + 2 registros (12mm) = 22mm
        y = checkPage(doc, y, 22);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...C_DARK);

        const esVendedorExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
        const displayName = esVendedorExterno
          ? (v.markup_pct != null && Number(v.markup_pct) > 0 ? `${v.vendedor} (E) (+${v.markup_pct}%)` : `${v.vendedor} (E)`)
          : v.vendedor;

        // Círculo de color
        if (v.vendedorColor) {
          const vc = hexToRgb(v.vendedorColor);
          doc.setFillColor(vc[0], vc[1], vc[2]);
          doc.circle(MARGIN + 3, y + 2.5, 1.8, 'F');
        }
        doc.text(displayName || '—', MARGIN + 7, y + 3.5);
        y += 6;

        // Cabecera de la sub-tabla de documentos
        doc.setFillColor(242, 244, 247);
        doc.rect(MARGIN, y, CONTENT_W, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 110, 125);
        
        doc.text('Documento / Correlativo', MARGIN + 4, y + 4);
        doc.text('Cliente', MARGIN + 45, y + 4);
        doc.text('Monto de la Venta (USD)', MARGIN + CONTENT_W - 4, y + 4, { align: 'right' });
        y += 6.5;

        // Dibujar transacciones
        susDespachos.forEach((d, dIdx) => {
          y = checkPage(doc, y, 7);

          // Alternar fila
          if (dIdx % 2 === 1) {
            doc.setFillColor(250, 251, 253);
            doc.rect(MARGIN, y - 0.5, CONTENT_W, 6, 'F');
          }

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(80, 90, 100);

          const numDoc = d.despacho_numero ? `#${d.despacho_numero}` : 'S/N';
          const cliente = d.cliente_nombre ? String(d.cliente_nombre).toUpperCase() : 'CLIENTE SIN NOMBRE';
          
          // Truncar cliente para seguridad espacial
          const maxChars = 48;
          const truncatedCliente = cliente.length > maxChars ? `${cliente.substring(0, maxChars)}...` : cliente;

          doc.text(`Doc ${numDoc}`, MARGIN + 4, y + 3.5);
          doc.text(truncatedCliente, MARGIN + 45, y + 3.5);

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...C_DARK);
          doc.text(fmtUsd(d.venta_neta_usd || 0), MARGIN + CONTENT_W - 4, y + 3.5, { align: 'right' });

          y += 5.5;
        });

        y += 4; // Espacio entre vendedores
      });
    });
    
    y += 4;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FORMAS DE PAGO
  // ══════════════════════════════════════════════════════════════════════════
  const porFormaPago = reporte.porFormaPago || []
  if (porFormaPago.length > 0) {
    y = checkPage(doc, y, 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_DARK)
    doc.text('Formas de Pago', MARGIN, y + 4)
    y += 8

    const fpTotal = porFormaPago.reduce((s, fp) => s + fp.totalUsd, 0)
    porFormaPago.forEach((fp) => {
      const pct = fpTotal > 0 ? ((fp.totalUsd / fpTotal) * 100).toFixed(1) : '0.0'

      // 1. Cabecera: nombre del metodo (se previene cabecera huerfana controlando el espacio minimo reqH)
      const reqH = Array.isArray(fp.pagos) && fp.pagos.length > 0 ? 32 : 20
      y = checkPage(doc, y, reqH)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(`${fp.formaPago} (${fp.count} desp.)`, MARGIN + 2, y + 4)
      y += 8

      // 2. Desglose de transacciones
      if (Array.isArray(fp.pagos) && fp.pagos.length > 0) {
        fp.pagos.forEach(p => {
          y = checkPage(doc, y, 9)
          doc.setFontSize(8.5)
          doc.setTextColor(110, 120, 130)

          const numDoc = p.numero ? `#${p.numero}` : 'S/N'
          const cliente = p.cliente ? String(p.cliente).toUpperCase().substring(0, 48) : 'CLIENTE SIN NOMBRE'
          const labelText = `    • Doc ${numDoc}  ·  ${cliente}  ·  `

          doc.setFont('helvetica', 'normal')
          doc.text(labelText, MARGIN + 2, y + 2)

          const labelW = doc.getTextWidth(labelText)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(...C_DARK)
          doc.text(fmtUsd(p.monto), MARGIN + 2 + labelW, y + 2)
          y += 7.5
        })
      }

      // 3. Total del metodo + % + barra (al final del grupo)
      y = checkPage(doc, y, 11)
      if (Array.isArray(fp.pagos) && fp.pagos.length > 0) {
        doc.setDrawColor(220, 224, 230)
        doc.setLineWidth(0.35)
        doc.line(MARGIN + 2, y + 0.5, MARGIN + CONTENT_W - 2, y + 0.5)
        y += 3
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(fmtUsd(fp.totalUsd), MARGIN + 80, y + 4)
      doc.setFont('helvetica', 'normal')
      doc.text(`${pct}%`, MARGIN + 110, y + 4)

      // Mini barra
      const barX = MARGIN + 130
      const barW = CONTENT_W - 130
      doc.setFillColor(230, 233, 240)
      doc.roundedRect(barX, y + 0.5, barW, 4, 1, 1, 'F')
      const fillW = barW * (Number(pct) / 100)
      if (fillW > 0) {
        doc.setFillColor(...C_PRIMARY)
        doc.roundedRect(barX, y + 0.5, Math.max(fillW, 2), 4, 1, 1, 'F')
      }
      y += 8.5
      y += 4
    })

    // Fila de Total
    y = checkPage(doc, y, 10)
    doc.setFillColor(245, 247, 250)
    doc.rect(MARGIN, y - 1, CONTENT_W, 9, 'F')

    doc.setDrawColor(200, 204, 210)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)

    const totalFpDespachos = porFormaPago.reduce((s, fp) => s + (fp.count || 0), 0)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...C_DARK)
    doc.text(`TOTAL RECAUDADO (${totalFpDespachos} desp.)`, MARGIN + 2, y + 5)
    doc.text(fmtUsd(fpTotal), MARGIN + 80, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.text('100.0%', MARGIN + 110, y + 5)

    doc.line(MARGIN, y + 8, MARGIN + CONTENT_W, y + 8)
    y += 12

    // Bloque de Desglose de Flete / Diferencia
    const fpCxc = porFormaPago.find(fp => fp.formaPago === 'Cta por cobrar');
    const totalCxC = fpCxc ? fpCxc.totalUsd : 0;
    const ventasSinCxc = (kpis.totalVentas || 0) - totalCxC;
    const tieneCxC = totalCxC > 0;
    const boxH = tieneCxC ? 21 : 14;

    y = checkPage(doc, y, boxH + 4)
    doc.setFillColor(250, 252, 255)
    doc.setDrawColor(210, 225, 245)
    doc.setLineWidth(0.3)
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 1.5, 1.5, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_PRIMARY)
    doc.text('DESGLOSE DE LA DIFERENCIA (RECAUDACIÓN VS VENTAS NETAS):', MARGIN + 3.5, y + 5.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    let curX = MARGIN + 3.5
    
    // 1. Ventas Netas
    const lbl1 = 'Ventas Netas (Mercancía): '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl1, curX, y + 10.5)
    curX += doc.getTextWidth(lbl1)
    
    const val1 = fmtUsd(kpis.totalVentas || 0)
    doc.setFont('helvetica', 'bold')
    doc.text(val1, curX, y + 10.5)
    curX += doc.getTextWidth(val1)
    
    // Separator 1
    const sep1 = '    |    '
    doc.setFont('helvetica', 'normal')
    doc.text(sep1, curX, y + 10.5)
    curX += doc.getTextWidth(sep1)
    
    // 2. Flete
    const lbl2 = 'Flete/Envío Recaudado: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl2, curX, y + 10.5)
    curX += doc.getTextWidth(lbl2)
    
    const val2 = fmtUsd(kpis.totalFlete || 0)
    doc.setFont('helvetica', 'bold')
    doc.text(val2, curX, y + 10.5)
    curX += doc.getTextWidth(val2)
    
    // Separator 2
    const sep2 = '    |    '
    doc.setFont('helvetica', 'normal')
    doc.text(sep2, curX, y + 10.5)
    curX += doc.getTextWidth(sep2)
    
    // 3. Total Recaudado
    const lbl3 = 'Total Recaudado: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl3, curX, y + 10.5)
    curX += doc.getTextWidth(lbl3)
    
    const val3 = fmtUsd(fpTotal)
    doc.setFont('helvetica', 'bold')
    doc.text(val3, curX, y + 10.5)

    // Linea 2 (solo si tiene CxC)
    if (tieneCxC) {
      let curX2 = MARGIN + 3.5;
      
      const lblCxC = 'Cuentas por Cobrar (CxC): ';
      doc.setFont('helvetica', 'normal')
      doc.text(lblCxC, curX2, y + 16.5)
      curX2 += doc.getTextWidth(lblCxC)
      
      const valCxC = `-${fmtUsd(totalCxC)}`;
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(220, 38, 38) // Color rojo
      doc.text(valCxC, curX2, y + 16.5)
      curX2 += doc.getTextWidth(valCxC)
      
      doc.setTextColor(...C_DARK) // restaurar color
      const sepCxC = '    |    ';
      doc.setFont('helvetica', 'normal')
      doc.text(sepCxC, curX2, y + 16.5)
      curX2 += doc.getTextWidth(sepCxC)
      
      const lblSinCxC = 'Ventas Netas sin CxC (Recaudación Real): ';
      doc.setFont('helvetica', 'normal')
      doc.text(lblSinCxC, curX2, y + 16.5)
      curX2 += doc.getTextWidth(lblSinCxC)
      
      const valSinCxC = fmtUsd(ventasSinCxc);
      doc.setFont('helvetica', 'bold')
      doc.text(valSinCxC, curX2, y + 16.5)
    }

    y += boxH + 4
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

  let dynamicFilename = `Reporte_Ventas_${rango.from}_${rango.to}.pdf`;
  if (reporte.tipoFiltro === 'internos') {
    dynamicFilename = `Reporte_Ventas_Internos_${rango.from}_${rango.to}.pdf`;
  } else if (reporte.tipoFiltro === 'externos') {
    dynamicFilename = `Reporte_Ventas_Externos_${rango.from}_${rango.to}.pdf`;
  } else if (reporte.tipoFiltro === 'todos') {
    dynamicFilename = `Reporte_Ventas_${rango.from}_${rango.to}.pdf`;
  } else {
    const porVendedorSave = reporte.porVendedor || []
    const internosCountSave = porVendedorSave.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))).length;
    const externosCountSave = porVendedorSave.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)).length;
    if (internosCountSave > 0 && externosCountSave === 0) {
      dynamicFilename = `Reporte_Ventas_Internos_${rango.from}_${rango.to}.pdf`;
    } else if (externosCountSave > 0 && internosCountSave === 0) {
      dynamicFilename = `Reporte_Ventas_Externos_${rango.from}_${rango.to}.pdf`;
    }
  }

  if (action === 'print') {
    doc.autoPrint();
    const hNV = doc.output('bloburl');
    if (hNV) {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = hNV;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(hNV);
        }, 10000);
      };
    }
  } else {
    doc.save(dynamicFilename)
  }
}
