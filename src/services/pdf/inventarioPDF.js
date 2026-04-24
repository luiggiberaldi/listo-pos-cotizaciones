// src/services/pdf/inventarioPDF.js
// Genera PDF profesional de Reporte de Inventario Valorizado — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// ─── Layout y Colores ────────────────────────────────────────────────────────
const PAGE_W    = 216
const PAGE_H    = 279
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_PRIMARY = [58, 99, 168]
const C_DARK    = [5, 8, 52]
const C_WHITE   = [255, 255, 255]
const C_EMERALD = [4, 120, 87]
const C_AMBER   = [146, 64, 14]
const C_RED     = [185, 28, 28]
const C_GRAY    = [100, 116, 139]

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

// ─── Dibujar cabecera ────────────────────────────────────────────────────────
function drawHeader(doc, logoData, config, titulo) {
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
  doc.text(titulo, PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }), PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  return HDR_H + 6
}

// ─── Dibujar footer en todas las páginas ─────────────────────────────────────
function drawFooter(doc, config) {
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
}

// ─── Generar Reporte de Inventario ──────────────────────────────────────────
export async function generarInventarioPDF({ reporte, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config, 'Inventario Valorizado')

  // Watermark
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  const { kpis, items, productosBajoStock, productosSinMov90, porCategoria } = reporte

  // ═══ KPIs ═══
  const kpiBoxW = kpis.esPrivilegiado ? CONTENT_W / 4 : CONTENT_W / 3
  const kpiBoxH = 18
  const kpiData = [
    { label: 'Total productos', value: String(kpis.totalProductos), color: C_PRIMARY },
    ...(kpis.esPrivilegiado ? [{ label: 'Valor a costo', value: fmtUsd(kpis.totalValorCosto), color: C_EMERALD }] : []),
    { label: 'Valor a precio venta', value: fmtUsd(kpis.totalValorVenta), color: kpis.esPrivilegiado ? C_AMBER : C_EMERALD },
    { label: 'Bajo stock', value: String(kpis.numBajoStock), color: C_RED },
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
  })
  y += kpiBoxH + 8

  // ═══ Tabla principal por categoría ═══
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Resumen por Categoría', MARGIN, y + 4)
  y += 8

  const catCols = kpis.esPrivilegiado
    ? [
        { label: 'Categoría', x: MARGIN, w: 48 },
        { label: 'Productos', x: MARGIN + 48, w: 22 },
        { label: 'Stock', x: MARGIN + 70, w: 25 },
        { label: 'Valor Costo', x: MARGIN + 95, w: 30 },
        { label: 'Valor Venta', x: MARGIN + 125, w: 30 },
        { label: 'Margen', x: MARGIN + 155, w: 27 },
      ]
    : [
        { label: 'Categoría', x: MARGIN, w: 60 },
        { label: 'Productos', x: MARGIN + 60, w: 30 },
        { label: 'Stock', x: MARGIN + 90, w: 40 },
        { label: 'Valor Venta', x: MARGIN + 130, w: 52 },
      ]

  function drawCatHeader(yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    catCols.forEach(col => doc.text(col.label, col.x + 1, yPos + 5))
    return yPos + 9
  }

  y = drawCatHeader(y)

  porCategoria.forEach((cat, idx) => {
    y = checkPage(doc, y, 8)
    if (y < MARGIN + 12) y = drawCatHeader(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text((cat.categoria || '—').substring(0, 25), catCols[0].x + 1, y + 3)
    doc.text(String(cat.count), catCols[1].x + 1, y + 3)
    doc.text(fmtNum(cat.stockTotal), catCols[2].x + 1, y + 3)

    if (kpis.esPrivilegiado) {
      doc.text(fmtUsd(cat.valorCosto), catCols[3].x + 1, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(cat.valorVenta), catCols[4].x + 1, y + 3)
      // Margen
      const margen = cat.valorVenta > 0 && cat.valorCosto > 0
        ? ((cat.valorVenta - cat.valorCosto) / cat.valorVenta * 100).toFixed(1) + '%'
        : '—'
      doc.setTextColor(...(margen !== '—' ? C_EMERALD : C_GRAY))
      doc.text(margen, catCols[5].x + 1, y + 3)
    } else {
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(cat.valorVenta), catCols[3].x + 1, y + 3)
    }

    y += 6
  })

  // Línea total
  doc.setDrawColor(210, 215, 225)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL', MARGIN + 1, y + 3)
  doc.text(String(items.length), catCols[1].x + 1, y + 3)
  if (kpis.esPrivilegiado) {
    doc.text(fmtUsd(kpis.totalValorCosto), catCols[3].x + 1, y + 3)
    doc.text(fmtUsd(kpis.totalValorVenta), catCols[4].x + 1, y + 3)
  } else {
    doc.text(fmtUsd(kpis.totalValorVenta), catCols[3].x + 1, y + 3)
  }
  y += 10

  // ═══ Productos con Stock Bajo ═══
  if (productosBajoStock.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_RED)
    doc.text(`Productos con Stock Bajo (${productosBajoStock.length})`, MARGIN, y + 4)
    y += 8

    const bajoCols = [
      { label: 'Código', x: MARGIN, w: 24 },
      { label: 'Producto', x: MARGIN + 24, w: 68 },
      { label: 'Categoría', x: MARGIN + 92, w: 30 },
      { label: 'Stock', x: MARGIN + 122, w: 20 },
      { label: 'Mínimo', x: MARGIN + 142, w: 20 },
      { label: 'Déficit', x: MARGIN + 162, w: 20 },
    ]

    doc.setFillColor(254, 242, 242)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(127, 29, 29)
    bajoCols.forEach(col => doc.text(col.label, col.x + 1, y + 5))
    y += 9

    productosBajoStock.slice(0, 30).forEach((p, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(255, 249, 249)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...C_DARK)
      doc.text((p.codigo || '—').substring(0, 12), bajoCols[0].x + 1, y + 3)
      doc.text((p.nombre || '—').substring(0, 35), bajoCols[1].x + 1, y + 3)
      doc.text((p.categoria || '—').substring(0, 15), bajoCols[2].x + 1, y + 3)
      doc.text(fmtNum(p.stock_actual), bajoCols[3].x + 1, y + 3)
      doc.text(fmtNum(p.stock_minimo), bajoCols[4].x + 1, y + 3)
      doc.setTextColor(...C_RED)
      doc.setFont('helvetica', 'bold')
      const deficit = Number(p.stock_minimo) - Number(p.stock_actual)
      doc.text(fmtNum(deficit > 0 ? deficit : 0), bajoCols[5].x + 1, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Productos sin Movimiento (90+ días) ═══
  if (productosSinMov90.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_AMBER)
    doc.text(`Productos sin Movimiento 90+ días (${productosSinMov90.length})`, MARGIN, y + 4)
    y += 8

    const sinMovCols = [
      { label: 'Código', x: MARGIN, w: 24 },
      { label: 'Producto', x: MARGIN + 24, w: 60 },
      { label: 'Categoría', x: MARGIN + 84, w: 30 },
      { label: 'Stock', x: MARGIN + 114, w: 20 },
      { label: 'Valor USD', x: MARGIN + 134, w: 28 },
      { label: 'Días', x: MARGIN + 162, w: 20 },
    ]

    doc.setFillColor(255, 251, 235)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(113, 63, 18)
    sinMovCols.forEach(col => doc.text(col.label, col.x + 1, y + 5))
    y += 9

    productosSinMov90.sort((a, b) => b.valorVenta - a.valorVenta).slice(0, 30).forEach((p, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(255, 252, 245)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...C_DARK)
      doc.text((p.codigo || '—').substring(0, 12), sinMovCols[0].x + 1, y + 3)
      doc.text((p.nombre || '—').substring(0, 30), sinMovCols[1].x + 1, y + 3)
      doc.text((p.categoria || '—').substring(0, 15), sinMovCols[2].x + 1, y + 3)
      doc.text(fmtNum(p.stock_actual), sinMovCols[3].x + 1, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(p.valorVenta), sinMovCols[4].x + 1, y + 3)
      doc.setTextColor(...C_AMBER)
      doc.text(String(p.diasSinMov >= 999 ? '90+' : p.diasSinMov), sinMovCols[5].x + 1, y + 3)
      y += 6
    })
  }

  drawFooter(doc, config)
  doc.save(`Inventario_Valorizado_${new Date().toISOString().slice(0, 10)}.pdf`)
}
