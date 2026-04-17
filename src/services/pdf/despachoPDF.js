// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Despacho con estética Amarillo/Negro clonada
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

// ─── Constantes de diseño ─────────────────────────────────────────────────────
const MARGIN    = 14
const PAGE_W    = 210
const PAGE_H    = 297
const CONTENT_W = PAGE_W - MARGIN * 2

const C_YELLOW = [250, 204, 21] // Amarillo vibrante principal
const C_ORANGE = [245, 158, 11] // Naranja-amarillo cabeceras
const C_DARK   = [20,  20,  20] // Negro/Gris muy oscuro
const C_WHITE  = [255, 255, 255]
const C_GRAY   = [120, 120, 120]

// Dibuja un campo con etiqueta bold + línea subrayada
function drawField(doc, label, val, x, y, w) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text(`${label}: `, x, y)
  const lblW = doc.getTextWidth(`${label}: `)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...C_DARK)
  if (val) doc.text(String(val), x + lblW + 0.5, y)
  doc.setLineWidth(0.2)
  doc.setDrawColor(...C_YELLOW)
  doc.line(x, y + 2, x + w, y + 2)
}

// Dibuja una checkbox con texto
function drawCheck(doc, label, x, y) {
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.rect(x, y - 3, 3.5, 3.5, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text(label, x + 5, y)
}

export async function generarDespachoPDF({ despacho, items = [], config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const logoData = await cargarLogo(config.logo_url)
  let y = 0

  const numDes = `N°- ${String(despacho.numero).padStart(5, '0')}`
  const cliente = despacho.cliente || {}
  const transportista = despacho.transportista || null

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA GIGANTE AMARILLA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 55
  doc.setFillColor(...C_YELLOW)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Decoraciones: Cuadrícula de puntos a la izquierda
  doc.setFillColor(...C_DARK)
  for(let i = 0; i < 4; i++) {
    for(let j = 0; j < 8; j++) {
      doc.circle(MARGIN + i * 2.5, 6 + j * 2.5, 0.4, 'F')
    }
  }

  // Cuadro derecho con rayas diagonales "Hazard"
  const hazW = 40
  const hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')

  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_YELLOW)
  for (let k = 0; k < 15; k++) {
    doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)
  }

  // Logo a la izquierda, centrado verticalmente en la franja
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 14, 8, 38, 38) } catch (_) {}
  }
  const textX = MARGIN + 58

  // Títulos Negocio Grandes
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(...C_DARK)

  let name = config.nombre_negocio || 'CONSTRUACERO CARABOBO'
  let splitName = name.split(' ')
  doc.text((splitName[0] || '').toUpperCase(), textX, 25)

  if (splitName.length > 1) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(18)
    doc.text(splitName.slice(1).join(' ').toUpperCase(), textX, 35)
  }

  // "Nota de Despacho" a la derecha inferior
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Nota de Despacho', PAGE_W - MARGIN, HDR_H - 12, { align: 'right' })
  doc.setFontSize(12)
  doc.text(numDes, PAGE_W - MARGIN, HDR_H - 5, { align: 'right' })

  y = HDR_H + 10

  // ══════════════════════════════════════════════════════════════════════════
  // 2. ÁREA DEL CLIENTE — DOS COLUMNAS
  // ══════════════════════════════════════════════════════════════════════════
  const colW  = (CONTENT_W - 6) / 2
  const col2X = MARGIN + colW + 6

  // Fila 1: DÍA + FECHA
  drawField(doc, 'DÍA',   fmtDia(despacho.creado_en),   MARGIN, y, colW)
  drawField(doc, 'FECHA', fmtFecha(despacho.creado_en),  col2X,  y, colW)
  y += 9

  // Fila 2: CLIENTE
  drawField(doc, 'CLIENTE', cliente.nombre || '—', MARGIN, y, CONTENT_W)
  y += 9

  // Fila 3: RIF/CI + TELÉFONO
  drawField(doc, 'RIF / C.I.', cliente.rif_cedula || '—', MARGIN, y, colW)
  drawField(doc, 'TELÉFONO',   cliente.telefono   || '—', col2X,  y, colW)
  y += 9

  // Fila 4: DIRECCIÓN
  drawField(doc, 'DIRECCIÓN', cliente.direccion || '—', MARGIN, y, CONTENT_W)
  y += 9

  // Fila 5: VENDEDOR + ESTADO
  drawField(doc, 'VENDEDOR',        despacho.vendedor?.nombre || '—',           MARGIN, y, colW)
  drawField(doc, 'ESTADO DESPACHO', (despacho.estado || 'PENDIENTE').toUpperCase(), col2X,  y, colW)
  y += 12

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA: ITEM | CÓD. | DESCRIPCIÓN | UNID. | PRECIO | CANT. | TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'ITEM',        x: MARGIN,        w: 10,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 10,   w: 22,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 32,   w: 62,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 94,   w: 14,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 108,  w: 24,  align: 'right'  },
    { label: 'CANT.',       x: MARGIN + 132,  w: 18,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 150,  w: 32,  align: 'right'  },
  ]
  const ROW_H = 8

  // Cabecera Naranja
  doc.setFillColor(...C_ORANGE)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 5.5, { align: col.align })
  })
  y += 8

  // Items
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  items.forEach((item, idx) => {
    if (y > PAGE_H - 85) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + ROW_H / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)

    doc.text(String(idx + 1),                            COLS[0].x + COLS[0].w/2, midY, { align: 'center' })
    doc.text(item.codigo_snap || '—',                    COLS[1].x + COLS[1].w/2, midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    doc.text(descLines[0],                               COLS[2].x + 2,            midY)
    doc.text(item.unidad_snap || '—',                    COLS[3].x + COLS[3].w/2, midY, { align: 'center' })
    doc.text(fmtUsd(item.precio_unit_usd),               COLS[4].x + COLS[4].w-2,  midY, { align: 'right' })
    doc.text(String(item.cantidad),                      COLS[5].x + COLS[5].w/2, midY, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd),               COLS[6].x + COLS[6].w-2,  midY, { align: 'right' })

    y += ROW_H
  })

  // Notas / Observaciones
  if (despacho.notas?.trim()) {
    y += 4
    if (y > PAGE_H - 95) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_ORANGE)
    doc.text('OBSERVACIONES:', MARGIN, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    lineas.forEach(lin => { y += 4; doc.text(lin, MARGIN, y + 4) })
    y += 4
  }

  y += 8

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TOTALES + FORMA DE PAGO
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 100) { doc.addPage(); y = MARGIN }

  const totW = 75
  const totX = PAGE_W - MARGIN - totW
  const total = Number(despacho.total_usd || 0)

  doc.setFillColor(...C_ORANGE)
  doc.rect(totX, y, totW, 16, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL', totX + 5, y + 10)
  doc.setFontSize(14)
  doc.text(fmtUsd(total), totX + totW - 5, y + 10, { align: 'right' })

  // Forma de pago (izquierda del total)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', MARGIN, y + 5)
  drawCheck(doc, 'EFECTIVO',   MARGIN,      y + 12)
  drawCheck(doc, 'ZELLE',      MARGIN + 28, y + 12)
  drawCheck(doc, 'PAGO MÓVIL', MARGIN + 52, y + 12)

  y += 22

  // ══════════════════════════════════════════════════════════════════════════
  // 5. SECCIÓN CHOFER / TRANSPORTE
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 75) { doc.addPage(); y = MARGIN }

  // Franja de sección
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DE TRANSPORTE', MARGIN + 2, y + 4)
  y += 9

  const choferNombre = transportista?.nombre || ''
  const choferRif    = transportista?.rif    || ''

  drawField(doc, 'NOMBRE DEL CHOFER', choferNombre, MARGIN,      y, colW)
  drawField(doc, 'C.I. CHOFER',       choferRif,    col2X,       y, colW)
  y += 9
  drawField(doc, 'TIPO DE VEHÍCULO',  '',  MARGIN,  y, colW)
  drawField(doc, 'COLOR',             '',  col2X,   y, colW)
  y += 9
  drawField(doc, 'PLACA CHUTO',  '', MARGIN,       y, 50)
  drawField(doc, 'PLACA BATEA',  '', MARGIN + 56,  y, 50)
  drawField(doc, 'OTROS',        '', MARGIN + 112, y, CONTENT_W - 112)
  y += 13

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FIRMAS: ASESOR DE COMERCIALIZACIÓN + APROBADO POR + RECIBIDO POR
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN }

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
    doc.text(f.label, fx + firmW/2, y + 8, { align: 'center' })
    if (f.val) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)
      doc.text(f.val, fx + firmW/2, y + 14, { align: 'center' })
    }
    doc.setLineWidth(0.3)
    doc.setDrawColor(...C_DARK)
    doc.line(fx, y + 17, fx + firmW, y + 17)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER CON FRANJA DE PRECAUCIÓN (todas las páginas)
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    const hazardY = ph - 33
    doc.setFillColor(...C_DARK)
    doc.rect(0, hazardY, PAGE_W, 5, 'F')

    doc.setDrawColor(...C_YELLOW)
    doc.setLineWidth(0.8)
    for(let k = 1; k < 20; k++) {
      doc.line(k * 4, hazardY, k * 4 - 4, hazardY + 5)
      doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 4, hazardY + 5)
    }

    doc.setFillColor(...C_YELLOW)
    doc.rect(0, ph - 28, PAGE_W, 28, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    const lineAddress = config.direccion_negocio || 'VÍA FLOR AMARILLO VALENCIA EDO CARABOBO'
    const addrLines = doc.splitTextToSize(lineAddress, CONTENT_W)
    const addrStartY = addrLines.length > 1 ? ph - 21 : ph - 16
    addrLines.slice(0, 2).forEach((line, i) => {
      doc.text(line, PAGE_W/2, addrStartY + i * 5, { align: 'center' })
    })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    const extraContacts = [config.telefono_negocio, config.email_negocio].filter(Boolean).join('   |   ')
    if (extraContacts) {
      doc.text(extraContacts, PAGE_W/2, ph - 9, { align: 'center' })
    }
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  doc.save(`${numDes.replace(/ /g, '_')}.pdf`)
}
