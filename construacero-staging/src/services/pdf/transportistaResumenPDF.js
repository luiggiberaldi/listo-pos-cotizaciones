// src/services/pdf/transportistaResumenPDF.js
// PDF del reporte de transportistas locales — total de fletes, parte del chofer y parte de la empresa.
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_ACCENT, C_GRAY, C_AMBER, C_EMERALD,
  fmtUsd, drawPremiumHeader,
} from './pdfShared'
import { repartoFlete } from '../../utils/flotaReporte'

function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
    try {
      const gState = new doc.GState({ opacity: 0.06 })
      doc.setGState(gState)
      doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch (_) { /* la marca de agua/impresión es opcional */ }
    return MARGIN + 10
  }
  return y
}

function drawHeader(doc, logoData, config) {
  return drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Fletes de Choferes Locales',
    subtitle: `Generado: ${new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`
  })
}

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
    let footName = (config && config.nombre_negocio) || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    doc.text(footName, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }
}

export async function generarTransportistaResumenPDF({ items = [], config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config)

  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) { /* la marca de agua/impresión es opcional */ }

  // KPIs agregados
  // Reparto: chofer = su comisión (fuera de Carabobo); empresa = fletes − chofer.
  const totFlete   = items.reduce((s, t) => s + repartoFlete(t).total, 0)
  const totChofer  = items.reduce((s, t) => s + repartoFlete(t).chofer, 0)
  const totEmpresa = items.reduce((s, t) => s + repartoFlete(t).empresa, 0)
  const totNomina  = items.reduce((s, t) => s + (Number(t.flete_nomina_usd) || 0), 0)

  const kpiBoxH = 14
  const colsKpi = 3
  const colW = CONTENT_W / colsKpi
  const labels = ['Total de fletes', 'Para los choferes', 'Para la empresa']
  const values = [fmtUsd(totFlete), fmtUsd(totChofer), fmtUsd(totEmpresa)]
  const colors = [C_PRIMARY, C_AMBER, C_EMERALD]

  doc.setFillColor(240, 242, 245)
  doc.roundedRect(MARGIN, y, CONTENT_W, kpiBoxH, 2, 2, 'F')
  for (let i = 0; i < colsKpi; i++) {
    if (i > 0) {
      doc.setDrawColor(220, 225, 235)
      doc.setLineWidth(0.3)
      doc.line(MARGIN + i * colW, y + 2, MARGIN + i * colW, y + kpiBoxH - 2)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(labels[i].toUpperCase(), MARGIN + i * colW + 3, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...colors[i])
    doc.text(values[i], MARGIN + i * colW + 3, y + 10)
  }

  y += kpiBoxH + 3
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_GRAY)
  doc.text(`Incluye fletes dentro de Carabobo (el chofer cobra por nómina, queda para la empresa): ${fmtUsd(totNomina)}`, MARGIN, y + 2)
  y += 7

  // Tabla
  const tableCols = [
    { label: 'CHOFER',            x: MARGIN,        w: 38 },
    { label: 'RIF',               x: MARGIN + 38,   w: 22 },
    { label: 'DESP.',             x: MARGIN + 60,   w: 14 },
    { label: 'TOTAL FLETES',      x: MARGIN + 74,   w: 38 },
    { label: 'PARA EL CHOFER',    x: MARGIN + 112,  w: 38 },
    { label: 'PARA LA EMPRESA',   x: MARGIN + 150,  w: 38 },
  ]

  function drawTableHeaders(yPos) {
    doc.setFillColor(...C_PRIMARY)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    tableCols.forEach(col => doc.text(col.label, col.x + 1.5, yPos + 5))
    return yPos + 8
  }

  y = drawTableHeaders(y)

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(6)
  doc.setTextColor(...C_GRAY)
  doc.text('Para el chofer = su comisión por fletes fuera de Carabobo. Para la empresa = total de fletes menos esa comisión.', MARGIN, y + 2)
  y += 5

  items.forEach((t, idx) => {
    y = checkPage(doc, y, 7)
    if (y < MARGIN + 12) y = drawTableHeaders(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)

    // Nombre + badge local
    doc.setFont('helvetica', 'bold')
    doc.text(String(t.nombre || '—').substring(0, 22), tableCols[0].x + 1.5, y + 3)
    if (t.es_local) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5)
      doc.setTextColor(...C_AMBER)
      doc.text('LOCAL', tableCols[0].x + 1.5, y + 5.5)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
    }

    // RIF
    doc.text(String(t.rif || '—'), tableCols[1].x + 1.5, y + 3)

    // Despachos
    doc.text(String(t.despachos || 0), tableCols[2].x + 1.5, y + 3)

    const reparto = repartoFlete(t)
    // Total de fletes
    doc.text(fmtUsd(reparto.total), tableCols[3].x + 1.5, y + 3)

    // Para el chofer (ámbar)
    doc.setTextColor(...C_AMBER)
    doc.text(fmtUsd(reparto.chofer), tableCols[4].x + 1.5, y + 3)

    // Para la empresa (verde, negrita)
    doc.setTextColor(...C_EMERALD)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(reparto.empresa), tableCols[5].x + 1.5, y + 3)
    doc.setTextColor(...C_DARK)
    doc.setFont('helvetica', 'normal')

    y += 7
  })

  drawFooter(doc, config)

  const filename = `Fletes_Choferes_Locales_${new Date().toISOString().slice(0, 10)}`

  if (action === 'print') {
    doc.autoPrint()
    const blobUrl = doc.output('bloburl')
    if (blobUrl) {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.opacity = '0'
      iframe.src = blobUrl
      document.body.appendChild(iframe)
      iframe.onload = () => {
        try {
          iframe.contentWindow.focus()
          iframe.contentWindow.print()
        } catch (_) { /* la marca de agua/impresión es opcional */ }
        setTimeout(() => {
          try { document.body.removeChild(iframe) } catch (_) { /* la marca de agua/impresión es opcional */ }
          try { URL.revokeObjectURL(blobUrl) } catch (_) { /* la marca de agua/impresión es opcional */ }
        }, 10000)
      }
    }
  } else {
    doc.save(`${filename}.pdf`)
  }
}
