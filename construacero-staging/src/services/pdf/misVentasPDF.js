// src/services/pdf/misVentasPDF.js
// PDF "Mis ventas": detalle de lo vendido por un vendedor en un rango (despachos con artículos,
// cliente y montos + resúmenes por artículo y por cliente). Mismo estilo que el Reporte de Ventas.
import { jsPDF } from 'jspdf'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  MARGIN, CONTENT_W, C_DARK, C_GRAY, C_EMERALD, C_PRIMARY,
  fmtUsd, drawWatermark, checkPage, drawPremiumHeader, drawSimplifiedHeader, drawPremiumFooter,
} from './pdfShared'

const ESTADOS = { despachada: 'Despachada', entregada: 'Entregada' }
const fmtNum = v => Number(v || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })
const fmtFechaLarga = iso => new Date(iso).toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDia = ymd => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}` }
const pad = (v, n = 5) => String(v ?? '').padStart(n, '0')

function cortar(doc, texto, ancho) {
  const t = String(texto ?? '')
  if (doc.getTextWidth(t) <= ancho) return t
  let s = t
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > ancho) s = s.slice(0, -1)
  return `${s}…`
}

export function nombreArchivoMisVentas(reporte) {
  const quien = (reporte.vendedor?.nombre || 'vendedor').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `Mis_Ventas_${quien}_${reporte.periodo.desde}_${reporte.periodo.hasta}.pdf`
}

// comprimir: sin compresión la marca de agua sola pesa ~12 MB por archivo (no se puede mandar cómodo
// por WhatsApp); comprimido queda en ~3 MB. Las pruebas lo apagan para poder leer el texto.
export function generarMisVentasPDF({ reporte, config = {}, comprimir = true }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: comprimir })
  const logoData = LOGO_LISTA_PRECIOS
  const conComision = reporte.resumen.comisionUsd !== null && reporte.resumen.comisionUsd !== undefined
  const periodoTxt = `${fmtDia(reporte.periodo.desde)} al ${fmtDia(reporte.periodo.hasta)}`
  const nuevaPagina = () => {
    drawSimplifiedHeader(doc, logoData, config, `Mis ventas · ${reporte.vendedor?.nombre || ''} (Cont.)`, [255, 255, 255], [0, 0, 0])
    return MARGIN + 6
  }

  let y = drawPremiumHeader({
    doc, logoData, config,
    title: 'Reporte de Ventas del Vendedor',
    subtitle: `${reporte.vendedor?.nombre || ''} · ${periodoTxt}`,
    customBgColor: [255, 255, 255], customAccentColor: [0, 0, 0], customTextColor: [0, 0, 0],
    customSubtitleColor: [0, 0, 0], customBorderColor: [0, 0, 0], centerBusinessName: true,
  })
  drawWatermark(doc)

  // ── 1. Resumen ──────────────────────────────────────────────────────────────
  const r = reporte.resumen
  const kpis = [
    { label: 'Total vendido', value: fmtUsd(r.totalUsd) },
    { label: 'Despachos', value: String(r.despachos) },
    { label: 'Clientes', value: String(r.clientes) },
    { label: 'Unidades', value: fmtNum(r.unidades) },
  ]
  if (conComision) kpis.push({ label: 'Comisión', value: fmtUsd(r.comisionUsd) })
  const kw = CONTENT_W / kpis.length
  kpis.forEach((k, i) => {
    const bx = MARGIN + i * kw
    doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3)
    doc.roundedRect(bx + 1, y, kw - 2, 18, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105)
    doc.text(k.label, bx + 3.5, y + 6)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...C_DARK)
    doc.text(k.value, bx + 3.5, y + 13.5)
  })
  y += 25

  if (!reporte.despachos.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...C_GRAY)
    doc.text('No hay ventas aprobadas (despachadas o entregadas) en este período.', MARGIN, y + 4)
  }

  // ── 2. Detalle por despacho ────────────────────────────────────────────────
  const titulo = texto => {
    y = checkPage(doc, y, 16, nuevaPagina)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...C_PRIMARY)
    doc.text(texto, MARGIN, y)
    doc.setDrawColor(...C_PRIMARY); doc.setLineWidth(0.4); doc.line(MARGIN, y + 1.5, MARGIN + CONTENT_W, y + 1.5)
    y += 6
  }
  // columnas de artículos: código, artículo, cant, unidad, precio, total
  const col = { cod: MARGIN + 2, art: MARGIN + 24, cant: MARGIN + 122, und: MARGIN + 125, precio: MARGIN + 155, total: MARGIN + CONTENT_W - 2 }

  if (reporte.despachos.length) titulo('Detalle de ventas')
  for (const d of reporte.despachos) {
    y = checkPage(doc, y, 26, nuevaPagina)
    // cabecera del despacho
    doc.setFillColor(241, 245, 249); doc.rect(MARGIN, y - 3.5, CONTENT_W, 10.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C_DARK)
    const numeros = `DES-${pad(d.numero)}${d.cotizacion ? `  ·  COT-${pad(d.cotizacion)}` : ''}`
    doc.text(`${fmtFechaLarga(d.fecha)}   ${numeros}`, MARGIN + 2, y + 0.5)
    doc.text(fmtUsd(d.totalUsd), col.total, y + 0.5, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C_GRAY)
    const estado = ESTADOS[d.estado] || d.estado
    const pago = d.formasPago.length ? d.formasPago.join(', ') : 'Sin especificar'
    doc.text(cortar(doc, `${d.cliente}${d.clienteRif ? ` (${d.clienteRif})` : ''}  ·  ${estado}  ·  ${pago}${d.tieneDevoluciones ? '  ·  Con devoluciones' : ''}`, CONTENT_W - 40), MARGIN + 2, y + 4.8)
    if (conComision && d.comisionUsd) doc.text(`Comisión ${fmtUsd(d.comisionUsd)}`, col.total, y + 4.8, { align: 'right' })
    y += 10

    // artículos
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C_GRAY)
    doc.text('Código', col.cod, y); doc.text('Artículo', col.art, y); doc.text('Cant.', col.cant, y, { align: 'right' })
    doc.text('Und.', col.und, y); doc.text('Precio', col.precio, y, { align: 'right' })
    doc.text('Total', col.total, y, { align: 'right' })
    y += 4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C_DARK)
    for (const a of d.articulos) {
      y = checkPage(doc, y, 6, nuevaPagina)
      doc.text(cortar(doc, a.codigo, 20), col.cod, y)
      doc.text(cortar(doc, a.nombre, 92), col.art, y)
      doc.text(fmtNum(a.cantidad), col.cant, y, { align: 'right' })
      doc.text(cortar(doc, a.unidad, 12), col.und, y)
      doc.text(fmtUsd(a.precioUnitUsd), col.precio, y, { align: 'right' })
      doc.text(fmtUsd(a.totalUsd), col.total, y, { align: 'right' })
      y += 4.2
    }
    // montos del despacho
    const extras = []
    if (d.descuentoUsd) extras.push(`Descuento: -${fmtUsd(d.descuentoUsd)}`)
    if (d.fleteUsd) extras.push(`Flete: ${fmtUsd(d.fleteUsd)}`)
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(MARGIN, y - 2.2, MARGIN + CONTENT_W, y - 2.2)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C_GRAY)
    doc.text(`Artículos: ${fmtUsd(d.subtotalArticulosUsd)}${extras.length ? `  ·  ${extras.join('  ·  ')}` : ''}`, MARGIN + 2, y + 1)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...C_EMERALD)
    doc.text(`Total despacho: ${fmtUsd(d.totalUsd)}`, col.total, y + 1, { align: 'right' })
    y += 8
  }

  // ── 3. Resumen por artículo ────────────────────────────────────────────────
  const tabla = (encabezados, filas) => {
    y = checkPage(doc, y, 14, nuevaPagina)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C_GRAY)
    encabezados.forEach(h => doc.text(h.t, h.x, y, h.align ? { align: h.align } : undefined))
    y += 4.5
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C_DARK)
    filas.forEach((f, i) => {
      y = checkPage(doc, y, 6, nuevaPagina)
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(MARGIN, y - 3.2, CONTENT_W, 4.6, 'F') }
      f.forEach((celda, j) => doc.text(celda, encabezados[j].x, y, encabezados[j].align ? { align: encabezados[j].align } : undefined))
      y += 4.6
    })
    y += 5
  }

  if (reporte.porArticulo.length) {
    titulo('Resumen por artículo')
    tabla(
      [{ t: 'Código', x: MARGIN + 2 }, { t: 'Artículo', x: MARGIN + 26 }, { t: 'Cantidad', x: MARGIN + 140, align: 'right' }, { t: 'Und.', x: MARGIN + 143 }, { t: 'Despachos', x: MARGIN + 170, align: 'right' }, { t: 'Total', x: MARGIN + CONTENT_W - 2, align: 'right' }],
      reporte.porArticulo.map(a => [cortar(doc, a.codigo, 22), cortar(doc, a.nombre, 105), fmtNum(a.cantidad), cortar(doc, a.unidad, 12), String(a.despachos), fmtUsd(a.totalUsd)]),
    )
  }

  // ── 4. Resumen por cliente ────────────────────────────────────────────────
  if (reporte.porCliente.length) {
    titulo('Resumen por cliente')
    tabla(
      [{ t: 'Cliente', x: MARGIN + 2 }, { t: 'RIF / Cédula', x: MARGIN + 110 }, { t: 'Despachos', x: MARGIN + 165, align: 'right' }, { t: 'Total', x: MARGIN + CONTENT_W - 2, align: 'right' }],
      reporte.porCliente.map(c => [cortar(doc, c.nombre, 104), cortar(doc, c.rif, 45), String(c.despachos), fmtUsd(c.totalUsd)]),
    )
  }

  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0], `Mis ventas · ${reporte.vendedor?.nombre || ''} · ${periodoTxt}`)
  return { blob: doc.output('blob'), filename: nombreArchivoMisVentas(reporte), doc }
}

