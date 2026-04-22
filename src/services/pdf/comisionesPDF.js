// src/services/pdf/comisionesPDF.js
// Genera PDF profesional de Reporte de Comisiones — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtFechaCorta(f) {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// ─── Layout y Colores ────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_PRIMARY = [58, 99, 168]
const C_DARK    = [5, 8, 52]
const C_WHITE   = [255, 255, 255]
const C_EMERALD = [4, 120, 87]
const C_AMBER   = [146, 64, 14]
const C_GRAY    = [100, 116, 139]

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return C_DARK
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}

// ─── Chequear salto de página ────────────────────────────────────────────────
function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
    // Watermark en nueva página
    try {
      const gState = new doc.GState({ opacity: 0.06 })
      doc.setGState(gState)
      doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch (_) {}
    return MARGIN + 10
  }
  return y
}

// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
export async function generarComisionesPDF({ comisiones, vendedor = null, resumen = null, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)

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
  const nombreNeg = (config.nombre_negocio || 'CONSTRUACERO CARABOBO').split(' ')
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
  doc.text(fmtFecha(new Date().toISOString()), PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  y = HDR_H + 6

  // Watermark
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

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
  const pendientes = comisiones.filter(c => c.estado === 'pendiente')
  const pagadas = comisiones.filter(c => c.estado === 'pagada')
  const totalPendiente = pendientes.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalPagado = pagadas.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalGeneral = totalPendiente + totalPagado

  // Cuadro resumen
  const boxH = 18
  const boxW = CONTENT_W / 3
  const boxes = [
    { label: 'Total acumulado', value: fmtUsd(totalGeneral), count: `${comisiones.length} comisiones`, color: C_PRIMARY },
    { label: 'Pendiente', value: fmtUsd(totalPendiente), count: `${pendientes.length} por pagar`, color: C_AMBER },
    { label: 'Pagado', value: fmtUsd(totalPagado), count: `${pagadas.length} pagadas`, color: C_EMERALD },
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
  const cols = vendedor
    ? [
        { label: 'Desp.', x: MARGIN, w: 16 },
        { label: 'Cot.', x: MARGIN + 16, w: 14 },
        { label: 'Fecha', x: MARGIN + 30, w: 22 },
        { label: 'Cabilla', x: MARGIN + 52, w: 28 },
        { label: 'Otros', x: MARGIN + 80, w: 28 },
        { label: 'Extras', x: MARGIN + 108, w: 30 },
        { label: 'Total', x: MARGIN + 138, w: 22 },
        { label: 'Estado', x: MARGIN + 160, w: 22 },
      ]
    : [
        { label: 'Vendedor', x: MARGIN, w: 28 },
        { label: 'Desp.', x: MARGIN + 28, w: 14 },
        { label: 'Cot.', x: MARGIN + 42, w: 14 },
        { label: 'Fecha', x: MARGIN + 56, w: 20 },
        { label: 'Cabilla', x: MARGIN + 76, w: 24 },
        { label: 'Otros', x: MARGIN + 100, w: 24 },
        { label: 'Extras', x: MARGIN + 124, w: 22 },
        { label: 'Total', x: MARGIN + 146, w: 20 },
        { label: 'Estado', x: MARGIN + 166, w: 16 },
      ]

  function drawTableHeader(doc, yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    cols.forEach(col => {
      doc.text(col.label, col.x + 1, yPos + 5)
    })
    return yPos + 9
  }

  y = drawTableHeader(doc, y)

  // Filas
  comisiones.forEach((c, idx) => {
    const extras = (c.detalle_extras || []).filter(e => Number(e.monto) > 0)
    const extrasText = extras.length > 0
      ? extras.map(e => `${e.cat}(${e.pct}%): ${fmtUsd(e.comision)}`).join(', ')
      : '—'

    const rowH = 6
    y = checkPage(doc, y, rowH + 2)

    // Re-draw header si es nueva página
    if (y < MARGIN + 12) {
      y = drawTableHeader(doc, y)
    }

    // Fondo alterno
    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)

    if (vendedor) {
      doc.text(`#${c.despacho?.numero ?? '—'}`, cols[0].x + 1, y + 3)
      doc.text(`#${c.cotizacion?.numero ?? '—'}`, cols[1].x + 1, y + 3)
      doc.text(fmtFechaCorta(c.creado_en), cols[2].x + 1, y + 3)

      // Cabilla
      doc.setTextColor(...C_DARK)
      doc.text(`${fmtUsd(c.comision_cabilla)} (${c.pct_cabilla}%)`, cols[3].x + 1, y + 3)

      // Otros
      doc.text(`${fmtUsd(c.comision_otros)} (${c.pct_otros}%)`, cols[4].x + 1, y + 3)

      // Extras
      doc.setFontSize(5.5)
      const extShort = extras.length > 0
        ? extras.map(e => `${fmtUsd(e.comision)}`).join('+')
        : '—'
      doc.text(extShort, cols[5].x + 1, y + 3)
      doc.setFontSize(6.5)

      // Total
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(c.total_comision), cols[6].x + 1, y + 3)

      // Estado
      doc.setFont('helvetica', 'normal')
      const esPend = c.estado === 'pendiente'
      doc.setTextColor(...(esPend ? C_AMBER : C_EMERALD))
      doc.text(esPend ? 'Pendiente' : 'Pagada', cols[7].x + 1, y + 3)
    } else {
      // Con columna vendedor
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6)
      const vName = (c.vendedor?.nombre || '—').split(' ').slice(0, 2).join(' ')
      doc.text(vName, cols[0].x + 1, y + 3)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)

      doc.text(`#${c.despacho?.numero ?? '—'}`, cols[1].x + 1, y + 3)
      doc.text(`#${c.cotizacion?.numero ?? '—'}`, cols[2].x + 1, y + 3)
      doc.text(fmtFechaCorta(c.creado_en), cols[3].x + 1, y + 3)
      doc.text(`${fmtUsd(c.comision_cabilla)}`, cols[4].x + 1, y + 3)
      doc.text(`${fmtUsd(c.comision_otros)}`, cols[5].x + 1, y + 3)

      // Extras
      doc.setFontSize(5.5)
      const extShort = extras.length > 0
        ? extras.map(e => `${fmtUsd(e.comision)}`).join('+')
        : '—'
      doc.text(extShort, cols[6].x + 1, y + 3)
      doc.setFontSize(6.5)

      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(c.total_comision), cols[7].x + 1, y + 3)

      doc.setFont('helvetica', 'normal')
      const esPend = c.estado === 'pendiente'
      doc.setTextColor(...(esPend ? C_AMBER : C_EMERALD))
      doc.setFontSize(6)
      doc.text(esPend ? 'Pend.' : 'Pagada', cols[8].x + 1, y + 3)
    }

    y += rowH
  })

  // Línea final de la tabla
  doc.setDrawColor(210, 215, 225)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DETALLE DE EXTRAS POR COMISIÓN (si hay extras)
  // ══════════════════════════════════════════════════════════════════════════
  const conExtras = comisiones.filter(c => (c.detalle_extras || []).some(e => Number(e.monto) > 0))
  if (conExtras.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Detalle de Categorías Extra', MARGIN, y + 4)
    y += 8

    conExtras.forEach(c => {
      const extras = (c.detalle_extras || []).filter(e => Number(e.monto) > 0)
      y = checkPage(doc, y, 10 + extras.length * 5)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...C_PRIMARY)
      const ref = `Despacho #${c.despacho?.numero ?? '—'} / Cot. #${c.cotizacion?.numero ?? '—'}`
      const vLabel = !vendedor ? ` — ${c.vendedor?.nombre || ''}` : ''
      doc.text(ref + vLabel, MARGIN, y + 3)
      y += 5

      extras.forEach(e => {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...C_DARK)
        doc.text(`  ${e.cat}: Monto ${fmtUsd(e.monto)} × ${e.pct}% = ${fmtUsd(e.comision)}`, MARGIN + 2, y + 3)
        y += 5
      })
      y += 2
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. RESUMEN POR VENDEDOR (si es reporte general)
  // ══════════════════════════════════════════════════════════════════════════
  if (!vendedor) {
    const porVendedor = {}
    comisiones.forEach(c => {
      const vid = c.vendedor_id
      if (!porVendedor[vid]) {
        porVendedor[vid] = {
          nombre: c.vendedor?.nombre || '—',
          color: c.vendedor?.color || '#1B365D',
          total: 0, pendiente: 0, pagado: 0, count: 0,
        }
      }
      const v = porVendedor[vid]
      v.total += Number(c.total_comision || 0)
      v.count++
      if (c.estado === 'pendiente') v.pendiente += Number(c.total_comision || 0)
      else v.pagado += Number(c.total_comision || 0)
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
    doc.text(config.nombre_negocio || 'Construacero Carabobo C.A.', MARGIN, PAGE_H - 10)
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
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
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
  const nombreNeg = (config.nombre_negocio || 'CONSTRUACERO CARABOBO').split(' ')
  doc.text((nombreNeg[0] || '').toUpperCase(), textCenterX, 16, { align: 'center' })
  if (nombreNeg.length > 1) {
    doc.setFontSize(12)
    doc.text(nombreNeg.slice(1).join(' ').toUpperCase(), textCenterX, 23, { align: 'center' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Reporte de Ventas', PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`${rango.from} — ${rango.to}`, PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  y = HDR_H + 6

  // Watermark
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

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
    doc.text(config.nombre_negocio || 'Construacero Carabobo C.A.', MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }

  doc.save(`Reporte_Ventas_${rango.from}_${rango.to}.pdf`)
}
