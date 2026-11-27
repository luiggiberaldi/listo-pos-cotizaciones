// src/services/pdf/clientesPDF.js
// Genera PDF optimizado para impresión (bajo consumo de tinta) del Listado de Clientes y Personal — Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  MARGIN, CONTENT_W,
  C_DARK, C_GRAY,
  drawPremiumHeader, drawSimplifiedHeader, drawPremiumFooter, drawWatermark, checkPage,
  fmtFecha, fmtTelefono, fechaArchivoCaracas, wrapLines, rowHeight,
} from './pdfShared'

/** Devuelve YYYY-MM en hora de Venezuela (America/Caracas) para comparar registros del mes actual. */
function mesAnioCaracas(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
  }).format(d)
}

export async function generarClientesPDF({
  items = [],
  config = {},
  action = 'download',
  title = 'Base de Datos de Clientes',
  filtroResumen = '',
  comprimir = true,
} = {}) {
  const safeConfig = config || {}
  const isPersonalReport = title === 'Reporte de Personal'
  const logoData = LOGO_LISTA_PRECIOS
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: comprimir })

  const fechaTxt = new Date().toLocaleDateString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const subtitle = filtroResumen
    ? `Generado: ${fechaTxt}\n${filtroResumen}`
    : `Generado: ${fechaTxt}`

  // Encabezado blanco/negro de bajo consumo de tinta (igual a Transportistas, Artículos Externos y Ventas)
  let y = drawPremiumHeader({
    doc,
    logoData,
    config: safeConfig,
    title,
    subtitle,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true,
  })
  drawWatermark(doc)

  // KPIs en cajas claras con borde fino (sin bloques sólidos oscuros)
  const totalClientes = items.length
  const activos = items.filter(c => c.activo).length
  const mesActual = mesAnioCaracas(new Date())
  const nuevosEsteMes = items.filter(c => {
    if (!c.creado_en) return false
    return mesAnioCaracas(c.creado_en) === mesActual
  }).length

  const kpis = [
    { label: isPersonalReport ? 'Total Personal' : 'Total Clientes', value: String(totalClientes) },
    { label: isPersonalReport ? 'Personal Activo' : 'Clientes Activos', value: String(activos) },
    { label: 'Nuevos Este Mes', value: String(nuevosEsteMes) },
  ]

  const kpiBoxW = CONTENT_W / 3
  const kpiBoxH = 15

  kpis.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    doc.text(kpi.label, bx + 4, y + 5.2)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C_DARK)
    doc.text(kpi.value, bx + 4, y + 11.8)
  })

  y += kpiBoxH + 8

  // Tabla
  const cols = isPersonalReport ? [
    { label: 'CÓDIGO', x: MARGIN, w: 12 },
    { label: 'CÉDULA / RIF', x: MARGIN + 12, w: 20 },
    { label: 'NOMBRE Y APELLIDO', x: MARGIN + 32, w: 50 },
    { label: 'ROL / CARGO', x: MARGIN + 82, w: 26 },
    { label: 'TELÉFONO', x: MARGIN + 108, w: 22 },
    { label: 'VENDEDOR ASIG.', x: MARGIN + 130, w: 28 },
    { label: 'REGISTRO', x: MARGIN + 158, w: 30 },
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
    doc.setFillColor(241, 245, 249)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    cols.forEach(col => doc.text(col.label, col.x + 1, yPos + 4.8))
    return yPos + 8
  }

  const contTitle = isPersonalReport ? 'Reporte de Personal (Cont.)' : 'Base de Datos de Clientes (Cont.)'
  const onNewPage = (d) => {
    const nextY = drawSimplifiedHeader(d, logoData, safeConfig, contTitle, [255, 255, 255], [0, 0, 0])
    return drawTableHeaders(nextY + 2)
  }
  const bottomMargin = () => (doc.internal.getCurrentPageInfo().pageNumber === 1 ? 35 : 14)

  y = drawTableHeaders(y)

  if (items.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...C_GRAY)
    doc.text('No hay registros que coincidan con los filtros seleccionados.', MARGIN + 2, y + 5)
  } else {
    items.forEach((item, idx) => {
      const tipo = isPersonalReport
        ? (item.categoria || '—').toUpperCase()
        : (item.tipo_cliente === 'juridico' ? 'JURÍDICO' : 'NATURAL')
      const vend = item.vendedor?.nombre || item.vendedor_nombre || '—'
      const fechaReg = item.creado_en ? fmtFecha(item.creado_en) : '—'

      // Los textos largos se parten en varias líneas (nunca se recortan)
      doc.setFontSize(6.5)
      doc.setFont('helvetica', 'normal')
      const celdas = [
        wrapLines(doc, item.codigo_cliente || '—', cols[0].w - 2),
        wrapLines(doc, item.rif_cedula || '—', cols[1].w - 2),
        null,
        wrapLines(doc, tipo, cols[3].w - 2),
        wrapLines(doc, fmtTelefono(item.telefono), cols[4].w - 2),
        wrapLines(doc, vend, cols[5].w - 2),
        wrapLines(doc, fechaReg, cols[6].w - 2),
      ]
      doc.setFont('helvetica', 'bold')
      celdas[2] = wrapLines(doc, (item.nombre || '—').toUpperCase(), cols[2].w - 2)
      const alto = rowHeight(celdas)

      y = checkPage(doc, y, alto + 1, onNewPage, bottomMargin())

      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252)
        doc.rect(MARGIN, y - 1, CONTENT_W, alto, 'F')
      }

      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      celdas.forEach((lineas, i) => {
        doc.setFont('helvetica', i === 2 ? 'bold' : 'normal')
        doc.text(lineas, cols[i].x + 1, y + 3, { lineHeightFactor: 1.15 })
      })

      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.2)
      doc.line(MARGIN, y + alto - 1, MARGIN + CONTENT_W, y + alto - 1)

      y += alto
    })
  }

  // Pie de página corporativo blanco/negro (igual a todos los reportes optimizados)
  drawPremiumFooter(doc, safeConfig, [255, 255, 255], [0, 0, 0], [0, 0, 0])

  const filePrefix = isPersonalReport ? 'Reporte_de_Personal' : 'Base_de_Datos_Clientes'
  const filename = `${filePrefix}_${fechaArchivoCaracas()}`

  if (action === 'return') {
    return { doc, filename: `${filename}.pdf`, blob: doc.output('blob') }
  }

  if (action === 'print') {
    doc.autoPrint()
    const blobUrl = doc.output('bloburl')
    if (typeof document !== 'undefined' && blobUrl) {
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
          try { document.body.removeChild(iframe) } catch { /* ya removido */ }
          URL.revokeObjectURL(blobUrl)
        }, 10000)
      }
    }
  } else {
    doc.save(`${filename}.pdf`)
  }

  return { doc, filename: `${filename}.pdf` }
}
