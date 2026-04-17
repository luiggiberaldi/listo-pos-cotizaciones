// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Despacho — cabe en 1 hoja
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  const d = new Date(f)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDia(f) {
  if (!f) return '—'
  const d = new Date(f)
  return d.toLocaleDateString('es-VE', { weekday: 'long' }).toUpperCase()
}

// ─── Constantes de diseño ────────────────────────────────────────────────────
const MARGIN    = 12
const PAGE_W    = 210
const PAGE_H    = 297
const CONTENT_W = PAGE_W - MARGIN * 2

const C_YELLOW = [250, 204, 21]
const C_ORANGE = [245, 158, 11]
const C_DARK   = [20,  20,  20]
const C_WHITE  = [255, 255, 255]
const C_GRAY   = [120, 120, 120]

const FOOTER_H = 20
const HAZARD_H = 4
const FOOTER_TOTAL = HAZARD_H + FOOTER_H
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

function drawCheck(doc, label, x, y, checked = false) {
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.rect(x, y - 2.5, 3, 3, 'S')
  if (checked) {
    // Cruz de verificación dentro del cuadro
    doc.setDrawColor(...C_DARK)
    doc.setLineWidth(0.5)
    doc.line(x + 0.4, y - 1.2, x + 1.5, y + 0.2)
    doc.line(x + 1.5, y + 0.2, x + 2.8, y - 2.2)
    doc.setLineWidth(0.3)
  }
  doc.setFont('helvetica', checked ? 'bold' : 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text(label, x + 4.5, y)
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

export async function generarDespachoPDF({ despacho, items = [], config = {}, formaPago = '' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const logoData = await cargarLogo(config.logo_url)
  let y = 0

  const numDes = `N°- ${String(despacho.numero).padStart(5, '0')}`
  const cliente = despacho.cliente || {}
  const transportista = despacho.transportista || null

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA AMARILLA (compacta)
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 38
  doc.setFillColor(...C_YELLOW)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Puntos decorativos
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

  // "Nota de Despacho"
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Nota de Despacho', PAGE_W - MARGIN, HDR_H - 10, { align: 'right' })
  doc.setFontSize(10)
  doc.text(numDes, PAGE_W - MARGIN, HDR_H - 4, { align: 'right' })

  y = HDR_H + 6

  // ══════════════════════════════════════════════════════════════════════════
  // 2. ÁREA DEL CLIENTE
  // ══════════════════════════════════════════════════════════════════════════
  const colW  = (CONTENT_W - 6) / 2
  const col2X = MARGIN + colW + 6
  const FIELD_GAP = 7

  drawField(doc, 'DÍA',   fmtDia(despacho.creado_en),   MARGIN, y, colW)
  drawField(doc, 'FECHA', fmtFecha(despacho.creado_en),  col2X,  y, colW)
  y += FIELD_GAP

  drawField(doc, 'CLIENTE', cliente.nombre || '—', MARGIN, y, CONTENT_W)
  y += FIELD_GAP

  drawField(doc, 'RIF / C.I.', cliente.rif_cedula || '—', MARGIN, y, colW)
  drawField(doc, 'TELÉFONO',   cliente.telefono   || '—', col2X,  y, colW)
  y += FIELD_GAP

  drawField(doc, 'DIRECCIÓN', cliente.direccion || '—', MARGIN, y, CONTENT_W)
  y += FIELD_GAP

  drawField(doc, 'VENDEDOR',        despacho.vendedor?.nombre || '—',              MARGIN, y, colW)
  drawField(doc, 'ESTADO DESPACHO', (despacho.estado || 'PENDIENTE').toUpperCase(), col2X,  y, colW)
  y += 9

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE ITEMS
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'ITEM',        x: MARGIN,        w: 10,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 10,   w: 22,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 32,   w: 62,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 94,   w: 14,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 108,  w: 24,  align: 'right'  },
    { label: 'CANT.',       x: MARGIN + 132,  w: 18,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 150,  w: CONTENT_W - 150, align: 'right'  },
  ]
  const ROW_H = 6

  // Cabecera Naranja
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

  // Items
  doc.setLineWidth(0.15)
  doc.setDrawColor(200, 200, 200)

  items.forEach((item, idx) => {
    if (y > MAX_Y - 70) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + ROW_H / 2 + 1
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)

    doc.text(String(idx + 1),                            COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.text(item.codigo_snap || '—',                    COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    doc.text(descLines[0],                               COLS[2].x + 2, midY)
    doc.text(item.unidad_snap || '—',                    COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })
    doc.text(fmtUsd(item.precio_unit_usd),               COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })
    doc.text(String(item.cantidad),                      COLS[5].x + COLS[5].w / 2, midY, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd),               COLS[6].x + COLS[6].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Observaciones
  if (despacho.notas?.trim()) {
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_ORANGE)
    doc.text('OBSERVACIONES:', MARGIN, y + 3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    lineas.slice(0, 3).forEach(lin => { y += 3.5; doc.text(lin, MARGIN, y + 3) })
    y += 3
  }

  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Calcular espacio restante y distribuir secciones
  // ══════════════════════════════════════════════════════════════════════════
  // Secciones fijas: totales(16) + transporte_header(6) + transporte_fields(2×8=16) + firmas(18) = ~56mm
  const SECTION_MIN = 56
  const spaceLeft = MAX_Y - y - SECTION_MIN
  // Distribuir espacio extra como gaps entre secciones (4 gaps)
  const extraGap = Math.max(0, Math.min(spaceLeft / 4, 12))

  // ── TOTALES + FORMA DE PAGO ───────────────────────────────────────────────
  const totW = 72
  const totX = PAGE_W - MARGIN - totW

  doc.setFillColor(...C_ORANGE)
  doc.rect(totX, y, totW, 16, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL', totX + 5, y + 10)
  doc.setFontSize(13)
  doc.text(fmtUsd(despacho.total_usd), totX + totW - 5, y + 10, { align: 'right' })

  // Forma de pago (izquierda)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', MARGIN, y + 5)
  const fp = (formaPago || despacho.forma_pago || '').toLowerCase()
  drawCheck(doc, 'EFECTIVO',   MARGIN,      y + 12, fp === 'efectivo')
  drawCheck(doc, 'ZELLE',      MARGIN + 28, y + 12, fp === 'zelle')
  drawCheck(doc, 'PAGO MÓVIL', MARGIN + 52, y + 12, fp === 'pago movil' || fp === 'pago móvil')
  drawCheck(doc, 'USDT',       MARGIN + 80, y + 12, fp === 'usdt')

  y += 16 + extraGap

  // ── TRANSPORTE ────────────────────────────────────────────────────────────
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DE TRANSPORTE', MARGIN + 2, y + 4)
  y += 10

  const choferNombre = transportista?.nombre || ''
  const choferRif    = transportista?.rif    || ''
  const choferTelf   = transportista?.telefono || ''
  const col3W = (CONTENT_W - 8) / 3

  drawField(doc, 'CHOFER', choferNombre, MARGIN, y, col3W)
  drawField(doc, 'C.I.', choferRif, MARGIN + col3W + 4, y, col3W)
  drawField(doc, 'TELÉFONO', choferTelf, MARGIN + (col3W + 4) * 2, y, col3W)
  y += 8

  drawField(doc, 'VEHÍCULO', '', MARGIN, y, col3W)
  drawField(doc, 'PLACA CHUTO', '', MARGIN + col3W + 4, y, col3W)
  drawField(doc, 'PLACA BATEA', '', MARGIN + (col3W + 4) * 2, y, col3W)
  y += 8 + extraGap

  // ── FIRMAS ────────────────────────────────────────────────────────────────
  const firmW = (CONTENT_W - 10) / 3
  const firmas = [
    { label: 'Asesor de Comercialización', val: despacho.vendedor?.nombre || '' },
    { label: 'Aprobado por',               val: '' },
    { label: 'Recibido por',               val: '' },
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
  // 7. FOOTER (todas las páginas)
  // ══════════════════════════════════════════════════════════════════════════
  drawFooter(doc, config)

  doc.save(`${numDes.replace(/ /g, '_')}.pdf`)
}
