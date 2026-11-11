// src/services/pdf/articulosExternosPDF.js
// Genera PDF profesional de Reporte de Artículos Externos Vendidos — Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_EMERALD, C_GRAY,
  fmtUsd, fmtFecha,
  drawWatermark, drawPremiumHeader, drawSimplifiedHeader, drawPremiumFooter, checkPage,
} from './pdfShared'

export async function generarArticulosExternosPDF({ items, rango, kpis, config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const logoData = LOGO_LISTA_PRECIOS

  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, 'Reporte Artículos Externos (Cont.)', [255, 255, 255], [0, 0, 0])
  }

  let y = 0

  // ═══ CABECERA ═══
  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Artículos Externos Vendidos',
    subtitle: `${rango.from} — ${rango.to}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true
  })

  // Watermark
  drawWatermark(doc)

  // ═══ KPIs ═══
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 18
  
  const formattedCantTotal = Number(kpis.cantidadTotal || 0) % 1 === 0 
    ? Number(kpis.cantidadTotal || 0).toFixed(0) 
    : Number(kpis.cantidadTotal || 0).toFixed(2)

  const kpiData = [
    { label: 'Total Ventas Externas', value: fmtUsd(kpis.totalVentas) },
    { label: 'Cant. Total Vendida', value: formattedCantTotal },
    { label: 'Pedidos Afectados', value: String(kpis.pedidosUnicos) },
    { label: 'Clientes Compradores', value: String(kpis.clientesUnicos) },
  ]

  kpiData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    // Caja clara con borde fino (ahorra tinta al imprimir)
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_GRAY)
    doc.text(kpi.label, bx + 4, y + 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_DARK)
    doc.text(kpi.value, bx + 4, y + 13)
  })
  y += kpiBoxH + 8

  // ═══ TABLA DE ITEMS ═══
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Detalle de Ventas', MARGIN, y + 4)
  y += 8

  // Encabezado de la tabla
  doc.setFillColor(240, 242, 245)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(80, 90, 110)

  // Columnas optimizadas para evitar choques
  const colX = {
    fecha: MARGIN,
    despacho: MARGIN + 12 + 2,
    articulo: MARGIN + 24 + 2,
    cantidad: MARGIN + 68 + 10,
    precio: MARGIN + 78 + 16,
    total: MARGIN + 94 + 18,
    cliente: MARGIN + 112 + 2,
    asesor: MARGIN + 164 + 2
  }

  doc.text('Fecha', colX.fecha, y + 5)
  doc.text('Nº Desp.', colX.despacho, y + 5)
  doc.text('Artículo', colX.articulo, y + 5)
  doc.text('Cant.', colX.cantidad, y + 5, { align: 'right' })
  doc.text('Precio U.', colX.precio, y + 5, { align: 'right' })
  doc.text('Total ($)', colX.total, y + 5, { align: 'right' })
  doc.text('Cliente', colX.cliente, y + 5)
  doc.text('Asesor', colX.asesor, y + 5)
  y += 9

  items.forEach((item, idx) => {
    // Los textos largos se parten en varias líneas (nunca se recortan)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    const artLines = doc.splitTextToSize(String(item.articulo_nombre || ''), 40)
    const cliLines = doc.splitTextToSize(`${item.cliente_nombre || ''} (${item.cliente_rif || ''})`, 48)
    const aseLines = doc.splitTextToSize(String(item.asesor_nombre || ''), 20)
    const nLines = Math.max(1, artLines.length, cliLines.length, aseLines.length)
    const rowH = Math.max(7.5, nLines * 3 + 3.5)

    y = checkPage(doc, y, rowH + 1.5, (d) => {
      d.setFillColor(240, 242, 245)
      d.rect(MARGIN, MARGIN + 15, CONTENT_W, 7, 'F')
      d.setFont('helvetica', 'bold')
      d.setFontSize(6.5)
      d.setTextColor(80, 90, 110)
      d.text('Fecha', colX.fecha, MARGIN + 20)
      d.text('Nº Desp.', colX.despacho, MARGIN + 20)
      d.text('Artículo', colX.articulo, MARGIN + 20)
      d.text('Cant.', colX.cantidad, MARGIN + 20, { align: 'right' })
      d.text('Precio U.', colX.precio, MARGIN + 20, { align: 'right' })
      d.text('Total ($)', colX.total, MARGIN + 20, { align: 'right' })
      d.text('Cliente', colX.cliente, MARGIN + 20)
      d.text('Asesor', colX.asesor, MARGIN + 20)
      return MARGIN + 24
    })

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)

    // Valores
    doc.text(fmtFecha(item.fecha, 'short'), colX.fecha, y + 4)
    doc.setFont('helvetica', 'bold')
    doc.text(String(item.despacho_numero || ''), colX.despacho, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.text(artLines, colX.articulo, y + 4, { lineHeightFactor: 1.2 })

    // Formatear cantidad quitando decimales si es entero
    const formattedCant = Number(item.cantidad || 0) % 1 === 0 
      ? Number(item.cantidad || 0).toFixed(0) 
      : Number(item.cantidad || 0).toFixed(2)
    doc.text(formattedCant, colX.cantidad, y + 4, { align: 'right' })
    
    // Precios
    doc.text(fmtUsd(item.precio_unit_usd), colX.precio, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_usd), colX.total, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    doc.text(cliLines, colX.cliente, y + 4, { lineHeightFactor: 1.2 })
    doc.text(aseLines, colX.asesor, y + 4, { lineHeightFactor: 1.2 })

    y += rowH
  })

  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])

  const filename = `Reporte_Articulos_Externos_${rango.from}_${rango.to}`

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
