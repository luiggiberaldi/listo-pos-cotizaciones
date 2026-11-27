// src/services/pdf/clientesPDF.js
// Genera PDF profesional del Listado Detallado de Clientes o Personal — Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_GRAY,
  drawPremiumHeader, drawSimplifiedHeader, fmtFecha, fmtTelefono, fechaArchivoCaracas
} from './pdfShared'

function drawHeader(doc, logoData, config, title = 'Base de Datos de Clientes', filtroTexto = '') {
  const fechaSub = `Generado: ${new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: 'short', year: 'numeric' })}`
  const subtitle = filtroTexto ? `${fechaSub} · ${filtroTexto}` : fechaSub
  return drawPremiumHeader({
    doc,
    logoData,
    config,
    title,
    subtitle,
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
    let footName = config?.nombre_negocio || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    doc.text(footName, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }
}

export async function generarClientesPDF({
  items = [],
  config = {},
  action = 'download',
  title = 'Base de Datos de Clientes',
  filtroTexto = '',
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const logoData = await cargarLogo(config?.logo_url)
  const isPersonalReport = title === 'Reporte de Personal'

  let y = drawHeader(doc, logoData, config, title, filtroTexto)

  const dibujarWatermark = () => {
    try {
      const gState = new doc.GState({ opacity: 0.06 })
      doc.setGState(gState)
      doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch (_) {}
  }

  dibujarWatermark()

  // KPIs (calculados en hora America/Caracas)
  const totalClientes = items.length
  const activos = items.filter(c => c.activo).length
  const mesActualVe = fechaArchivoCaracas().slice(0, 7)
  const nuevosEsteMes = items.filter(c => {
    if (!c.creado_en) return false
    return fechaArchivoCaracas(c.creado_en).slice(0, 7) === mesActualVe
  }).length

  const kpiBoxW = CONTENT_W / 3
  const kpiBoxH = 15

  const kpis = [
    { label: isPersonalReport ? 'Total Personal' : 'Total Clientes', value: String(totalClientes), color: C_PRIMARY },
    { label: isPersonalReport ? 'Personal Activo' : 'Clientes Activos', value: String(activos), color: C_EMERALD },
    { label: 'Nuevos Este Mes', value: String(nuevosEsteMes), color: C_AMBER },
  ]

  kpis.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(kpi.label, bx + 4, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(kpi.value, bx + 4, y + 10.5)
  })

  y += kpiBoxH + 8

  // Tabla con anchos calibrados
  const cols = isPersonalReport ? [
    { label: 'CÓDIGO', x: MARGIN, w: 13 },
    { label: 'CÉDULA / RIF', x: MARGIN + 13, w: 21 },
    { label: 'NOMBRE Y APELLIDO', x: MARGIN + 34, w: 48 },
    { label: 'ROL / CARGO', x: MARGIN + 82, w: 28 },
    { label: 'TELÉFONO', x: MARGIN + 110, w: 22 },
    { label: 'VENDEDOR ASIG.', x: MARGIN + 132, w: 28 },
    { label: 'REGISTRO', x: MARGIN + 160, w: 28 },
  ] : [
    { label: 'CÓDIGO', x: MARGIN, w: 14 },
    { label: 'RIF / CÉDULA', x: MARGIN + 14, w: 22 },
    { label: 'NOMBRE / RAZÓN SOCIAL', x: MARGIN + 36, w: 58 },
    { label: 'TIPO', x: MARGIN + 94, w: 16 },
    { label: 'TELÉFONO', x: MARGIN + 110, w: 25 },
    { label: 'VENDEDOR', x: MARGIN + 135, w: 27 },
    { label: 'REGISTRO', x: MARGIN + 162, w: 26 },
  ]

  function drawTableHeaders(yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    cols.forEach(col => doc.text(col.label, col.x + 1, yPos + 5))
    return yPos + 8
  }

  y = drawTableHeaders(y)

  items.forEach((item, idx) => {
    const codStr = String(item.codigo_cliente || '—')
    const rifStr = String(item.rif_cedula || '—')
    const nombreStr = String(item.nombre || '—').toUpperCase()
    const tipoStr = isPersonalReport
      ? String(item.categoria || '—').toUpperCase()
      : (item.tipo_cliente === 'juridico' ? 'JURÍDICO' : 'NATURAL')
    const telStr = fmtTelefono(item.telefono)
    const vendStr = String(item.vendedor?.nombre || item.vendedor_nombre || '—')
    const fechaReg = item.creado_en ? fmtFecha(item.creado_en) : '—'

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    const nombreLines = doc.splitTextToSize(nombreStr, cols[2].w - 2)
    doc.setFont('helvetica', 'normal')
    const celdas = [
      doc.splitTextToSize(codStr, cols[0].w - 2),
      doc.splitTextToSize(rifStr, cols[1].w - 2),
      nombreLines,
      doc.splitTextToSize(tipoStr, cols[3].w - 2),
      doc.splitTextToSize(telStr, cols[4].w - 2),
      doc.splitTextToSize(vendStr, cols[5].w - 2),
      doc.splitTextToSize(fechaReg, cols[6].w - 2),
    ]
    const nLineas = Math.max(1, ...celdas.map(l => l.length))
    const rowH = Math.max(6, nLineas * 2.9 + 2.8)

    if (y + rowH > PAGE_H - 22) {
      doc.addPage()
      dibujarWatermark()
      y = drawSimplifiedHeader(doc, logoData, config, `${title} (Cont.)`)
      y = drawTableHeaders(y + 2)
    }

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F')
    }

    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    celdas.forEach((lineas, i) => {
      doc.setFont('helvetica', i === 2 ? 'bold' : 'normal')
      doc.text(lineas, cols[i].x + 1, y + 3, { lineHeightFactor: 1.15 })
    })

    y += rowH
  })

  drawFooter(doc, config)

  const prefix = isPersonalReport ? 'Reporte_de_Personal' : 'Base_de_Datos_Clientes'
  const filename = `${prefix}_${fechaArchivoCaracas()}`

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
      iframe.src = blobUrl
      document.body.appendChild(iframe)
      iframe.onload = () => {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
        setTimeout(() => {
          document.body.removeChild(iframe)
          URL.revokeObjectURL(blobUrl)
        }, 10000)
      }
    }
  } else {
    doc.save(`${filename}.pdf`)
  }
}
