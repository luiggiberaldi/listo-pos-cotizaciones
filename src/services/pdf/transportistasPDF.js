// src/services/pdf/transportistasPDF.js
// Genera PDF profesional del Listado Detallado de Choferes / Transportistas — Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_H, MARGIN, CONTENT_W,
  C_DARK,
  drawPremiumHeader, drawSimplifiedHeader, drawPremiumFooter, drawWatermark
} from './pdfShared'

// Límite inferior: la página 1 tiene el pie grande (dirección y contacto); el resto, uno delgado.
function limiteInferior(doc) {
  return doc.internal.getCurrentPageInfo().pageNumber === 1 ? PAGE_H - 35 : PAGE_H - 14
}

export async function generarTransportistasPDF({ items = [], config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const logoData = LOGO_LISTA_PRECIOS

  // Cada página nueva lleva marca de agua y el encabezado simplificado (igual que los demás reportes).
  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function (...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, 'Base de Datos de Choferes (Cont.)', [255, 255, 255], [0, 0, 0])
    return doc
  }

  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Base de Datos de Choferes / Equipos',
    subtitle: `Generado: ${new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    customBgColor: [255, 255, 255],
    customAccentColor: [0, 0, 0],
    customTextColor: [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor: [0, 0, 0],
    centerBusinessName: true,
  })
  drawWatermark(doc)

  // KPIs
  const totalChoferes = items.length
  const kpiBoxH = 12
  
  // Caja clara con borde fino (ahorra tinta al imprimir)
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN + 1, y, CONTENT_W - 2, kpiBoxH, 2, 2, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_DARK)
  doc.text('Total Choferes / Equipos Registrados', MARGIN + 4, y + 4.5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(String(totalChoferes), MARGIN + 4, y + 9.5)

  y += kpiBoxH + 8

  // Tabla
  const cols = [
    { label: 'NOMBRE / CHOFER', x: MARGIN, w: 40 },
    { label: 'CÉDULA / RIF', x: MARGIN + 40, w: 25 },
    { label: 'VEHÍCULO / COLOR', x: MARGIN + 65, w: 30 },
    { label: 'PLACAS (CHUTO/BATEA)', x: MARGIN + 95, w: 35 },
    { label: 'COBERTURA (ZONAS)', x: MARGIN + 130, w: 33 },
    { label: 'CAPACIDAD', x: MARGIN + 163, w: 25 },
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
    const veh = item.vehiculo || ''
    const col = item.color ? ` (${item.color})` : ''
    const chuto = item.placa_chuto ? `C: ${item.placa_chuto}` : ''
    const batea = item.placa_batea ? `B: ${item.placa_batea}` : ''
    const placas = [chuto, batea].filter(Boolean).join(' | ')

    // Los textos largos se parten en varias líneas (nunca se recortan)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    const nombreL = doc.splitTextToSize((item.nombre || '—').toUpperCase(), cols[0].w - 2)
    doc.setFont('helvetica', 'normal')
    const celdas = [
      nombreL,
      doc.splitTextToSize(item.rif || '—', cols[1].w - 2),
      doc.splitTextToSize(`${veh}${col}` || '—', cols[2].w - 2),
      doc.splitTextToSize(placas || '—', cols[3].w - 2),
      doc.splitTextToSize(item.zona_cobertura || '—', cols[4].w - 2),
      doc.splitTextToSize(item.capacidad || '—', cols[5].w - 2),
    ]
    const nLineas = Math.max(...celdas.map(l => l.length))
    const alto = Math.max(6, nLineas * 2.9 + 3)

    if (y + alto > limiteInferior(doc)) {
      doc.addPage()
      y = drawTableHeaders(MARGIN + 8)
    }

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, alto, 'F')
    }

    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    celdas.forEach((lineas, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal')
      doc.text(lineas, cols[i].x + 1, y + 3, { lineHeightFactor: 1.15 })
    })

    y += alto
  })

  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])

  const filename = `Base_de_Datos_Choferes_${new Date().toISOString().slice(0, 10)}`

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
