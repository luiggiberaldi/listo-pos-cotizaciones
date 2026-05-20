// src/services/pdf/reporteVendedoresPDF.js
// Genera PDF profesional del Reporte de Vendedores — solo supervisores/jefes
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  fmtUsd, fmtFecha, hexToRgb, drawWatermark, checkPage,
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
  doc.rect(MARGIN, y, CONTENT_W, 6.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(80, 90, 110)
  cols.forEach(({ label, x, align }) => {
    doc.text(label, x, y + 4.5, { align: align || 'left' })
  })
  return y + 8
}

// ─── Función principal ─────────────────────────────────────────────────────────
export async function generarReporteVendedoresPDF({ data, config = {}, periodo = {}, tipo = 'completo', vendedorId = null }) {
  let { porVendedor = [], kpis = {} } = data
  if (tipo === 'individual' && vendedorId) {
    porVendedor = porVendedor.filter(v => v.id === vendedorId)
  }
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = 0

  const nombreNeg = (() => {
    let n = config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.'
    if (!n || n.trim().toUpperCase() === 'PRUEBA' || !n.trim()) n = 'CONSTRUACERO CARABOBO C.A.'
    return n
  })()

  // ═══ CABECERA PRINCIPAL ══════════════════════════════════════════════════════
  const HDR_H = 36
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Patrón decorativo esquina derecha
  const hazW = 40, hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_PRIMARY)
  for (let k = 0; k < 15; k++) doc.line(hazX + k * 4, 0, hazX + k * 4 - 8, 14)

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 8, 3, 30, 30) } catch (_) {}
  }

  const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
  const partes = nombreNeg.split(' ')
  doc.setFont('times', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C_WHITE)
  doc.text((partes[0] || '').toUpperCase(), textCenterX, 14, { align: 'center' })
  if (partes.length > 1) {
    doc.setFontSize(12)
    doc.text(partes.slice(1).join(' ').toUpperCase(), textCenterX, 21, { align: 'center' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('REPORTE DE VENDEDORES', PAGE_W - MARGIN, HDR_H - 8, { align: 'right' })
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  const rangoLabel = periodo.from && periodo.to
    ? `${fmtFecha(periodo.from)} — ${fmtFecha(periodo.to)}`
    : 'Período seleccionado'
  doc.text(rangoLabel, PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  y = HDR_H + 6
  drawWatermark(doc)

  if (tipo === 'completo' || tipo === 'general') {
    // ═══ KPIs GLOBALES ══════════════════════════════════════════════════════════
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 18
  const kpiData = [
    { label: 'Ventas del período', value: fmtUsd(kpis.totalVentas), color: C_PRIMARY },
    { label: 'Despachos entregados', value: String(kpis.totalDespachos), color: C_EMERALD },
    { label: 'Ticket promedio', value: fmtUsd(kpis.ticketPromedioGlobal), color: [59, 130, 246] },
    { label: 'Comisiones generadas', value: fmtUsd(kpis.totalComision), color: C_AMBER },
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
    if (kpis.variacionGlobal !== null && i === 0) {
      const variacion = kpis.variacionGlobal
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      const arrow = variacion >= 0 ? '+' : ''
      doc.text(
        `${arrow}${variacion.toFixed(1)}% vs periodo anterior`,
        bx + 4, y + 16.5
      )
    }
    if (i === 3) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(
        `2%: ${fmtUsd((kpis.totalComisionCabilla2 || 0) + (kpis.totalComisionCabilla3 || 0))} | 3%: ${fmtUsd(kpis.totalComisionOtros || 0)}`,
        bx + 4, y + 16.5
      )
    }
  })
  y += kpiBoxH + 10

  // ═══ TABLA COMPARATIVA DE VENDEDORES ════════════════════════════════════════
  y = drawSectionTitle(doc, 'Comparativo de Vendedores — Período', y)

  const hdrCols = [
    { label: '#',              x: MARGIN + 3,   align: 'left' },
    { label: 'Vendedor',      x: MARGIN + 10,  align: 'left' },
    { label: 'Ventas USD',    x: MARGIN + 70,  align: 'right' },
    { label: '# Desp.',       x: MARGIN + 100, align: 'right' },
    { label: 'Ticket Prom.',  x: MARGIN + 124, align: 'right' },
    { label: 'Tasa Cierre',   x: MARGIN + 152, align: 'right' },
    { label: 'Comisión',      x: MARGIN + 177, align: 'right' },
  ]
  y = drawTableHeader(doc, hdrCols, y)

  const maxVenta = porVendedor.length > 0 ? porVendedor[0].totalUsd : 1

  porVendedor.forEach((v, idx) => {
    y = checkPage(doc, y, 12, null, 20)
    if (y < HDR_H) y = HDR_H + 6

    // Zebra striping
    if (idx % 2 === 0) {
      doc.setFillColor(250, 251, 255)
      doc.rect(MARGIN, y - 1, CONTENT_W, 8, 'F')
    }

    // Dot color del vendedor
    if (v.color) {
      const vc = hexToRgb(v.color)
      doc.setFillColor(vc[0], vc[1], vc[2])
      doc.circle(MARGIN + 3.5, y + 2.5, 1.8, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(String(idx + 1), MARGIN + 3, y + 3.5, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.text((v.nombre || '—').substring(0, 25), MARGIN + 10, y + 3.5)

    // Barra de progreso mini
    const barW = 35
    const barFill = maxVenta > 0 ? (v.totalUsd / maxVenta) * barW : 0
    doc.setFillColor(226, 232, 240)
    doc.roundedRect(MARGIN + 33, y + 2, barW, 2.5, 0.5, 0.5, 'F')
    if (barFill > 0) {
      const vc = v.color ? hexToRgb(v.color) : C_PRIMARY
      doc.setFillColor(vc[0], vc[1], vc[2])
      doc.roundedRect(MARGIN + 33, y + 2, Math.max(barFill, 1.5), 2.5, 0.5, 0.5, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(v.totalUsd), MARGIN + 70, y + 3.5, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.text(String(v.numDespachos), MARGIN + 100, y + 3.5, { align: 'right' })
    doc.text(fmtUsd(v.ticketPromedio), MARGIN + 124, y + 3.5, { align: 'right' })

    // Tasa de cierre con color
    const tasaColor = v.tasaCierre >= 60 ? C_EMERALD : v.tasaCierre >= 35 ? C_AMBER : C_RED
    doc.setTextColor(tasaColor[0], tasaColor[1], tasaColor[2])
    doc.setFont('helvetica', 'bold')
    doc.text(`${v.tasaCierre}%`, MARGIN + 152, y + 3.5, { align: 'right' })

    doc.setTextColor(...C_DARK)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(v.comisionTotal), MARGIN + 177, y + 3.5, { align: 'right' })

    y += 8
  })
  y += 6
  } // Fin if general/completo

  if (tipo === 'completo' || tipo === 'individual') {
  // ═══ PERFIL DETALLADO POR VENDEDOR ══════════════════════════════════════════
  porVendedor.forEach((v) => {
    y = checkPage(doc, y, 60, null, 20)
    if (y < HDR_H) y = HDR_H + 6

    // ── Encabezado del vendedor ──────────────────────────────────────────────
    const vc = v.color ? hexToRgb(v.color) : C_PRIMARY
    doc.setFillColor(vc[0], vc[1], vc[2])
    doc.roundedRect(MARGIN, y, CONTENT_W, 10, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...C_WHITE)
    doc.text(v.nombre || 'Sin nombre', MARGIN + 5, y + 7)

    // Variación vs período anterior
    if (v.variacionUsd !== null && v.variacionUsd !== undefined) {
      const arrow = v.variacionUsd >= 0 ? '+' : ''
      const varText = `${arrow}${Math.abs(v.variacionUsd).toFixed(1)}% vs periodo anterior`
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(varText, PAGE_W - MARGIN, y + 6, { align: 'right' })
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
      doc.roundedRect(bx + 0.5, y, vKpiW - 1, 13, 1.5, 1.5, 'F')
      doc.setDrawColor(220, 226, 235)
      doc.setLineWidth(0.3)
      doc.roundedRect(bx + 0.5, y, vKpiW - 1, 13, 1.5, 1.5, 'S')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(120, 130, 145)
      doc.text(kpi.label, bx + vKpiW / 2, y + 5, { align: 'center' })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...C_DARK)
      doc.text(kpi.value, bx + vKpiW / 2, y + 10.5, { align: 'center' })
    })
    y += 17

    // ── Cotizaciones desglose + Comisiones ────────────────────────────────────
    const col2W = CONTENT_W / 2 - 2

    // Bloque izquierdo: Cotizaciones por estado
    doc.setFillColor(250, 251, 255)
    doc.roundedRect(MARGIN, y, col2W, 34, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text('Cotizaciones', MARGIN + 3, y + 6)
    const estados = [
      { key: 'enviada',   label: 'Enviadas',   color: [59, 130, 246] },
      { key: 'aceptada',  label: 'Aceptadas',  color: C_EMERALD },
      { key: 'rechazada', label: 'Rechazadas', color: C_RED },
      { key: 'anulada',   label: 'Anuladas',   color: C_GRAY },
    ]
    const totalCots = v.cotizaciones.total || 1
    estados.forEach((e, ei) => {
      const count = v.cotizaciones[e.key] || 0
      const pct = ((count / totalCots) * 100).toFixed(0)
      const ey = y + 11 + ei * 4
      doc.setFillColor(e.color[0], e.color[1], e.color[2])
      doc.roundedRect(MARGIN + 3, ey, 2.5, 2.5, 0.5, 0.5, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(...C_DARK)
      doc.text(`${e.label}: ${count} (${pct}%)`, MARGIN + 8, ey + 2)
      const bX = MARGIN + 45
      const bW = col2W - 48
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
    doc.roundedRect(bx2, y, col2W, 34, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text('Comisiones', bx2 + 3, y + 6)
    const comData = [
      { label: 'Total generado', value: fmtUsd(v.comisionTotal), color: C_DARK },
      { label: 'Pagado',         value: fmtUsd(v.comisionPagada), color: C_EMERALD },
      { label: 'Pendiente',      value: fmtUsd(v.comisionPendiente), color: C_AMBER },
      { label: 'Comisión 2%', value: fmtUsd((v.comisionCabilla2 || 0) + (v.comisionCabilla3 || 0)), color: C_DARK },
      { label: 'Comisión 3%', value: fmtUsd(v.comisionOtros || 0), color: C_DARK },
    ]
    comData.forEach((c, ci) => {
      const cy = y + 10 + ci * 4.5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(100, 110, 125)
      doc.text(c.label, bx2 + 3, cy)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(c.color[0], c.color[1], c.color[2])
      doc.text(c.value, bx2 + col2W - 3, cy, { align: 'right' })
    })
    y += 38

    // ── Top Clientes + Top Productos ──────────────────────────────────────────
    const col3W = (CONTENT_W - 4) / 2

    if (v.topClientes.length > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      doc.text('Top Clientes', MARGIN, y + 4)
      y += 7
      v.topClientes.forEach((c, ci) => {
        y = checkPage(doc, y, 6, null, 20)
        if (ci % 2 === 0) {
          doc.setFillColor(250, 251, 255)
          doc.rect(MARGIN, y - 0.5, col3W, 5, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5.5)
        doc.setTextColor(...C_DARK)
        doc.text(`${ci + 1}. ${(c.nombre || '—').toUpperCase().substring(0, 28)}`, MARGIN + 2, y + 3)
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(c.totalUsd), MARGIN + col3W - 2, y + 3, { align: 'right' })
        y += 5
      })
    }

    if (v.topProductos.length > 0) {
      y = checkPage(doc, y, 10, null, 20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      doc.text('Top Productos', MARGIN, y + 4)
      y += 7
      v.topProductos.forEach((p, pi) => {
        y = checkPage(doc, y, 6, null, 20)
        if (pi % 2 === 0) {
          doc.setFillColor(250, 251, 255)
          doc.rect(MARGIN, y - 0.5, CONTENT_W, 5, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5.5)
        doc.setTextColor(...C_DARK)
        doc.text(`${pi + 1}. ${(p.nombre || '—').substring(0, 40)}`, MARGIN + 2, y + 3)
        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(p.totalUsd), CONTENT_W + MARGIN - 2, y + 3, { align: 'right' })
        doc.setFont('helvetica', 'normal')
        doc.text(`${p.unidades} und`, CONTENT_W + MARGIN - 30, y + 3, { align: 'right' })
        y += 5
      })
    }

    // ── Historial de despachos (últimos) ──────────────────────────────────────
    if (v.historial.length > 0) {
      y = checkPage(doc, y, 15, null, 20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
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
        y = checkPage(doc, y, 6, null, 20)
        if (hi % 2 === 0) {
          doc.setFillColor(252, 252, 253)
          doc.rect(MARGIN, y - 1, CONTENT_W, 5.5, 'F')
        }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(5.5)
        doc.setTextColor(...C_DARK)
        doc.text(fmtFecha(h.fecha, 'short'), MARGIN + 2, y + 3)

        const numStr = h.numero ? String(h.numero).padStart(5, '0') : '—'
        doc.text(numStr, MARGIN + 22, y + 3)

        doc.text((h.cliente || '—').toUpperCase().substring(0, 30), MARGIN + 42, y + 3)

        const estStr = h.estado === 'despachada' ? 'Aprobado' : h.estado === 'entregada' ? 'Entregado' : (h.estado || '—')
        const estColor = h.estado === 'entregada' ? C_EMERALD : [58, 99, 168]
        doc.setTextColor(estColor[0], estColor[1], estColor[2])
        doc.setFont('helvetica', 'bold')
        doc.text(estStr, MARGIN + 105, y + 3)

        doc.setTextColor(...C_DARK)
        doc.setFont('helvetica', 'normal')
        const pagoStr = Array.isArray(h.formaPago) && h.formaPago.length > 0
          ? [...new Set(h.formaPago.map(fp => fp.metodo || '—'))].join('+')
          : '—'
        doc.text(pagoStr.substring(0, 18), MARGIN + 128, y + 3)

        doc.setFont('helvetica', 'bold')
        doc.text(fmtUsd(h.totalUsd), CONTENT_W + MARGIN - 2, y + 3, { align: 'right' })
        y += 5.5
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
  if (tipo === 'individual' && porVendedor.length > 0) {
    const nombreVend = porVendedor[0].nombre?.replace(/\s+/g, '_') || 'Vendedor'
    safeName = `Reporte_${nombreVend}_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  } else if (tipo === 'general') {
    safeName = `Reporte_General_${periodo.from ?? ''}_${periodo.to ?? ''}.pdf`
  }
  doc.save(safeName)
}
