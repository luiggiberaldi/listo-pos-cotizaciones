// src/services/pdf/cxcPDF.js
// Generador de PDF profesional para Reporte de Cuentas por Cobrar (CxC)
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  fmtUsd, fmtFecha, hexToRgb, drawWatermark, checkPage,
  C_PRIMARY, C_ACCENT, drawPremiumHeader, drawSimplifiedHeader
} from './pdfShared'

// Color primario del reporte CxC heredado del corporate design
const C_CXC_PRIMARY = C_PRIMARY
const C_CXC_ACCENT = [241, 245, 249] // slate soft bg

// Helper para dibujar títulos de sección estilizados
function drawSectionTitle(doc, text, y) {
  doc.setFillColor(...C_CXC_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 6.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_WHITE)
  doc.text(text.toUpperCase(), MARGIN + 3, y + 4.5)
  return y + 10
}

// Helper para dibujar cabecera de tablas
function drawTableHeader(doc, cols, y) {
  doc.setFillColor(248, 250, 252) // slate-50
  doc.rect(MARGIN, y, CONTENT_W, 6.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(71, 85, 105) // slate-600
  cols.forEach(({ label, x, align }) => {
    doc.text(label, x, y + 4.5, { align: align || 'left' })
  })
  return y + 8
}

// Clasificación de riesgo de cliente por días sin pago (idéntico al frontend)
function obtenerRiesgo(dias) {
  if (dias <= 30) return { label: 'Al día', color: [16, 185, 129] } // emerald-500
  if (dias <= 60) return { label: 'Moderado', color: [245, 158, 11] } // amber-500
  if (dias <= 90) return { label: 'Alto', color: [239, 68, 68] } // red-500
  return { label: 'Crítico', color: [124, 58, 237] } // purple-600
}

export async function generarReporteCxCPDF({ data, config = {}, action = 'download', tipo = 'detallado' }) {
  const { kpis = {}, clientesConDeuda = [], aging = [] } = data
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = 0
  const HDR_H = 40 // Altura del header premium
  const nombreNeg = config.nombre_negocio || config.empresa || 'Mi Empresa'

  // Callback: header compacto en páginas de continuación (ahorra ~30mm por página)
  const onNewPage = (d) => {
    const y2 = drawSimplifiedHeader(d, logoData, config, 'Reporte CxC (Cont.)')
    drawWatermark(d)
    return y2
  }

  // ═══ CABECERA PRINCIPAL ══════════════════════════════════════════════════════
  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Reporte de Cuentas por Cobrar (CxC)',
    subtitle: `Fecha de Emisión: ${new Date().toLocaleDateString('es-VE')}`
  })

  drawWatermark(doc)

  // ═══ KPIs GENERALES (Resumen Ejecutivo) ══════════════════════════════════════
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 18
  const kpisData = [
    { label: 'Total por cobrar', value: fmtUsd(kpis.totalDeuda), color: C_CXC_PRIMARY },
    { label: 'Clientes con deuda', value: String(kpis.numClientesConDeuda), color: [146, 64, 14] }, // Amber oscuro
    { label: 'Deuda más antigua', value: `${kpis.diasMasAntiguo} días`, color: [30, 58, 138] }, // Navy oscuro
    { label: 'Promedio de deuda', value: fmtUsd(kpis.promedioDeuda), color: [4, 120, 87] }, // Emerald
  ]

  kpisData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    // Fondo blanco con borde gris
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')

    // Barra de color pequeña superior como acento
    doc.setFillColor(...kpi.color)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, 1.5, 0.5, 0.5, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 100, 100) // gris oscuro
    doc.text(kpi.label, bx + 4, y + 7)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(20, 20, 20) // negro
    doc.text(kpi.value, bx + 4, y + 14)
  })

  y += kpiBoxH + 8

  // ═══ TABLA DE ANTIGÜEDAD (AGING BREAKDOWN) ══════════════════════════════════
  y = drawSectionTitle(doc, 'Análisis de Antigüedad de Deuda', y)

  const agingCols = [
    { label: 'Rango de Antigüedad', x: MARGIN + 4,   align: 'left' },
    { label: 'Cargos Activos',     x: MARGIN + 60,  align: 'center' },
    { label: 'Monto Pendiente',    x: MARGIN + 110, align: 'right' },
    { label: '% del Total',        x: MARGIN + 160, align: 'right' },
  ]
  y = drawTableHeader(doc, agingCols, y)

  const totalAgingUsd = aging.reduce((s, a) => s + (a.totalUsd || 0), 0) || 1

  aging.forEach((a, idx) => {
    // Zebra striping
    if (idx % 2 === 0) {
      doc.setFillColor(250, 251, 255)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
    }

    const pct = ((a.totalUsd || 0) / totalAgingUsd) * 100
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text(a.rango, MARGIN + 4, y + 3.5)

    doc.setFont('helvetica', 'normal')
    doc.text(String(a.count), MARGIN + 60, y + 3.5, { align: 'center' })
    doc.text(fmtUsd(a.totalUsd), MARGIN + 110, y + 3.5, { align: 'right' })
    doc.text(`${pct.toFixed(1)}%`, MARGIN + 160, y + 3.5, { align: 'right' })

    // Barra de progreso mini para visualizar el peso
    const barW = 20
    const barFill = (pct / 100) * barW
    doc.setFillColor(226, 232, 240)
    doc.roundedRect(MARGIN + 164, y + 1.2, barW, 2, 0.4, 0.4, 'F')
    if (barFill > 0) {
      // Color progresivo de verde a morado
      const colors = [[16, 185, 129], [245, 158, 11], [239, 68, 68], [124, 58, 237]]
      doc.setFillColor(...colors[idx])
      doc.roundedRect(MARGIN + 164, y + 1.2, Math.max(barFill, 1), 2, 0.4, 0.4, 'F')
    }

    y += 6.5
  })

  y += 6

  // ═══ TABLA DE RESUMEN POR CLIENTES ══════════════════════════════════════════
  y = drawSectionTitle(doc, 'Resumen Consolidado de Créditos por Cliente', y)

  const clientesCols = [
    { label: '#',           x: MARGIN + 2.5, align: 'right' },
    { label: 'Cliente / RIF',x: MARGIN + 8,   align: 'left' },
    { label: 'Vendedor',    x: MARGIN + 65,  align: 'left' },
    { label: 'Riesgo',      x: MARGIN + 105, align: 'center' },
    { label: 'Antigüedad',  x: MARGIN + 126, align: 'center' },
    { label: 'Días Rest.',  x: MARGIN + 154, align: 'center' },
    { label: 'Saldo USD',   x: MARGIN + 185, align: 'right' },
  ]
  y = drawTableHeader(doc, clientesCols, y)

  const maxSaldo = Math.max(...clientesConDeuda.map(c => Number(c.saldo_pendiente || 0)), 1)

  clientesConDeuda.forEach((c, idx) => {
    y = checkPage(doc, y, 9, onNewPage, 22)

    if (idx % 2 === 0) {
      doc.setFillColor(250, 251, 255)
      doc.rect(MARGIN, y - 1, CONTENT_W, 8.5, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(String(idx + 1), MARGIN + 2.5, y + 4.5, { align: 'right' })

    // Cliente y RIF
    doc.setTextColor(...C_DARK)
    doc.setFont('helvetica', 'bold')
    doc.text((c.nombre || '—').substring(0, 34).toUpperCase(), MARGIN + 8, y + 3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.setTextColor(...C_GRAY)
    doc.text(c.rif_cedula || 'S/D', MARGIN + 8, y + 6.5)

    // Barra de saldo mini
    const sUsd = Number(c.saldo_pendiente || 0)
    const sPct = (sUsd / maxSaldo) * 20
    doc.setFillColor(241, 245, 249)
    doc.rect(MARGIN + 8, y + 7.5, 20, 0.5, 'F')
    if (sPct > 0) {
      doc.setFillColor(...C_CXC_PRIMARY)
      doc.rect(MARGIN + 8, y + 7.5, Math.max(sPct, 0.8), 0.5, 'F')
    }

    // Vendedor
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    if (c.vendedor) {
      // Dibujar circulito de color del vendedor
      const vColor = hexToRgb(c.vendedor.color || '#64748b')
      doc.setFillColor(...vColor)
      doc.circle(MARGIN + 66, y + 4, 1.2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.text((c.vendedor.nombre || '—').substring(0, 18), MARGIN + 69, y + 4.5)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.text('—', MARGIN + 69, y + 4.5)
    }

    // Riesgo
    const riesgo = obtenerRiesgo(c.diasSinPago)
    doc.setFillColor(...riesgo.color)
    doc.roundedRect(MARGIN + 92, y + 2, 22, 4.2, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.5)
    doc.setTextColor(...C_WHITE)
    doc.text(riesgo.label.toUpperCase(), MARGIN + 103, y + 5, { align: 'center' })

    // Antigüedad (días sin pago)
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.setFont('helvetica', 'bold')
    doc.text(`${c.diasSinPago ?? 0}d`, MARGIN + 126, y + 4.5, { align: 'center' })

    // Días restantes (con badge)
    if (c.diasRestantes === null) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_GRAY)
      doc.text('—', MARGIN + 154, y + 4.5, { align: 'center' })
    } else {
      let restLabel = ''
      let restColor = [0, 0, 0]
      let restBg = [240, 240, 240]
      
      if (c.diasRestantes < 0) {
        restLabel = `VENCIDO (${Math.abs(c.diasRestantes)}d)`
        restColor = [185, 28, 28] // red-700
        restBg = [254, 226, 226] // red-100
      } else if (c.diasRestantes === 0) {
        restLabel = 'VENCE HOY'
        restColor = [146, 64, 14] // amber-700
        restBg = [254, 243, 199] // amber-100
      } else {
        restLabel = `${c.diasRestantes}d REST.`
        restColor = [4, 120, 87] // emerald-700
        restBg = [209, 250, 229] // emerald-100
      }

      doc.setFillColor(...restBg)
      doc.roundedRect(MARGIN + 141, y + 2.3, 26, 3.8, 0.8, 0.8, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5.2)
      doc.setTextColor(...restColor)
      doc.text(restLabel, MARGIN + 154, y + 5, { align: 'center' })
    }

    // Saldo USD
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_RED)
    doc.text(fmtUsd(c.saldo_pendiente), MARGIN + 185, y + 4.5, { align: 'right' })

    y += 9
  })

  // Total consolidado
  y = checkPage(doc, y, 9, onNewPage, 22)
  doc.setLineWidth(0.4)
  doc.setDrawColor(...C_CXC_PRIMARY)
  doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)
  doc.setFillColor(248, 250, 252)
  doc.rect(MARGIN, y - 1, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_CXC_PRIMARY)
  doc.text('TOTAL CONSOLIDADO', MARGIN + 8, y + 3.8)
  doc.setFontSize(8)
  doc.setTextColor(...C_RED)
  doc.text(fmtUsd(kpis.totalDeuda), MARGIN + 185, y + 3.8, { align: 'right' })

  y += 12

  // ═══ DESGLOSE DETALLADO POR FACTURAS (Reporte Analítico) ════════════════════
  if (tipo === 'detallado') {
    clientesConDeuda.forEach((c) => {
      const cargosActivos = c.cargosActivos || []
      if (cargosActivos.length === 0) return

      y = checkPage(doc, y, 22, onNewPage, 22)

      // Divisor elegante para el cliente
      doc.setFillColor(241, 245, 249) // slate-100
      doc.rect(MARGIN, y, CONTENT_W, 6.5, 'F')
      
      const vColor = c.vendedor ? hexToRgb(c.vendedor.color || '#3b82f6') : C_CXC_PRIMARY
      doc.setFillColor(...vColor)
      doc.rect(MARGIN, y, 2.5, 6.5, 'F') // Indicador de color

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)
      doc.text(`${c.nombre?.toUpperCase()} (${c.rif_cedula || 'S/D'})`, MARGIN + 5, y + 4.5)

      y += 8.5

      // Sub-tabla de facturas pendientes
      const detCols = [
        { label: 'Fecha Emisión',  x: MARGIN + 4,   align: 'left' },
        { label: 'Fecha Vencim.', x: MARGIN + 35,  align: 'left' },
        { label: 'Estatus / Plazo',x: MARGIN + 68,  align: 'left' },
        { label: 'Monto Original', x: MARGIN + 140, align: 'right' },
        { label: 'Saldo Pendiente',x: MARGIN + 185, align: 'right' },
      ]
      y = drawTableHeader(doc, detCols, y)

      cargosActivos.forEach((car, cIdx) => {
        y = checkPage(doc, y, 7.5, onNewPage, 22)

        if (cIdx % 2 === 0) {
          doc.setFillColor(252, 252, 253)
          doc.rect(MARGIN, y - 0.8, CONTENT_W, 6, 'F')
        }

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...C_DARK)
        doc.text(fmtFecha(car.creado_en), MARGIN + 4, y + 3.2)
        doc.text(fmtFecha(car.fecha_vencimiento), MARGIN + 35, y + 3.2)

        // Calcular estatus / plazo
        let estatusStr = '—'
        let estColor = C_DARK
        if (car.fecha_vencimiento) {
          const now = new Date()
          const fv = new Date(car.fecha_vencimiento)
          const diffDays = Math.ceil((fv - now) / (1000 * 60 * 60 * 24))
          
          if (diffDays < 0) {
            estatusStr = `Vencido hace ${Math.abs(diffDays)} días`
            estColor = C_RED
          } else if (diffDays === 0) {
            estatusStr = 'Vence hoy'
            estColor = C_AMBER
          } else {
            estatusStr = `Vence en ${diffDays} días`
            estColor = C_EMERALD
          }
        }
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...estColor)
        doc.text(estatusStr, MARGIN + 68, y + 3.2)

        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...C_DARK)
        doc.text(fmtUsd(car.monto_usd), MARGIN + 140, y + 3.2, { align: 'right' })
        
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...C_RED)
        doc.text(fmtUsd(car.saldo_usd), MARGIN + 185, y + 3.2, { align: 'right' })

        y += 6
      })

      // Sub-total del cliente
      y = checkPage(doc, y, 7.5, onNewPage, 22)
      doc.setLineWidth(0.2)
      doc.setDrawColor(226, 232, 240)
      doc.line(MARGIN, y - 0.5, MARGIN + CONTENT_W, y - 0.5)
      
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_GRAY)
      doc.text(`TOTAL ${c.nombre?.toUpperCase()}`, MARGIN + 4, y + 3.5)
      doc.setFontSize(7)
      doc.setTextColor(...C_RED)
      doc.text(fmtUsd(c.saldo_pendiente), MARGIN + 185, y + 3.5, { align: 'right' })

      y += 10
    })
  }

  // ═══ FOOTER EN TODAS LAS PÁGINAS ════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_CXC_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    doc.text(nombreNeg, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')} — CONFIDENCIAL`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }

  // Guardar o imprimir según acción
  const safeName = `Reporte_CxC_${tipo.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.pdf`
  
  if (action === 'print') {
    doc.autoPrint()
    const blob = doc.output('bloburl')
    window.open(blob, '_blank')
  } else {
    doc.save(safeName)
  }
}
