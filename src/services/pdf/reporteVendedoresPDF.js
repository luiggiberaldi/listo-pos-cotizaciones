// src/services/pdf/reporteVendedoresPDF.js
// Genera PDF profesional del Reporte de Vendedores — solo supervisores/jefes
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  fmtUsd, fmtFecha, hexToRgb, drawWatermark, checkPage, drawPremiumHeader,
} from './pdfShared'

// ─── Utilidades locales ────────────────────────────────────────────────────────
function fmtPct(n) {
  return `${n >= 0 ? '+' : ''}${Number(n || 0).toFixed(1)}%`
}

function drawSectionTitle(doc, text, y) {
  doc.setFillColor(...C_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_WHITE)
  doc.text(text.toUpperCase(), MARGIN + 3, y + 5)
  return y + 11
}

function drawTableHeader(doc, cols, y) {
  doc.setFillColor(240, 242, 248)
  doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(80, 90, 110)
  cols.forEach(({ label, x, align }) => {
    doc.text(label, x, y + 5.0, { align: align || 'left' })
  })
  return y + 9.5
}

// ─── Función principal ─────────────────────────────────────────────────────────
export async function generarReporteVendedoresPDF({ data, config = {}, periodo = {}, tipo = 'completo', vendedorId = null }) {
  let { porVendedor = [] } = data

  let listToUse = porVendedor
  if (tipo === 'internos') {
    listToUse = porVendedor.filter(v => !(v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)))
  } else if (tipo === 'externos') {
    listToUse = porVendedor.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))
  } else if (tipo === 'individual' && vendedorId) {
    listToUse = porVendedor.filter(v => v.id === vendedorId)
  }

  // Calculate local KPIs based on listToUse
  const localTotalVentas = listToUse.reduce((s, v) => s + (v.totalUsd || 0), 0)
  const localTotalDespachos = listToUse.reduce((s, v) => s + (v.numDespachos || 0), 0)
  const localTotalComision = listToUse.reduce((s, v) => s + (v.comisionTotal || 0), 0)
  const localTotalComisionCabilla2 = listToUse.reduce((s, v) => s + (v.comisionCabilla2 || 0), 0)
  const localTotalComisionCabilla3 = listToUse.reduce((s, v) => s + (v.comisionCabilla3 || 0), 0)
  const localTotalComisionOtros = listToUse.reduce((s, v) => s + (v.comisionOtros || 0), 0)
  const localTicketPromedio = localTotalDespachos > 0 ? localTotalVentas / localTotalDespachos : 0

  const localPrevTotalVentas = listToUse.reduce((s, v) => s + (v.prevTotalUsd || 0), 0)
  const localVariacion = localPrevTotalVentas > 0
    ? ((localTotalVentas - localPrevTotalVentas) / localPrevTotalVentas) * 100
    : null

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = 0
  const HDR_H = 40
  const nombreNeg = config.nombre_negocio || config.empresa || 'Mi Empresa'

  // ═══ CABECERA PRINCIPAL ══════════════════════════════════════════════════════
  const reportTitle = tipo === 'internos' 
    ? 'Reporte de Vendedores Internos' 
    : tipo === 'externos' 
    ? 'Reporte de Vendedores Externos' 
    : 'Reporte de Vendedores'
  const rangoLabel = periodo.from && periodo.to
    ? `${fmtFecha(periodo.from)} — ${fmtFecha(periodo.to)}`
    : 'Período seleccionado'

  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: reportTitle,
    subtitle: rangoLabel
  })

  drawWatermark(doc)

  if (tipo === 'completo' || tipo === 'general' || tipo === 'internos' || tipo === 'externos') {
    // ═══ KPIs GLOBALES ══════════════════════════════════════════════════════════
    const kpiBoxW = CONTENT_W / 4
    const kpiBoxH = 22
    
    const kpiBgColors = [
      [245, 247, 250], // Primary tint (navy)
      [240, 248, 245], // Emerald tint (green)
      [240, 246, 255], // Sky blue tint
      [254, 248, 242], // Amber tint
    ]
    const kpiAccentColors = [
      C_PRIMARY,
      C_EMERALD,
      [59, 130, 246],
      C_AMBER,
    ]
    
    const kpiData = [
      { label: 'Ventas del período', value: fmtUsd(localTotalVentas) },
      { label: 'Despachos entregados', value: String(localTotalDespachos) },
      { label: 'Ticket promedio', value: fmtUsd(localTicketPromedio) },
      { label: 'Comisiones generadas', value: fmtUsd(localTotalComision) },
    ]
    
    kpiData.forEach((kpi, i) => {
      const bx = MARGIN + i * kpiBoxW
      const bgColor = kpiBgColors[i]
      const accentColor = kpiAccentColors[i]
      
      // Draw light background
      doc.setFillColor(bgColor[0], bgColor[1], bgColor[2])
      doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 1.5, 1.5, 'F')
      
      // Draw light grey border
      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.2)
      doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 1.5, 1.5, 'D')
      
      // Draw left accent line
      doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2])
      doc.setLineWidth(1.2)
      doc.line(bx + 1.6, y + 1, bx + 1.6, y + kpiBoxH - 1)
      
      // Draw label
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(100, 116, 139)
      doc.text(kpi.label, bx + 4.5, y + 5.5)
      
      // Draw value
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(15, 23, 42)
      doc.text(kpi.value, bx + 4.5, y + 13)
      
      // Draw subtexts
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      if (i === 0) {
        if (localVariacion !== null) {
          const arrow = localVariacion >= 0 ? '+' : ''
          const isGreen = localVariacion >= 0
          doc.setTextColor(isGreen ? 5 : 220, isGreen ? 150 : 38, isGreen ? 105 : 38)
          doc.text(
            `${arrow}${localVariacion.toFixed(1)}% vs periodo anterior`,
            bx + 4.5, y + 18.5
          )
        } else {
          doc.setTextColor(148, 163, 184)
          doc.text('Sin datos anteriores', bx + 4.5, y + 18.5)
        }
      } else if (i === 1) {
        doc.setTextColor(100, 116, 139)
        const vCount = listToUse.length
        doc.text(
          `${vCount} vendedor${vCount !== 1 ? 'es' : ''}`,
          bx + 4.5, y + 18.5
        )
      } else if (i === 2) {
        doc.setTextColor(100, 116, 139)
        doc.text('Por despacho entregado', bx + 4.5, y + 18.5)
      } else if (i === 3) {
        doc.setTextColor(100, 116, 139)
        doc.setFontSize(5.5)
        const catPrincipal = config.comision_categoria_cabilla || 'Cabilla'
        doc.text(
          `${catPrincipal} 2%: ${fmtUsd(localTotalComisionCabilla2)} | 3%: ${fmtUsd(localTotalComisionCabilla3)}`,
          bx + 4.5, y + 18.5
        )
      }
    })
    y += kpiBoxH + 8

  // ═══ TABLA COMPARATIVA DE VENDEDORES ════════════════════════════════════════
  y = drawSectionTitle(doc, 'Comparativo de Vendedores — Período', y)

  const hdrCols = [
    { label: '#',              x: MARGIN + 2,   align: 'left' },
    { label: 'Vendedor',      x: MARGIN + 8,   align: 'left' },
    { label: 'Ventas USD',    x: MARGIN + 92,  align: 'right' },
    { label: '# Desp.',       x: MARGIN + 118, align: 'right' },
    { label: 'Ticket Prom.',  x: MARGIN + 146, align: 'right' },
    { label: 'Tasa Cierre',   x: MARGIN + 172, align: 'right' },
    { label: 'Comisión',      x: MARGIN + 194, align: 'right' },
  ]

  const internos = listToUse.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)))
  const externos = listToUse.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))

  const calcSub = (arr) => {
    let totalUsd = 0
    let numDespachos = 0
    let comisionTotal = 0
    let aceptadas = 0
    let enviadas = 0

    arr.forEach(v => {
      totalUsd += v.totalUsd || 0
      numDespachos += v.numDespachos || 0
      comisionTotal += v.comisionTotal || 0

      const cots = v.cotizaciones || {}
      const env = (cots.enviada || 0) + (cots.aceptada || 0) + (cots.rechazada || 0)
      enviadas += env
      aceptadas += cots.aceptada || 0
    })

    const ticketProm = numDespachos > 0 ? totalUsd / numDespachos : 0
    const tasaCierre = enviadas > 0 ? Math.round((aceptadas / enviadas) * 100) : 0
    return { totalUsd, numDespachos, ticketProm, tasaCierre, comisionTotal }
  }

  const subInternos = calcSub(internos)
  const subExternos = calcSub(externos)
  const totalGlobal = calcSub(listToUse)

  const drawVendorsSection = (title, list, subData, isAmber = false) => {
    if (list.length === 0) return

    // Draw Section Header
    y = checkPage(doc, y, 15, null, 20)
    if (y < HDR_H) y = HDR_H + 6

    doc.setFillColor(isAmber ? 254 : 241, isAmber ? 243 : 245, isAmber ? 199 : 249) // #FEF3C7 or #F1F5F9
    doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(isAmber ? 180 : 70, isAmber ? 83 : 80, isAmber ? 9 : 95)
    doc.text(title.toUpperCase(), MARGIN + 3, y + 4.2)
    y += 6

    // Table Header
    y = drawTableHeader(doc, hdrCols, y)

    const maxVenta = list.length > 0 ? Math.max(...list.map(l => l.totalUsd)) : 1

    list.forEach((v, idx) => {
      y = checkPage(doc, y, 11, null, 20)
      if (y < HDR_H) y = HDR_H + 6

      // Zebra striping
      if (idx % 2 === 0) {
        doc.setFillColor(250, 251, 255)
        doc.rect(MARGIN, y - 1, CONTENT_W, 9, 'F')
      }

      // Dot color del vendedor
      const colorVendedor = isAmber ? '#D97706' : (v.color || '#64748b')
      const vc = hexToRgb(colorVendedor)
      doc.setFillColor(vc[0], vc[1], vc[2])
      doc.circle(MARGIN + 5.5, y + 4.2, 1.0, 'F')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)
      doc.text(String(idx + 1), MARGIN + 2, y + 5.2)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      const labelName = v.nombre || '—'
      const suffix = isAmber ? ' (E)' : ''
      doc.text((labelName + suffix).substring(0, 22), MARGIN + 8, y + 5.2)

      // Barra de progreso mini
      const barW = 35
      const barFill = maxVenta > 0 ? (v.totalUsd / maxVenta) * barW : 0
      doc.setFillColor(226, 232, 240)
      doc.roundedRect(MARGIN + 42, y + 2.7, barW, 2.5, 0.5, 0.5, 'F')
      if (barFill > 0) {
        doc.setFillColor(vc[0], vc[1], vc[2])
        doc.roundedRect(MARGIN + 42, y + 2.7, Math.max(barFill, 1.5), 2.5, 0.5, 0.5, 'F')
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)
      doc.text(fmtUsd(v.totalUsd), MARGIN + 92, y + 5.2, { align: 'right' })

      doc.setFont('helvetica', 'normal')
      doc.text(String(v.numDespachos), MARGIN + 118, y + 5.2, { align: 'right' })
      doc.text(fmtUsd(v.ticketAverage || v.ticketPromedio), MARGIN + 146, y + 5.2, { align: 'right' })

      // Tasa de cierre con color
      const tasaColor = v.tasaCierre >= 60 ? C_EMERALD : v.tasaCierre >= 35 ? C_AMBER : C_RED
      doc.setTextColor(tasaColor[0], tasaColor[1], tasaColor[2])
      doc.setFont('helvetica', 'bold')
      doc.text(`${v.tasaCierre}%`, MARGIN + 172, y + 5.2, { align: 'right' })

      doc.setTextColor(...C_DARK)
      doc.setFont('helvetica', 'normal')
      doc.text(fmtUsd(v.comisionTotal), MARGIN + 194, y + 5.2, { align: 'right' })

      y += 9
    })

    // Subtotal Row
    y = checkPage(doc, y, 11, null, 20)
    if (y < HDR_H) y = HDR_H + 6

    doc.setFillColor(isAmber ? 254 : 248, isAmber ? 249 : 250, isAmber ? 245 : 252)
    doc.rect(MARGIN, y - 1, CONTENT_W, 9, 'F')
    doc.setDrawColor(220, 226, 235)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)
    doc.line(MARGIN, y + 8, MARGIN + CONTENT_W, y + 8)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(isAmber ? 180 : 70, isAmber ? 83 : 80, isAmber ? 9 : 95)
    doc.text(`SUBTOTAL ${isAmber ? 'EXTERNOS' : 'INTERNOS'}`, MARGIN + 8, y + 5.2)

    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(subData.totalUsd), MARGIN + 92, y + 5.2, { align: 'right' })
    doc.text(String(subData.numDespachos), MARGIN + 118, y + 5.2, { align: 'right' })
    doc.text(fmtUsd(subData.ticketProm), MARGIN + 146, y + 5.2, { align: 'right' })

    const subTasaColor = subData.tasaCierre >= 60 ? C_EMERALD : subData.tasaCierre >= 35 ? C_AMBER : C_RED
    doc.setTextColor(subTasaColor[0], subTasaColor[1], subTasaColor[2])
    doc.text(`${subData.tasaCierre}%`, MARGIN + 172, y + 5.2, { align: 'right' })

    doc.setTextColor(5, 150, 105)
    doc.text(fmtUsd(subData.comisionTotal), MARGIN + 194, y + 5.2, { align: 'right' })

    y += 13
  }

  // Draw Internos
  drawVendorsSection('Vendedores Internos', internos, subInternos, false)

  // Draw Externos
  drawVendorsSection('Vendedores Externos', externos, subExternos, true)

  // Consolidated Grand Total Row
  if (listToUse.length > 0 && (tipo === 'general' || tipo === 'completo')) {
    y = checkPage(doc, y, 12, null, 20)
    if (y < HDR_H) y = HDR_H + 6

    doc.setFillColor(230, 235, 245)
    doc.rect(MARGIN, y - 1, CONTENT_W, 10, 'F')
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.6)
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)
    doc.line(MARGIN, y + 9, MARGIN + CONTENT_W, y + 9)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_PRIMARY)
    doc.text('TOTAL GENERAL', MARGIN + 8, y + 5.8)

    doc.setTextColor(...C_DARK)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(totalGlobal.totalUsd), MARGIN + 92, y + 5.8, { align: 'right' })
    doc.text(String(totalGlobal.numDespachos), MARGIN + 118, y + 5.8, { align: 'right' })
    doc.text(fmtUsd(totalGlobal.ticketProm), MARGIN + 146, y + 5.8, { align: 'right' })

    const totalTasaColor = totalGlobal.tasaCierre >= 60 ? C_EMERALD : totalGlobal.tasaCierre >= 35 ? C_AMBER : C_RED
    doc.setTextColor(totalTasaColor[0], totalTasaColor[1], totalTasaColor[2])
    doc.text(`${totalGlobal.tasaCierre}%`, MARGIN + 172, y + 5.8, { align: 'right' })

    doc.setTextColor(5, 150, 105)
    doc.text(fmtUsd(totalGlobal.comisionTotal), MARGIN + 194, y + 5.8, { align: 'right' })

    y += 14
  }

  } // Fin if general/completo

  if (tipo === 'completo' || tipo === 'individual' || tipo === 'general' || tipo === 'internos' || tipo === 'externos') {
  // ═══ PERFIL DETALLADO POR VENDEDOR ══════════════════════════════════════════
  listToUse.forEach((v) => {
    y = checkPage(doc, y, 60, null, 20)
    if (y < HDR_H) y = HDR_H + 6

    // ── Encabezado del vendedor ──────────────────────────────────────────────
    const esExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)
    const colorVendedor = esExterno ? '#D97706' : (v.color || '#3B82F6')
    const vc = hexToRgb(colorVendedor)
    doc.setFillColor(vc[0], vc[1], vc[2])
    doc.roundedRect(MARGIN, y, CONTENT_W, 10, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...C_WHITE)

    const displayNombre = (v.nombre || 'Sin nombre') + (esExterno ? ' (E)' : '')
    doc.text(displayNombre, MARGIN + 5, y + 7)

    if (esExterno) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setFillColor(254, 243, 199)
      const labelText = v.markup_pct > 0 ? `EXTERNO +${v.markup_pct}%` : 'EXTERNO'
      const badgeW = v.markup_pct > 0 ? 22 : 14
      doc.roundedRect(MARGIN + 120, y + 3, badgeW, 4, 1, 1, 'F')
      doc.setTextColor(180, 83, 9)
      doc.text(labelText, MARGIN + 121.5, y + 5.8)
    }

    // Variación vs período anterior
    if (v.variacionUsd !== null && v.variacionUsd !== undefined) {
      const arrow = v.variacionUsd >= 0 ? '+' : ''
      const varText = `${arrow}${Math.abs(v.variacionUsd).toFixed(1)}% vs periodo anterior`
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...C_WHITE)
      doc.text(varText, PAGE_W - MARGIN - (esExterno ? 30 : 0), y + 6.5, { align: 'right' })
    }
    y += 14

    // ── KPIs del vendedor en fila ─────────────────────────────────────────────
    const vKpis = [
      { label: 'Ventas USD',     value: fmtUsd(v.totalUsd) },
      { label: '# Despachos',    value: String(v.numDespachos) },
      { label: 'Ticket Prom.',   value: fmtUsd(v.ticketPromedio) },
      { label: 'Tasa de Cierre', value: `${v.tasaCierre}%` },
      { label: 'Comisión Total', value: fmtUsd(v.comisionTotal) },
    ]
    const vKpiW = CONTENT_W / vKpis.length
    vKpis.forEach((kpi, i) => {
      const bx = MARGIN + i * vKpiW
      doc.setFillColor(248, 250, 252)
      doc.roundedRect(bx + 0.5, y, vKpiW - 1, 15, 1.5, 1.5, 'F')
      doc.setDrawColor(220, 226, 235)
      doc.setLineWidth(0.3)
      doc.roundedRect(bx + 0.5, y, vKpiW - 1, 15, 1.5, 1.5, 'S')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(120, 130, 145)
      doc.text(kpi.label, bx + vKpiW / 2, y + 5.5, { align: 'center' })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(kpi.value, bx + vKpiW / 2, y + 12, { align: 'center' })
    })
    y += 19

    // ── Cotizaciones desglose + Comisiones ────────────────────────────────────
    const col2W = CONTENT_W / 2 - 2

    // Bloque izquierdo: Cotizaciones por estado
    doc.setFillColor(250, 251, 255)
    doc.roundedRect(MARGIN, y, col2W, 38, 1.5, 1.5, 'F')
    doc.setDrawColor(235, 240, 248)
    doc.setLineWidth(0.2)
    doc.roundedRect(MARGIN, y, col2W, 38, 1.5, 1.5, 'D')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)
    doc.text('Cotizaciones', MARGIN + 3, y + 6)
    const estados = [
      { key: 'borrador',  label: 'Borradores', color: [148, 163, 184] },
      { key: 'enviada',   label: 'Enviadas',   color: [59, 130, 246] },
      { key: 'aceptada',  label: 'Aceptadas',  color: C_EMERALD },
      { key: 'rechazada', label: 'Rechazadas', color: C_RED },
      { key: 'anulada',   label: 'Anuladas',   color: C_GRAY },
    ]
    const totalCots = v.cotizaciones.total || 1
    estados.forEach((e, ei) => {
      const count = v.cotizaciones[e.key] || 0
      const pct = ((count / totalCots) * 100).toFixed(0)
      const ey = y + 10 + ei * 5.2
      doc.setFillColor(e.color[0], e.color[1], e.color[2])
      doc.roundedRect(MARGIN + 3, ey, 2.5, 2.5, 0.5, 0.5, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(`${e.label}: ${count} (${pct}%)`, MARGIN + 8, ey + 2)
      const bX = MARGIN + 40
      const bW = col2W - 43
      doc.setFillColor(226, 232, 240)
      doc.roundedRect(bX, ey, bW, 2.5, 0.5, 0.5, 'F')
      if (Number(pct) > 0) {
        doc.setFillColor(e.color[0], e.color[1], e.color[2])
        doc.roundedRect(bX, ey, Math.max((bW * Number(pct)) / 100, 1), 2.5, 0.5, 0.5, 'F')
      }
    })

    // Bloque derecho: Comisiones
    const bx2 = MARGIN + col2W + 4
    doc.setFillColor(250, 251, 255)
    doc.roundedRect(bx2, y, col2W, 38, 1.5, 1.5, 'F')
    doc.setDrawColor(235, 240, 248)
    doc.setLineWidth(0.2)
    doc.roundedRect(bx2, y, col2W, 38, 1.5, 1.5, 'D')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)
    doc.text('Comisiones', bx2 + 3, y + 6)
    const catPrincipal = config.comision_categoria_cabilla || 'Cabilla'
    const labelPrincipal = esExterno ? `${catPrincipal}/Cem` : catPrincipal
    const comData = [
      { label: 'Total generado', value: fmtUsd(v.comisionTotal), color: C_DARK },
      { label: 'Pagado',         value: fmtUsd(v.comisionPagada), color: C_EMERALD },
      { label: 'Pendiente',      value: fmtUsd(v.comisionPendiente), color: C_AMBER },
      { label: `${labelPrincipal} 2%`,     value: fmtUsd(v.comisionCabilla2 || 0), color: C_DARK },
      { label: `${labelPrincipal} 3%`,     value: fmtUsd(v.comisionCabilla3 || 0), color: C_DARK },
      { label: 'Otros productos',value: fmtUsd(v.comisionOtros || 0), color: C_DARK },
    ]
    comData.forEach((c, ci) => {
      const cy = y + 10 + ci * 4.8
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 110, 125)
      doc.text(c.label, bx2 + 3, cy)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(c.color[0], c.color[1], c.color[2])
      doc.text(c.value, bx2 + col2W - 3, cy, { align: 'right' })
    })
    y += 42

    // ── Top Clientes + Top Productos ──────────────────────────────────────────
    const col3W = (CONTENT_W - 4) / 2

    if (v.topClientes.length > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_DARK)
      doc.text('Top Clientes', MARGIN, y + 4)
      y += 7
      v.topClientes.forEach((c, ci) => {
        y = checkPage(doc, y, 7, null, 20)
        if (ci % 2 === 0) {
          doc.setFillColor(250, 251, 255)
          doc.rect(MARGIN, y - 0.5, col3W, 6, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...C_DARK)
        doc.text(`${ci + 1}. ${(c.nombre || '—').toUpperCase().substring(0, 28)}`, MARGIN + 2, y + 4)
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(c.totalUsd), MARGIN + col3W - 2, y + 4, { align: 'right' })
        y += 6
      })
    }

    if (v.topProductos.length > 0) {
      y = checkPage(doc, y, 11, null, 20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_DARK)
      doc.text('Top Productos', MARGIN, y + 4)
      y += 7
      v.topProductos.forEach((p, pi) => {
        y = checkPage(doc, y, 7, null, 20)
        if (pi % 2 === 0) {
          doc.setFillColor(250, 251, 255)
          doc.rect(MARGIN, y - 0.5, CONTENT_W, 6, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...C_DARK)
        doc.text(`${pi + 1}. ${(p.nombre || '—').substring(0, 40)}`, MARGIN + 2, y + 4)
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(p.totalUsd), CONTENT_W + MARGIN - 2, y + 4, { align: 'right' })
        doc.setFont('helvetica', 'normal')
        doc.text(`${p.unidades} und`, CONTENT_W + MARGIN - 30, y + 4, { align: 'right' })
        y += 6
      })
    }

    // ── Historial de despachos (últimos) ──────────────────────────────────────
    if (v.historial.length > 0) {
      y = checkPage(doc, y, 16, null, 20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_DARK)
      doc.text('Historial de Despachos del Período', MARGIN, y + 4)
      y += 8

      const hCols = [
        { label: 'Fecha',   x: MARGIN + 2,  align: 'left' },
        { label: 'Nº Desp.', x: MARGIN + 22,  align: 'left' },
        { label: 'Cliente', x: MARGIN + 42,  align: 'left' },
        { label: 'Estado',  x: MARGIN + 105, align: 'left' },
        { label: 'Pago',    x: MARGIN + 128, align: 'left' },
        { label: 'Total',   x: CONTENT_W + MARGIN - 2, align: 'right' },
      ]
      y = drawTableHeader(doc, hCols, y)

      v.historial.slice(0, 10).forEach((h, hi) => {
        y = checkPage(doc, y, 7.5, null, 20)
        if (hi % 2 === 0) {
          doc.setFillColor(252, 252, 253)
          doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...C_DARK)
        doc.text(fmtFecha(h.fecha, 'short'), MARGIN + 2, y + 4)

        const numStr = h.numero ? String(h.numero).padStart(5, '0') : '—'
        doc.text(numStr, MARGIN + 22, y + 4)

        doc.text((h.cliente || '—').toUpperCase().substring(0, 30), MARGIN + 42, y + 4)

        const estStr = h.estado === 'despachada' ? 'Aprobado' : h.estado === 'entregada' ? 'Entregado' : (h.estado || '—')
        const estColor = h.estado === 'entregada' ? C_EMERALD : [58, 99, 168]
        doc.setTextColor(estColor[0], estColor[1], estColor[2])
        doc.setFont('helvetica', 'bold')
        doc.text(estStr, MARGIN + 105, y + 4)

        doc.setTextColor(...C_DARK)
        doc.setFont('helvetica', 'normal')
        const pagoStr = Array.isArray(h.formaPago) && h.formaPago.length > 0
          ? [...new Set(h.formaPago.map(fp => fp.metodo || '—'))].join('+')
          : '—'
        doc.text(pagoStr.substring(0, 18), MARGIN + 128, y + 4)

        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(h.totalUsd), CONTENT_W + MARGIN - 2, y + 4, { align: 'right' })
        y += 6.5
      })
    }

    y += 12
  })
  } // Fin if individual/completo

  // ═══ FOOTER EN TODAS LAS PÁGINAS ════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    doc.text(nombreNeg, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')} — CONFIDENCIAL`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }

  let safeName = `Reporte_Vendedores_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  if (tipo === 'individual' && listToUse.length > 0) {
    const nombreVend = listToUse[0].nombre?.replace(/\s+/g, '_') || 'Vendedor'
    safeName = `Reporte_${nombreVend}_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  } else if (tipo === 'general' || tipo === 'completo') {
    safeName = `Reporte_General_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  } else if (tipo === 'internos') {
    safeName = `Reporte_Vendedores_Internos_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  } else if (tipo === 'externos') {
    safeName = `Reporte_Vendedores_Externos_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  }
  doc.save(safeName)
}
