// src/services/pdf/cotizacionPDF.js
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f + (f.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}
function fmtDia(f) {
  if (!f) return '—'
  return new Date(f + (f.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-VE', { weekday: 'long' }).toUpperCase()
}

// ─── Layout y Colores ────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 12
const CONTENT_W = PAGE_W - MARGIN * 2

const C_YELLOW = [250, 204, 21]
const C_ORANGE = [245, 158, 11]
const C_DARK   = [20, 20, 20]
const C_WHITE  = [255, 255, 255]
const C_GRAY   = [120, 120, 120]

// Footer height (hazard stripe + yellow bar)
const FOOTER_H = 20
const HAZARD_H = 4
const FOOTER_TOTAL = HAZARD_H + FOOTER_H
// Maximum Y before footer
const MAX_Y = PAGE_H - FOOTER_TOTAL - 2

function drawField(doc, label, val, x, y, w) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text(`${label}: `, x, y)
  const lblW = doc.getTextWidth(`${label}: `)
  doc.setFont('helvetica', 'normal')
  if (val) doc.text(String(val), x + lblW + 0.5, y)
  doc.setLineWidth(0.2)
  doc.setDrawColor(...C_YELLOW)
  doc.line(x, y + 1.5, x + w, y + 1.5)
}

function drawFooter(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)

    const hazardY = PAGE_H - FOOTER_TOTAL
    doc.setFillColor(...C_DARK)
    doc.rect(0, hazardY, PAGE_W, HAZARD_H, 'F')
    doc.setDrawColor(...C_YELLOW)
    doc.setLineWidth(0.7)
    for (let k = 1; k < 20; k++) {
      doc.line(k * 4, hazardY, k * 4 - 4, hazardY + HAZARD_H)
      doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 4, hazardY + HAZARD_H)
    }

    doc.setFillColor(...C_YELLOW)
    doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)

    const lineAddress = config.direccion_negocio || 'VÍA FLOR AMARILLO VALENCIA EDO CARABOBO'
    const addrLines = doc.splitTextToSize(lineAddress, CONTENT_W)
    doc.text(addrLines[0], PAGE_W / 2, PAGE_H - 13, { align: 'center' })
    if (addrLines[1]) doc.text(addrLines[1], PAGE_W / 2, PAGE_H - 9, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    const extra = [config.telefono_negocio, config.email_negocio].filter(Boolean).join('   |   ')
    if (extra) doc.text(extra, PAGE_W / 2, PAGE_H - 5, { align: 'center' })
  }
}

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)

  const numDisplay = cotizacion.version > 1
    ? `Nº- ${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `Nº- ${String(cotizacion.numero).padStart(5, '0')}`

  const cliente = cotizacion.cliente || {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA AMARILLA (compacta)
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 38
  doc.setFillColor(...C_YELLOW)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Puntos decorativos izquierda
  doc.setFillColor(...C_DARK)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 6; j++) {
      doc.circle(MARGIN + i * 2.5, 5 + j * 2.5, 0.35, 'F')
    }
  }

  // Hazard derecha
  const hazW = 35
  const hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 11, 'F')
  doc.setLineWidth(0.7)
  doc.setDrawColor(...C_YELLOW)
  for (let k = 0; k < 14; k++) {
    doc.line(hazX + k * 4, 0, hazX + k * 4 - 6, 11)
  }

  // Logo
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 10, 4, 30, 30) } catch (_) {}
  }
  const textX = MARGIN + 45

  // Nombre negocio
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...C_DARK)
  let name = config.nombre_negocio || 'CONSTRUACERO CARABOBO'
  let splitName = name.split(' ')
  doc.text((splitName[0] || '').toUpperCase(), textX, 18)
  if (splitName.length > 1) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(15)
    doc.text(splitName.slice(1).join(' ').toUpperCase(), textX, 27)
  }

  // "Cotización" + número
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 10, { align: 'right' })
  doc.setFontSize(10)
  doc.text(numDisplay, PAGE_W - MARGIN, HDR_H - 4, { align: 'right' })

  y = HDR_H + 6

  // ══════════════════════════════════════════════════════════════════════════
  // 2. ÁREA DEL CLIENTE — DOS COLUMNAS
  // ══════════════════════════════════════════════════════════════════════════
  const colW  = (CONTENT_W - 6) / 2
  const col2X = MARGIN + colW + 6
  const FIELD_GAP = 7

  drawField(doc, 'DÍA',   fmtDia(cotizacion.creado_en),   MARGIN, y, colW)
  drawField(doc, 'FECHA', fmtFecha(cotizacion.creado_en),  col2X,  y, colW)
  y += FIELD_GAP

  drawField(doc, 'NOMBRE', cliente.nombre || '—', MARGIN, y, CONTENT_W)
  y += FIELD_GAP

  drawField(doc, 'RIF / C.I.', cliente.rif_cedula || '—', MARGIN, y, colW)
  drawField(doc, 'TELÉFONO',   cliente.telefono   || '—', col2X,  y, colW)
  y += FIELD_GAP

  drawField(doc, 'DIRECCIÓN', cliente.direccion || '—', MARGIN, y, CONTENT_W)
  y += FIELD_GAP

  drawField(doc, 'VENDEDOR',     cotizacion.vendedor?.nombre || '—', MARGIN, y, colW)
  drawField(doc, 'VÁLIDO HASTA', fmtFecha(cotizacion.valida_hasta),  col2X,  y, colW)
  y += 9

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE ITEMS
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'ITEM',        x: MARGIN,        w: 10,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 10,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 30,   w: 66,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 96,   w: 14,  align: 'center' },
    { label: 'P. UNIT.',    x: MARGIN + 110,  w: 26,  align: 'right'  },
    { label: 'CANT.',       x: MARGIN + 136,  w: 14,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 150,  w: CONTENT_W - 150, align: 'right'  },
  ]
  const ROW_H = 6

  // Cabecera naranja
  doc.setFillColor(...C_ORANGE)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w / 2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 4.8, { align: col.align })
  })
  y += 7

  // Filas
  doc.setLineWidth(0.15)
  doc.setDrawColor(200, 200, 200)

  items.forEach((item, idx) => {
    if (y > MAX_Y - 60) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + ROW_H / 2 + 1
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)

    doc.text(String(idx + 1),                         COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.text(item.codigo_snap || '—',                 COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    doc.text(descLines[0],                            COLS[2].x + 2, midY)
    doc.text(item.unidad_snap || '—',                 COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })
    doc.text(fmtUsd(item.precio_unit_usd),            COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })
    doc.text(String(item.cantidad),                   COLS[5].x + COLS[5].w / 2, midY, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd),            COLS[6].x + COLS[6].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Notas
  if (cotizacion.notas_cliente?.trim()) {
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_ORANGE)
    doc.text('NOTAS:', MARGIN, y + 3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(cotizacion.notas_cliente.trim(), CONTENT_W)
    lineas.slice(0, 3).forEach(lin => { y += 3.5; doc.text(lin, MARGIN, y + 3) })
    y += 3
  }

  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Calcular espacio restante y distribuir secciones
  // ══════════════════════════════════════════════════════════════════════════
  const totW    = 72
  const totX    = PAGE_W - MARGIN - totW
  const ivaPct  = Number(config.iva_pct || 0)
  const ivaBase = Number(cotizacion.subtotal_usd || 0) - Number(cotizacion.descuento_usd || 0)
  const ivaUsd  = ivaPct > 0 ? Math.round(ivaBase * ivaPct) / 100 : 0

  const hasDescuento = Number(cotizacion.descuento_usd || 0) > 0
  const hasEnvio     = Number(cotizacion.costo_envio_usd || 0) > 0
  let boxH = 16
  if (ivaPct > 0)   boxH += 7
  if (hasDescuento)  boxH += 7
  if (hasEnvio)      boxH += 7

  // Secciones: totales(boxH) + firmas(18) ≈ mínimo fijo
  const SECTION_MIN = boxH + 18
  const spaceLeft = MAX_Y - y - SECTION_MIN
  const extraGap = Math.max(0, Math.min(spaceLeft / 3, 15))

  // ── TOTALES ───────────────────────────────────────────────────────────────
  doc.setFillColor(...C_ORANGE)
  doc.rect(totX, y, totW, boxH, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)

  let ty = y + 6
  doc.text('Subtotal', totX + 4, ty)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtUsd(cotizacion.subtotal_usd), totX + totW - 4, ty, { align: 'right' })
  ty += 7

  if (hasDescuento) {
    doc.setFont('helvetica', 'bold')
    const dPct = Number(cotizacion.descuento_global_pct || 0)
    doc.text(`Descuento${dPct > 0 ? ` (${dPct}%)` : ''}`, totX + 4, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(`- ${fmtUsd(cotizacion.descuento_usd)}`, totX + totW - 4, ty, { align: 'right' })
    ty += 7
  }

  if (hasEnvio) {
    doc.setFont('helvetica', 'bold')
    doc.text('Envío', totX + 4, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(cotizacion.costo_envio_usd), totX + totW - 4, ty, { align: 'right' })
    ty += 7
  }

  if (ivaPct > 0) {
    doc.setFont('helvetica', 'bold')
    doc.text(`IVA (${ivaPct}%)`, totX + 4, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(ivaUsd), totX + totW - 4, ty, { align: 'right' })
    ty += 7
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('TOTAL', totX + 4, ty)
  doc.setFontSize(13)
  doc.text(fmtUsd(cotizacion.total_usd), totX + totW - 4, ty, { align: 'right' })

  y += boxH + extraGap

  // ── FIRMAS ────────────────────────────────────────────────────────────────
  const firmW = (CONTENT_W - 10) / 3
  const firmas = [
    { label: 'Asesor de Comercialización', val: cotizacion.vendedor?.nombre || '' },
    { label: 'Aprobado por',               val: '' },
    { label: 'Acepta conforme',            val: cliente.nombre || '' },
  ]

  firmas.forEach((f, i) => {
    const fx = MARGIN + i * (firmW + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_GRAY)
    doc.text(f.label, fx + firmW / 2, y + 8, { align: 'center' })
    if (f.val) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)
      doc.text(f.val, fx + firmW / 2, y + 14, { align: 'center' })
    }
    doc.setLineWidth(0.3)
    doc.setDrawColor(...C_DARK)
    doc.line(fx, y + 17, fx + firmW, y + 17)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER (todas las páginas)
  // ══════════════════════════════════════════════════════════════════════════
  drawFooter(doc, config)

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
