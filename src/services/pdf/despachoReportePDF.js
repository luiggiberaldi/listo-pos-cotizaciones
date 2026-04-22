// src/services/pdf/despachoReportePDF.js
// Genera PDF profesional de Reporte de Despachos y Cobranza — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return [5, 8, 52]
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
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
const C_RED     = [185, 28, 28]
const C_GRAY    = [100, 116, 139]

const ESTADO_COLORS = {
  pendiente:   C_AMBER,
  despachada:  C_PRIMARY,
  entregada:   C_EMERALD,
  anulada:     C_GRAY,
}

const FP_COLORS = {
  'Efectivo':         [16, 185, 129],
  'Zelle':            [59, 130, 246],
  'Pago Móvil':       [139, 92, 246],
  'USDT':             [245, 158, 11],
  'Sin especificar':  [148, 163, 184],
}

function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
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

// ─── Generar Reporte de Despachos ───────────────────────────────────────────
export async function generarDespachoReportePDF({ reporte, rango, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = 0

  // ═══ CABECERA ═══
  const HDR_H = 36
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  const hazW = 40, hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_PRIMARY)
  for (let k = 0; k < 15; k++) doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)

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
  doc.text('Despachos y Cobranza', PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
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

  const { kpis, porEstado, porFormaPago, aging, porVendedor, topClientesPendientes } = reporte

  // ═══ KPIs ═══
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 18
  const kpiData = [
    { label: 'Total despachos', value: String(kpis.totalDespachos), color: C_PRIMARY },
    { label: 'Entregados', value: String(kpis.numEntregados), sub: fmtUsd(kpis.montoEntregado), color: C_EMERALD },
    { label: 'Pendientes', value: String(kpis.numPendientes), sub: fmtUsd(kpis.montoPendiente), color: C_AMBER },
    { label: 'Monto pendiente', value: fmtUsd(kpis.montoPendiente), color: C_RED },
  ]

  kpiData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(kpi.label, bx + 4, y + 5.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(kpi.value, bx + 4, y + 13)
    if (kpi.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.text(kpi.sub, bx + 4, y + 16.5)
    }
  })
  y += kpiBoxH + 8

  // ═══ Por Estado ═══
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Despachos por Estado', MARGIN, y + 4)
  y += 8

  const totalDesp = porEstado.reduce((s, e) => s + e.count, 0) || 1
  porEstado.forEach(e => {
    if (e.count === 0) return
    y = checkPage(doc, y, 10)
    const pct = ((e.count / totalDesp) * 100).toFixed(1)
    const eColor = ESTADO_COLORS[e.estado] || C_GRAY

    doc.setFillColor(eColor[0], eColor[1], eColor[2])
    doc.roundedRect(MARGIN, y, 3, 5, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    const label = e.estado.charAt(0).toUpperCase() + e.estado.slice(1)
    doc.text(label, MARGIN + 6, y + 3.5)
    doc.setFont('helvetica', 'normal')
    doc.text(`${e.count} desp.`, MARGIN + 35, y + 3.5)
    doc.text(`${pct}%`, MARGIN + 58, y + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(e.totalUsd), MARGIN + 78, y + 3.5)

    const barX = MARGIN + 110
    const barW = CONTENT_W - 110
    doc.setFillColor(230, 233, 240)
    doc.roundedRect(barX, y + 0.5, barW, 4, 1, 1, 'F')
    const fillW = barW * (Number(pct) / 100)
    if (fillW > 0) {
      doc.setFillColor(eColor[0], eColor[1], eColor[2])
      doc.roundedRect(barX, y + 0.5, Math.max(fillW, 2), 4, 1, 1, 'F')
    }
    y += 8
  })
  y += 4

  // ═══ Formas de Pago ═══
  if (porFormaPago.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Formas de Pago', MARGIN, y + 4)
    y += 8

    const fpTotal = porFormaPago.reduce((s, fp) => s + fp.totalUsd, 0)
    porFormaPago.forEach(fp => {
      y = checkPage(doc, y, 10)
      const pct = fpTotal > 0 ? ((fp.totalUsd / fpTotal) * 100).toFixed(1) : '0.0'
      const color = FP_COLORS[fp.formaPago] || C_GRAY

      doc.setFillColor(color[0], color[1], color[2])
      doc.roundedRect(MARGIN, y, 3, 5, 1, 1, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(`${fp.formaPago} (${fp.count} desp.)`, MARGIN + 6, y + 3.5)
      doc.text(`${pct}%`, MARGIN + 70, y + 3.5)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(fp.totalUsd), MARGIN + 88, y + 3.5)

      const barX = MARGIN + 120
      const barW = CONTENT_W - 120
      doc.setFillColor(230, 233, 240)
      doc.roundedRect(barX, y + 0.5, barW, 4, 1, 1, 'F')
      const fillW = barW * (Number(pct) / 100)
      if (fillW > 0) {
        doc.setFillColor(color[0], color[1], color[2])
        doc.roundedRect(barX, y + 0.5, Math.max(fillW, 2), 4, 1, 1, 'F')
      }
      y += 8
    })
    y += 4
  }

  // ═══ Aging de Pendientes ═══
  if (aging.some(a => a.count > 0)) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Antigüedad — Despachos Pendientes', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Rango', MARGIN + 2, y + 5)
    doc.text('Despachos', MARGIN + 50, y + 5)
    doc.text('Monto Total', MARGIN + 90, y + 5)
    y += 9

    const agingColors = [C_EMERALD, C_AMBER, C_AMBER, C_RED]
    aging.forEach((a, idx) => {
      if (a.count === 0) return
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(a.rango, MARGIN + 2, y + 3)
      doc.text(String(a.count), MARGIN + 55, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...agingColors[idx])
      doc.text(fmtUsd(a.totalUsd), MARGIN + 90, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Por Vendedor ═══
  if (porVendedor.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Despachos por Vendedor', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Vendedor', MARGIN + 2, y + 5)
    doc.text('Total', MARGIN + 50, y + 5)
    doc.text('Entregados', MARGIN + 68, y + 5)
    doc.text('Pendientes', MARGIN + 95, y + 5)
    doc.text('Ventas USD', MARGIN + 120, y + 5)
    doc.text('Pend. USD', MARGIN + 150, y + 5)
    y += 9

    porVendedor.forEach((v, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }

      if (v.color) {
        const vc = hexToRgb(v.color)
        doc.setFillColor(vc[0], vc[1], vc[2])
        doc.circle(MARGIN + 3, y + 2, 1.5, 'F')
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      doc.text((v.nombre || '—').substring(0, 20), MARGIN + 7, y + 3)
      doc.setFont('helvetica', 'normal')
      doc.text(String(v.despachos), MARGIN + 53, y + 3)
      doc.setTextColor(...C_EMERALD)
      doc.text(String(v.entregados), MARGIN + 73, y + 3)
      doc.setTextColor(...C_AMBER)
      doc.text(String(v.pendientes), MARGIN + 100, y + 3)
      doc.setTextColor(...C_DARK)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(v.totalUsd), MARGIN + 120, y + 3)
      doc.setTextColor(...C_RED)
      doc.text(fmtUsd(v.montoPendiente), MARGIN + 150, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Top Clientes con Monto Pendiente ═══
  if (topClientesPendientes.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Clientes con Mayor Monto Pendiente', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Cliente', MARGIN + 2, y + 5)
    doc.text('Despachos pend.', MARGIN + 90, y + 5)
    doc.text('Monto Pendiente', MARGIN + 130, y + 5)
    y += 9

    topClientesPendientes.forEach((c, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text((c.nombre || '—').substring(0, 40), MARGIN + 2, y + 3)
      doc.text(String(c.count), MARGIN + 98, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...C_RED)
      doc.text(fmtUsd(c.totalUsd), MARGIN + 130, y + 3)
      y += 6
    })
  }

  // ═══ FOOTER ═══
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

  doc.save(`Despachos_Cobranza_${rango.from}_${rango.to}.pdf`)
}
