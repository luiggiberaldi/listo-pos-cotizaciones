// src/services/pdf/comisionesPDF.js
// Genera PDF profesional de Reporte de Comisiones — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_GRAY, C_RED,
  fmtUsd, fmtBs, fmtBsShort, fmtFecha, fmtFechaCorta,
  hexToRgb, drawWatermark, checkPage, drawSimplifiedHeader, drawPremiumHeader, drawPremiumFooter
} from './pdfShared'

// Helper para formatear forma_pago_abono (que puede venir como JSON array o string)
function formatMetodoPago(val, fallback = '—') {
  if (!val) return fallback
  try {
    if (Array.isArray(val)) {
      const parts = val.map(p => p.metodo || p.metodo_pago || p.formaPago).filter(Boolean)
      return parts.length > 0 ? parts.join(', ') : fallback
    }
    if (typeof val === 'object') {
      return val.metodo || val.metodo_pago || val.formaPago || fallback
    }
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          const parts = parsed.map(p => p.metodo || p.metodo_pago || p.formaPago).filter(Boolean)
          return parts.length > 0 ? parts.join(', ') : fallback
        } else if (parsed && typeof parsed === 'object') {
          return parsed.metodo || parsed.metodo_pago || parsed.formaPago || fallback
        }
      }
      return val || fallback
    }
  } catch (e) {
    // Ignore and fallback
  }
  return String(val) || fallback
}

// ─── Generar Reporte de Ventas PDF ───────────────────────────────────────────
export async function generarReporteVentasPDF({ reporte, rango, config = {}, action = 'download', cxcData = null }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  let y = 0

  const logoData = LOGO_LISTA_PRECIOS

  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, 'Reporte Ventas (Cont.)', [255, 255, 255], [0, 0, 0])
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

  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: labelTitle,
    subtitle: `${rango.from} — ${rango.to}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true
  })

  // Watermark
  drawWatermark(doc)

  const kpis = reporte.kpis || {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2. KPIs
  // ══════════════════════════════════════════════════════════════════════════
  const hasDev = kpis.totalDevoluciones > 0 || kpis.totalDevoluciones !== undefined;
  const kpiBoxW = CONTENT_W / (hasDev ? 5 : 4)
  const kpiBoxH = 22
  const kpiData = [
    { label: 'Ventas Netas (Sin Flete)', value: fmtUsd(kpis.totalVentas), sub: '(Solo mercancía)' },
    { label: 'Despachos', value: String(kpis.numDespachos || 0) },
    { label: 'Ticket Promedio', value: fmtUsd(kpis.ticketPromedio) },
    { label: 'Comisiones', value: fmtUsd(kpis.totalComisiones), sub: (kpis.totalComisiones > 0) ? `2%: ${fmtUsd((kpis.comisionCabilla2 || 0) + (kpis.comisionCabilla3 || 0))} | 3%: ${fmtUsd(kpis.comisionOtros || 0)}${(kpis.totalComisionesSplit || 0) > 0 ? ` | Cliente ajeno: ${fmtUsd(kpis.totalComisionesSplit)}` : ''}` : null },
  ]
  if (hasDev) {
    kpiData.push({
      label: 'Devolución de Saldo a Favor',
      value: fmtUsd(kpis.totalDevoluciones || 0),
      sub: kpis.prevTotalDevoluciones ? `Ant: ${fmtUsd(kpis.prevTotalDevoluciones)}` : null
    })
  }

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
    doc.setFontSize(hasDev ? 11.5 : 12.5)
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
      let subSplit = 0;

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
        const vendedorNombre = v.vendedor || '—';
        doc.text(vendedorNombre, MARGIN + 7, y + 4.5);
        
        let curX = MARGIN + 7 + doc.getTextWidth(vendedorNombre);
        if (v.codigo) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(110, 120, 135);
          const codeStr = ` [${String(v.codigo).toUpperCase()}]`;
          doc.text(codeStr, curX, y + 4.5);
          curX += doc.getTextWidth(codeStr);
        }
        if (esVendedorExterno) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(234, 88, 12);
          const extText = (v.markup_pct != null && Number(v.markup_pct) > 0 ? ` (E) (+${v.markup_pct}%)` : ` (E)`);
          doc.text(extText, curX, y + 4.5);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...C_DARK);
        doc.text(fmtUsd(v.totalUsd), MARGIN + 85, y + 4.5);
        doc.text(fmtUsd(v.comision), MARGIN + 125, y + 4.5);
        
        doc.setFont('helvetica', 'normal');
        doc.text(String(v.count || 0), MARGIN + 58, y + 4.5);
        
        if (v.comision > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(71, 85, 105);
          const totalCabilla = (v.comisionCabilla2 || 0) + (v.comisionCabilla3 || 0);
          const parts = [`2%: ${fmtUsd(totalCabilla)}`, `3%: ${fmtUsd(v.comisionOtros || 0)}`];
          if ((v.comisionSplit || 0) > 0) parts.push(`Cliente ajeno: ${fmtUsd(v.comisionSplit)}`);
          doc.text(parts.join(' | '), MARGIN + 125, y + 8.5);
          
          subCabilla += totalCabilla;
          subOtros += (v.comisionOtros || 0);
          subSplit += (v.comisionSplit || 0);
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
        const parts = [`2%: ${fmtUsd(subCabilla)}`, `3%: ${fmtUsd(subOtros)}`];
        if (subSplit > 0) parts.push(`Cliente ajeno: ${fmtUsd(subSplit)}`);
        doc.text(parts.join(' | '), MARGIN + 125, y + 8.5);
      }
      y += 12;
      return { count: subCount, totalUsd: subTotalUsd, comision: subComision, comisionCabilla: subCabilla, comisionOtros: subOtros, comisionSplit: subSplit };
    }

    let rInt = { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0, comisionSplit: 0 };
    let rExt = { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0, comisionSplit: 0 };

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
    const totalSplit = (rInt.comisionSplit || 0) + (rExt.comisionSplit || 0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
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
      const parts = [`2%: ${fmtUsd(totalCabilla)}`, `3%: ${fmtUsd(totalOtros)}`];
      if (totalSplit > 0) parts.push(`Cliente ajeno: ${fmtUsd(totalSplit)}`);
      doc.text(parts.join(' | '), MARGIN + 125, y + 9);
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
        // Encontrar despachos asociados al vendedor actual (incluye 'unassigned')
        const susDespachos = despachosReporte.filter(d => 
          (!d.asesor_id && v.id === 'unassigned') ||
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
        doc.setFontSize(10.5);
        doc.setTextColor(...C_DARK);

        const esVendedorExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
        const vendedorNombre = v.vendedor || '—';

        // Círculo de color
        if (v.vendedorColor) {
          const vc = hexToRgb(v.vendedorColor);
          doc.setFillColor(vc[0], vc[1], vc[2]);
          doc.circle(MARGIN + 3, y + 2.5, 1.8, 'F');
        }
        doc.text(vendedorNombre, MARGIN + 7, y + 3.5);
        let curX = MARGIN + 7 + doc.getTextWidth(vendedorNombre);

        if (v.codigo) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(110, 120, 135);
          const codeStr = ` [${String(v.codigo).toUpperCase()}]`;
          doc.text(codeStr, curX, y + 3.5);
          curX += doc.getTextWidth(codeStr);
        }

        if (esVendedorExterno) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(234, 88, 12);
          const extText = (v.markup_pct != null && Number(v.markup_pct) > 0 ? ` (E) (+${v.markup_pct}%)` : ` (E)`);
          doc.text(extText, curX, y + 3.5);
        }
        y += 7;

        // Cabecera de la sub-tabla de documentos
        doc.setFillColor(242, 244, 247);
        doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9); // Aumentado de 7.5 a 9
        doc.setTextColor(71, 85, 105);
        
        doc.text('Documento / Correlativo', MARGIN + 4, y + 4.5);
        doc.text('Cliente', MARGIN + 52, y + 4.5); // Movido a 52 para evitar colisión
        doc.text('Monto de la Venta (USD)', MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' });
        y += 8;

        // Dibujar transacciones
        susDespachos.forEach((d, dIdx) => {
          y = checkPage(doc, y, 8);

          // Alternar fila
          if (dIdx % 2 === 1) {
            doc.setFillColor(250, 251, 253);
            doc.rect(MARGIN, y - 0.5, CONTENT_W, 7, 'F');
          }

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9); // Aumentado de 7.5 a 9
          doc.setTextColor(51, 65, 85);

          const numDoc = d.despacho_numero ? `#${d.despacho_numero}` : 'S/N';
          const suffixPrestamo = d.es_prestamo_puro 
            ? ' (Préstamo)' 
            : (d.es_prestamo_mixto ? ' (Mixto/Prést.)' : '');
          const cliente = d.cliente_nombre ? String(d.cliente_nombre).toUpperCase() : 'CLIENTE SIN NOMBRE';
          const displayCliente = d.cliente_tipo_cliente === 'personal'
            ? `${cliente} (PERSONAL)`
            : cliente;
          
          // Truncar cliente para seguridad espacial
          const maxChars = 44;
          const truncatedCliente = displayCliente.length > maxChars ? `${displayCliente.substring(0, maxChars)}...` : displayCliente;

          if (d.es_prestamo_puro || d.es_prestamo_mixto) {
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(194, 120, 3); // Tono ámbar/dorado para préstamo
          } else {
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(51, 65, 85);
          }
          const docText = `Doc ${numDoc}${suffixPrestamo}`;
          doc.text(docText, MARGIN + 4, y + 4.5);
          
          if (d.tasa && Number(d.tasa) > 0) {
            const docW = doc.getTextWidth(docText);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(140, 150, 160); // Gris más tenue
            doc.setFontSize(7.5);
            doc.text(` (tasa: ${d.tasa})`, MARGIN + 4 + docW, y + 4.5);
            doc.setFontSize(9); // Restaurar
          }
          
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          doc.text(truncatedCliente, MARGIN + 52, y + 4.5);

          // Totales (Monto) siempre en negrita
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...C_DARK);
          doc.text(fmtUsd(d.venta_neta_usd || 0), MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' });

          y += 6.5;

          // Si tiene productos en préstamo, mostrarlos debajo de la fila del documento
          const prestamosItems = (d.items || []).filter(it => it.es_prestamo);
          if (prestamosItems.length > 0) {
            prestamosItems.forEach(it => {
              y = checkPage(doc, y, 6);
              // Materiales de préstamo también en negrita
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(8); // Aumentado de 6.5 a 8
              doc.setTextColor(71, 85, 105); // Tono gris oscuro muy legible
              const itemText = `      • [PRÉSTAMO] ${Number(it.cantidad).toLocaleString('es-VE')} unds.  ·  ${it.nombre_snap || 'PRODUCTO SIN NOMBRE'}`;
              doc.text(itemText, MARGIN + 8, y + 3.5);
              y += 5;
            });
          }
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
      const pct = fpTotal > 0 ? ((Math.max(0, fp.totalUsd) / fpTotal) * 100).toFixed(1) : '0.0'

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
          const suffixPrestamo = p.es_prestamo_puro 
            ? ' (Préstamo)' 
            : (p.es_prestamo_mixto ? ' (Mixto/Prést.)' : '');
          const cliente = p.cliente ? String(p.cliente).toUpperCase().substring(0, 36) : 'CLIENTE SIN NOMBRE'
          const suffixRef = p.referencia ? ` [Ref: ${p.referencia}]` : ''
          const labelText = `    • Doc ${numDoc}${suffixRef}${suffixPrestamo}  ·  ${cliente}  ·  `

          doc.setFont('helvetica', 'normal')
          doc.text(labelText, MARGIN + 2, y + 2)

          const labelW = doc.getTextWidth(labelText)
          const usdVal = fmtUsd(p.monto)

          // 1. Dibujar monto en USD en negrita
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(...C_DARK)
          doc.text(usdVal, MARGIN + 2 + labelW, y + 2)

          // 2. Dibujar monto en Bs y tasa en color tenue regular al lado
          if (['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && p.montoBs) {
            const usdW = doc.getTextWidth(usdVal)
            const tasaText = p.tasa && Number(p.tasa) > 0 ? ` · Tasa: ${p.tasa}` : ''
            const bsText = `  ·  (${fmtBs(p.montoBs)}${tasaText})`
            
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7.5) // Un poco más pequeño para dar jerarquía
            doc.setTextColor(110, 120, 130) // Color gris tenue
            doc.text(bsText, MARGIN + 2 + labelW + usdW, y + 2)
            doc.setFontSize(8.5) // Restaurar
          }
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
      const hasBsTotal = ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && Array.isArray(fp.pagos)
      const totalBs = hasBsTotal
        ? fp.pagos.reduce((s, p) => s + (Number(p.montoBs) || 0), 0)
        : 0

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(fmtUsd(fp.totalUsd), MARGIN + 80, y + 4)

      if (hasBsTotal && totalBs > 0) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(79, 70, 229) // Indigo 600
        doc.text(`(${fmtBs(totalBs)})`, MARGIN + 80, y + 7.5)
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
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
      y += (hasBsTotal && totalBs > 0) ? 12 : 8.5
      y += 4
    })

    // Fila de Total
    y = checkPage(doc, y, 24)
    doc.setFillColor(240, 244, 250)
    doc.rect(MARGIN, y - 1, CONTENT_W, 22, 'F')

    doc.setDrawColor(180, 190, 210)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)

    const totalFpDespachos = porFormaPago.reduce((s, fp) => s + (fp.count || 0), 0)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C_DARK)
    doc.text(`TOTAL RECAUDADO (${totalFpDespachos} desp.)`, MARGIN + 2, y + 5)
    doc.text(fmtUsd(fpTotal), MARGIN + 80, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('100.0%', MARGIN + 110, y + 5)

    // Separador interno
    doc.setDrawColor(210, 220, 235)
    doc.setLineWidth(0.3)
    doc.line(MARGIN + 2, y + 8, MARGIN + CONTENT_W - 2, y + 8)

    // Divisas total (Efectivo $, Zelle, USDT)
    const totalDivisasUsd = porFormaPago
      .filter(fp => ['Efectivo $', 'Zelle', 'USDT'].includes(fp.formaPago))
      .reduce((s, fp) => s + fp.totalUsd, 0)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Total en Divisas (Efectivo $, Zelle, USDT):', MARGIN + 4, y + 13)
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(totalDivisasUsd), MARGIN + 80, y + 13)

    // Bolívares total (Efectivo Bs, Transf. / Pago Móvil, Punto de Venta)
    const totalBolivaresBs = porFormaPago
      .filter(fp => ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago))
      .reduce((s, fp) => s + (fp.pagos?.reduce((sum, p) => sum + (Number(p.montoBs) || 0), 0) || 0), 0)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(79, 70, 229) // Indigo 600
    doc.text('Total en Bolívares (Efectivo Bs, Transf, P. Venta):', MARGIN + 4, y + 18)
    doc.text(fmtBs(totalBolivaresBs), MARGIN + 80, y + 18)

    doc.setDrawColor(180, 190, 210)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 21, MARGIN + CONTENT_W, y + 21)
    y += 26

    // Bloque de Desglose de Flete / Diferencia
    const fpCxc = porFormaPago.find(fp => fp.formaPago === 'Cta por cobrar');
    const fpCod = porFormaPago.find(fp => fp.formaPago === 'Cobro a destino');
    // Usar el saldo pendiente real (totalDeuda) de cxcData si está disponible,
    // en lugar de la suma de otorgado de porFormaPago, para que el desglose
    // solo reste lo que realmente sigue sin cobrar.
    const totalCxCOtorgado = (fpCxc ? fpCxc.totalUsd : 0) + (fpCod ? fpCod.totalUsd : 0);
    const totalCxC = (cxcData?.kpis?.totalDeuda !== undefined)
      ? cxcData.kpis.totalDeuda
      : totalCxCOtorgado;
    const totalSaldoFavor = porFormaPago
      .filter(fp => String(fp.formaPago || '').toLowerCase() === 'saldo a favor')
      .reduce((s, fp) => s + Number(fp.totalUsd || 0), 0);
    const totalDeducciones = totalCxC + totalSaldoFavor;
    const ventasSinCxc = Math.max(0, fpTotal - totalDeducciones);
    const tieneCxC = totalDeducciones > 0;
    const tieneDev = kpis.totalDevoluciones > 0;
    const boxH = (tieneCxC || tieneDev) ? 28 : 20;

    y = checkPage(doc, y, boxH + 4)
    doc.setFillColor(245, 250, 255)
    doc.setDrawColor(190, 215, 245)
    doc.setLineWidth(0.4)
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_PRIMARY)
    doc.text('DESGLOSE DE LA DIFERENCIA (RECAUDACIÓN VS VENTAS NETAS):', MARGIN + 3.5, y + 7)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    let curX = MARGIN + 3.5
    
    // 1. Ventas Netas
    const lbl1 = 'Ventas Netas: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl1, curX, y + 14)
    curX += doc.getTextWidth(lbl1)
    
    const val1 = fmtUsd(kpis.totalVentas || 0)
    doc.setFont('helvetica', 'bold')
    doc.text(val1, curX, y + 14)
    curX += doc.getTextWidth(val1)
    
    // Separator 1
    const sep1 = '   |   '
    doc.setFont('helvetica', 'normal')
    doc.text(sep1, curX, y + 14)
    curX += doc.getTextWidth(sep1)
    
    // 2. Flete
    const lbl2 = 'Flete: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl2, curX, y + 14)
    curX += doc.getTextWidth(lbl2)
    
    const val2 = fmtUsd(kpis.totalFlete || 0)
    doc.setFont('helvetica', 'bold')
    doc.text(val2, curX, y + 14)
    curX += doc.getTextWidth(val2)
    
    // Separator 2
    const sep2 = '   |   '
    doc.setFont('helvetica', 'normal')
    doc.text(sep2, curX, y + 14)
    curX += doc.getTextWidth(sep2)

    // 2.5 Devoluciones
    if (tieneDev) {
      const lblDev = 'Devoluciones: '
      doc.setFont('helvetica', 'normal')
      doc.text(lblDev, curX, y + 14)
      curX += doc.getTextWidth(lblDev)
      
      const valDev = `-${fmtUsd(kpis.totalDevoluciones)}`
      doc.setFont('helvetica', 'bold')
      doc.text(valDev, curX, y + 14)
      curX += doc.getTextWidth(valDev)

      // Separator Dev
      const sepDev = '   |   '
      doc.setFont('helvetica', 'normal')
      doc.text(sepDev, curX, y + 14)
      curX += doc.getTextWidth(sepDev)
    }
    
    // 3. Total Recaudado
    const lbl3 = 'Total Recaudado: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl3, curX, y + 14)
    curX += doc.getTextWidth(lbl3)
    
    const val3 = fmtUsd(fpTotal)
    doc.setFont('helvetica', 'bold')
    doc.text(val3, curX, y + 14)

    // Linea 2 (solo si tiene CxC o donaciones)
    if (tieneCxC) {
      let curX2 = MARGIN + 3.5;
      
      const lblCxC = totalSaldoFavor > 0 ? 'CxC, COD y Saldo a Favor: ' : 'CxC y COD: ';
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(lblCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(lblCxC)
      
      const valCxC = `-${fmtUsd(totalDeducciones)}`;
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(220, 38, 38)
      doc.text(valCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(valCxC)
      
      doc.setTextColor(...C_DARK)
      const sepCxC = '   |   ';
      doc.setFont('helvetica', 'normal')
      doc.text(sepCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(sepCxC)
      
      const lblSinCxC = 'Ventas Líquidas (Caja Real): ';
      doc.setFont('helvetica', 'normal')
      doc.text(lblSinCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(lblSinCxC)
      
      const valSinCxC = fmtUsd(ventasSinCxc);
      doc.setFont('helvetica', 'bold')
      doc.text(valSinCxC, curX2, y + 21)
    }

    y += boxH + 4
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6.5. DEVOLUCIONES DE SALDO A FAVOR
  // ══════════════════════════════════════════════════════════════════════════
  const devolucionesReporte = reporte.devoluciones || [];
  if (devolucionesReporte.length > 0) {
    y = checkPage(doc, y, 22)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_DARK)
    doc.text('Devoluciones de Saldo a Favor (Reembolsos a Clientes)', MARGIN, y + 4)
    y += 8

    // Tabla header
    doc.setFillColor(242, 244, 247);
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    
    doc.text('Cliente', MARGIN + 4, y + 4.5);
    doc.text('Asesor', MARGIN + 55, y + 4.5);
    doc.text('Fecha', MARGIN + 100, y + 4.5);
    doc.text('Forma de Pago', MARGIN + 122, y + 4.5);
    doc.text('Devuelto ($)', MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' });
    y += 8;

    devolucionesReporte.forEach((dev, idx) => {
      y = checkPage(doc, y, 8)
      if (idx % 2 === 1) {
        doc.setFillColor(250, 251, 253);
        doc.rect(MARGIN, y - 0.5, CONTENT_W, 7, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);

      const cliente = dev.cliente_nombre ? String(dev.cliente_nombre).toUpperCase().substring(0, 28) : 'CLIENTE SIN NOMBRE'
      const displayCliente = dev.cliente_tipo_cliente === 'personal' ? `${cliente} (P)` : cliente
      
      doc.text(displayCliente, MARGIN + 4, y + 4.5)
      doc.text(dev.vendedor_nombre || '—', MARGIN + 55, y + 4.5)
      
      const fechaStr = dev.creado_en ? new Date(dev.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'
      doc.text(fechaStr, MARGIN + 100, y + 4.5)
      doc.text(formatMetodoPago(dev.forma_pago_abono), MARGIN + 122, y + 4.5)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(220, 38, 38) // Rose 600
      doc.text(`-${fmtUsd(dev.monto_usd)}`, MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })

      y += 6.5
    })
    y += 4
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6.7. CUENTAS POR COBRAR Y ABONOS (Al final del reporte de ventas)
  // ══════════════════════════════════════════════════════════════════════════
  if (cxcData) {
    const clientesConDeuda = cxcData.clientesConDeuda || []
    if (clientesConDeuda.length > 0) {
      y = checkPage(doc, y, 22)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(...C_DARK)
      doc.text('Créditos otorgados en el período (saldos pendientes)', MARGIN, y + 4)
      y += 8

      // Tabla cabecera
      doc.setFillColor(242, 244, 247)
      doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(71, 85, 105)
      doc.text('Cliente', MARGIN + 4, y + 4.5)
      doc.text('Vendedor', MARGIN + 80, y + 4.5)
      doc.text('Otorgado ($)', MARGIN + CONTENT_W - 72, y + 4.5, { align: 'right' })
      doc.text('Cobrado ($)', MARGIN + CONTENT_W - 36, y + 4.5, { align: 'right' })
      doc.text('Pendiente ($)', MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })
      y += 8

      let totalDeudaCxc = 0
      let totalOtorgadoCxc = 0
      let totalCobradoCxc = 0
      clientesConDeuda.forEach((c, idx) => {
        const saldo = Number(c.saldo_pendiente || 0)
        const otorgado = Number(c.monto_otorgado || 0)
        const cobrado = Number(c.monto_cobrado || 0)
        totalDeudaCxc += saldo
        totalOtorgadoCxc += otorgado
        totalCobradoCxc += cobrado

        y = checkPage(doc, y, 8)
        if (idx % 2 === 1) {
          doc.setFillColor(250, 251, 253)
          doc.rect(MARGIN, y - 0.5, CONTENT_W, 7, 'F')
        }

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(51, 65, 85)

        const nombre = String(c.nombre || 'SIN NOMBRE').toUpperCase().substring(0, 38)
        doc.text(nombre, MARGIN + 4, y + 4.5)
        doc.text(c.vendedor?.nombre || '—', MARGIN + 80, y + 4.5)

        // Otorgado (gris)
        doc.setTextColor(71, 85, 105)
        doc.text(fmtUsd(otorgado), MARGIN + CONTENT_W - 72, y + 4.5, { align: 'right' })

        // Cobrado (verde)
        doc.setTextColor(22, 163, 74)
        doc.text(fmtUsd(cobrado), MARGIN + CONTENT_W - 36, y + 4.5, { align: 'right' })

        // Pendiente (rojo si > 0, verde si 0)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(saldo > 0.005 ? 220 : 22, saldo > 0.005 ? 38 : 163, saldo > 0.005 ? 38 : 74)
        doc.text(fmtUsd(saldo), MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })
        y += 6.5
      })

      // Fila de total
      y = checkPage(doc, y, 10)
      doc.setDrawColor(210, 215, 225)
      doc.setLineWidth(0.4)
      doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)
      
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text('TOTAL CUENTAS POR COBRAR:', MARGIN + 4, y + 4.5)
      doc.setTextColor(71, 85, 105)
      doc.text(fmtUsd(totalOtorgadoCxc), MARGIN + CONTENT_W - 72, y + 4.5, { align: 'right' })
      doc.setTextColor(22, 163, 74)
      doc.text(fmtUsd(totalCobradoCxc), MARGIN + CONTENT_W - 36, y + 4.5, { align: 'right' })
      doc.setTextColor(220, 38, 38)
      doc.text(fmtUsd(totalDeudaCxc), MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })
      y += 10
      y += 4
    }

    const abonos = cxcData.abonos || []
    if (abonos.length > 0) {
      y = checkPage(doc, y, 22)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(...C_DARK)
      doc.text('Abonos Realizados en el Periodo', MARGIN, y + 4)
      y += 8

      // Tabla cabecera
      doc.setFillColor(242, 244, 247)
      doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(71, 85, 105)
      doc.text('Fecha', MARGIN + 4, y + 4.5)
      doc.text('Cliente', MARGIN + 26, y + 4.5)
      doc.text('Método / Referencia', MARGIN + 101, y + 4.5)
      doc.text('Monto ($)', MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })
      y += 8

      let totalAbonosCxc = 0
      abonos.forEach((a, idx) => {
        const monto = Number(a.monto_usd || 0)
        totalAbonosCxc += monto

        const metodo = formatMetodoPago(a.forma_pago_abono || a.metodo_pago)
        const ref = a.referencia ? ` [Ref: ${a.referencia}]` : ''
        const metodoText = `${metodo}${ref}`

        // Definir ancho seguro para esta columna (desde MARGIN + 101 hasta MARGIN + CONTENT_W - 25 = 177, ancho = 62)
        const maxMetodoWidth = 62
        const lines = doc.splitTextToSize(metodoText, maxMetodoWidth)

        // Calcular altura dinámica basada en la cantidad de líneas
        const lineHeight = 3.5
        const rowHeight = 6.5 + (lines.length - 1) * lineHeight
        const rectHeight = 7 + (lines.length - 1) * lineHeight

        y = checkPage(doc, y, rowHeight + 1.5)
        if (idx % 2 === 1) {
          doc.setFillColor(250, 251, 253)
          doc.rect(MARGIN, y - 0.5, CONTENT_W, rectHeight, 'F')
        }

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(51, 65, 85)

        const fechaStr = a.creado_en ? new Date(a.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'
        doc.text(fechaStr, MARGIN + 4, y + 4.5)

        const cliente = String(a.cliente?.nombre || 'SIN NOMBRE').toUpperCase().substring(0, 38)
        doc.text(cliente, MARGIN + 26, y + 4.5)

        // Dibujar líneas del Método / Referencia
        lines.forEach((line, i) => {
          doc.text(line, MARGIN + 101, y + 4.5 + (i * lineHeight))
        })

        doc.setFont('helvetica', 'bold')
        doc.setTextColor(16, 185, 129) // Emerald 500
        doc.text(fmtUsd(monto), MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })
        y += rowHeight
      })

      // Fila de total
      y = checkPage(doc, y, 10)
      doc.setDrawColor(210, 215, 225)
      doc.setLineWidth(0.4)
      doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)
      
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text('TOTAL ABONOS RECIBIDOS:', MARGIN + 4, y + 4.5)
      doc.setTextColor(...C_EMERALD)
      doc.text(fmtUsd(totalAbonosCxc), MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })
      y += 10
      y += 4
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])

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

  if (action === 'return') {
    return doc;
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
