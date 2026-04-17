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
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}
function lighten(rgb, pct) {
  return rgb.map(c => Math.min(255, Math.round(c + (255 - c) * pct)))
}
function darken(rgb, pct) {
  return rgb.map(c => Math.max(0, Math.round(c * (1 - pct))))
}

// ─── Layout ───────────────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_ACCENT_DEFAULT = [250, 204, 21] // Amarillo (#FACC15)
const C_DARK    = [20,  20,  20]       // Negro/Gris muy oscuro (#141414)
const C_TEXT    = [30,  30,  30]
const C_MID     = [100, 100, 100]
const C_LIGHT   = [230, 230, 230]
const C_SUBTLE  = [249, 249, 249]
const C_WHITE   = [255, 255, 255]
const C_GREEN   = [22,  163,  74]
const C_RED     = [220,  38,  38]

// ─── Generador principal ───────────────────────────────────────────────────────
export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)
  const A  = C_ACCENT_DEFAULT // Forzamos amarillo según la plantilla
  const AD = C_DARK           // Forzamos fondo negro
  const AL = [252, 250, 240]  // Amarillo muy sutil para franjas alternas

  const ESTADO_MAP = {
    borrador:  { label: 'BORRADOR',  color: C_DARK },
    enviada:   { label: 'ENVIADA',   color: [22, 110, 220] },
    aceptada:  { label: 'ACEPTADA',  color: C_GREEN },
    rechazada: { label: 'RECHAZADA', color: C_RED },
    vencida:   { label: 'VENCIDA',   color: [148, 163, 184] },
  }

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  const estadoInfo = ESTADO_MAP[cotizacion.estado] || { label: (cotizacion.estado || 'BORRADOR').toUpperCase(), color: C_MID }

  // ══════════════════════════════════════════════════════════════════════════
  // CABECERA — fondo oscuro (variante oscura del color del vendedor)
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 52

  // Fondo oscuro principal
  doc.setFillColor(...AD)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Franja inferior de acento (color vendedor)
  doc.setFillColor(...A)
  doc.rect(0, HDR_H - 3, PAGE_W, 3, 'F')

  // Logo — grande, margen izquierdo
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN, 7, 36, 36) } catch (_) {}
  }
  const textX = logoData ? MARGIN + 40 : MARGIN

  // Nombre empresa
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C_WHITE)
  doc.text(config.nombre_negocio || 'Mi Empresa', textX, 20)

  // RIF + teléfono
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...lighten(AD, 0.55))
  const infoLine = [
    config.rif_negocio      ? `RIF: ${config.rif_negocio}` : null,
    config.telefono_negocio || null,
  ].filter(Boolean).join('   ·   ')
  if (infoLine) doc.text(infoLine, textX, 28)

  // Dirección resumida (2 líneas cortas)
  doc.setFontSize(7)
  doc.setTextColor(...lighten(AD, 0.45))
  const dirCorta = buildDirCorta(config.direccion_negocio)
  dirCorta.forEach((line, i) => doc.text(line, textX, 34 + i * 6))

  // ── Caja correlativo (derecha) ────────────────────────────────────────────
  const boxW = 52
  const boxH = HDR_H - 10
  const boxX = PAGE_W - MARGIN - boxW
  const boxY = 5

  // Fondo de la caja: color vendedor (Amarillo)
  doc.setFillColor(...A)
  doc.roundedRect(boxX, boxY, boxW, boxH, 3, 3, 'F')

  // Franja superior más oscura dentro de la caja (Naranja sutil)
  doc.setFillColor(...darken(A, 0.15))
  doc.roundedRect(boxX, boxY, boxW, 10, 3, 3, 'F')
  doc.rect(boxX, boxY + 6, boxW, 4, 'F')

  // Label "COTIZACIÓN"
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_DARK)
  doc.text('COTIZACIÓN', boxX + boxW / 2, boxY + 7, { align: 'center' })

  // Número grande
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_DARK)
  doc.text(numDisplay, boxX + boxW / 2, boxY + 21, { align: 'center' })

  // Vendedor
  if (cotizacion.vendedor?.nombre) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...darken(A, 0.6))
    doc.text(cotizacion.vendedor.nombre, boxX + boxW / 2, boxY + 29, { align: 'center' })
  }

  // Badge estado
  const badgeY = boxY + boxH - 9
  doc.setFillColor(...C_WHITE)
  doc.roundedRect(boxX + 6, badgeY, boxW - 12, 7, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...estadoInfo.color)
  doc.text(estadoInfo.label, boxX + boxW / 2, badgeY + 4.8, { align: 'center' })

  y = HDR_H + 7

  // ══════════════════════════════════════════════════════════════════════════
  // SECCIÓN DATOS: cliente  |  cotización  |  fechas  (3 columnas)
  // ══════════════════════════════════════════════════════════════════════════
  const bW = (CONTENT_W - 8) / 3
  const bH = 32
  const bY = y
  const colX = [MARGIN, MARGIN + bW + 4, MARGIN + (bW + 4) * 2]

  const cliente = cotizacion.cliente || {}

  const bloques = [
    {
      titulo: 'CLIENTE',
      filas: [
        ['Nombre:', cliente.nombre || '—'],
        ['RIF/CI:', cliente.rif_cedula || '—'],
        ['Teléfono:', cliente.telefono || '—'],
      ],
    },
    {
      titulo: 'COTIZACIÓN',
      filas: [
        ['N°:', numDisplay],
        ['Vendedor:', cotizacion.vendedor?.nombre || '—'],
        ['Estado:', estadoInfo.label],
      ],
    },
    {
      titulo: 'FECHAS',
      filas: [
        ['Emisión:', fmtFecha(cotizacion.creado_en)],
        ['Válida hasta:', cotizacion.valida_hasta ? fmtFecha(cotizacion.valida_hasta) : '—'],
      ],
    },
  ]

  bloques.forEach((b, i) => {
    const bx = colX[i]

    doc.setFillColor(...C_WHITE)
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.35)
    doc.roundedRect(bx, bY, bW, bH, 2, 2, 'FD')

    // Franja superior: Negra
    doc.setFillColor(...C_DARK)
    doc.roundedRect(bx, bY, bW, 7, 2, 2, 'F')
    doc.rect(bx, bY + 4, bW, 3, 'F')
    // Linea amarilla muy fina
    doc.setFillColor(...A)
    doc.rect(bx, bY + 7, bW, 0.8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...A) // Texto amarillo
    doc.text(b.titulo, bx + 4, bY + 5.2)

    b.filas.forEach(([label, val], j) => {
      const fy = bY + 13 + j * 6.5
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_MID)
      doc.text(label, bx + 4, fy)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_TEXT)
      const lines = doc.splitTextToSize(String(val), bW - 24)
      doc.text(lines[0], bx + 24, fy)
    })
  })

  y = bY + bH + 8

  // ══════════════════════════════════════════════════════════════════════════
  // TABLA DE ITEMS
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: '#',           x: MARGIN,        w: 7,   align: 'center' },
    { label: 'Código',      x: MARGIN + 7,    w: 22,  align: 'left'   },
    { label: 'Descripción', x: MARGIN + 29,   w: 68,  align: 'left'   },
    { label: 'Cant.',       x: MARGIN + 97,   w: 14,  align: 'center' },
    { label: 'P. Unit.',    x: MARGIN + 111,  w: 26,  align: 'right'  },
    { label: 'Desc.',       x: MARGIN + 137,  w: 14,  align: 'right'  },
    { label: 'Total',       x: MARGIN + 151,  w: 28,  align: 'right'  },
  ]
  const ROW_H = 7.5

  // Encabezado tabla — oscuro con franja de acento
  doc.setFillColor(...C_DARK)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')
  doc.setFillColor(...A)
  doc.rect(MARGIN, y + 7, CONTENT_W, 1, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    const tx = col.align === 'right' ? col.x + col.w : col.align === 'center' ? col.x + col.w / 2 : col.x + 2
    doc.text(col.label, tx, y + 5.5, { align: col.align })
  })
  y += 8

  items.forEach((item, idx) => {
    if (y > 248) { doc.addPage(); y = MARGIN }

    if (idx % 2 === 1) {
      doc.setFillColor(...AL)
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F')
    }

    const midY = y + ROW_H / 2 + 1.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_MID)
    doc.text(String(idx + 1), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    doc.setTextColor(...A)
    doc.setFont('helvetica', 'bold')
    doc.text(item.codigo_snap || '—', COLS[1].x + 2, midY)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_TEXT)
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 2)
    doc.text(descLines[0], COLS[2].x + 2, midY)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_TEXT)
    doc.text(String(item.cantidad), COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(item.precio_unit_usd), COLS[4].x + COLS[4].w, midY, { align: 'right' })

    doc.setTextColor(...C_MID)
    doc.text(item.descuento_pct > 0 ? `${item.descuento_pct}%` : '—', COLS[5].x + COLS[5].w, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_TEXT)
    doc.text(fmtUsd(item.total_linea_usd), COLS[6].x + COLS[6].w, midY, { align: 'right' })

    y += ROW_H
  })

  // Línea cierre tabla
  doc.setDrawColor(...A)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 6

  // ══════════════════════════════════════════════════════════════════════════
  // TOTALES
  // ══════════════════════════════════════════════════════════════════════════
  if (y > 245) { doc.addPage(); y = MARGIN }

  const totW = 75
  const totX = MARGIN + CONTENT_W - totW

  function totRow(label, value, highlight = false) {
    if (y > 258) { doc.addPage(); y = MARGIN }
    if (highlight) {
      doc.setFillColor(...A)
      doc.roundedRect(totX, y - 5, totW, 14, 2, 2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...C_DARK)
      doc.text(label, totX + 6, y + 2)
      doc.setFontSize(14)
      doc.setTextColor(...C_DARK)
      doc.text(value, totX + totW - 4, y + 5.5, { align: 'right' })
      y += 17
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C_MID)
      doc.text(label, totX + 5, y)
      doc.setTextColor(...C_TEXT)
      doc.text(value, totX + totW - 4, y, { align: 'right' })
      y += 6
    }
  }

  totRow('Subtotal:', fmtUsd(cotizacion.subtotal_usd))
  if (cotizacion.descuento_global_pct > 0) {
    totRow(`Descuento (${cotizacion.descuento_global_pct}%):`, `- ${fmtUsd(cotizacion.descuento_usd)}`)
  }
  if (cotizacion.costo_envio_usd > 0) {
    totRow('Costo de envío:', fmtUsd(cotizacion.costo_envio_usd))
  }
  y += 2
  totRow('TOTAL USD:', fmtUsd(cotizacion.total_usd), true)

  // ══════════════════════════════════════════════════════════════════════════
  // NOTAS
  // ══════════════════════════════════════════════════════════════════════════
  if (cotizacion.notas_cliente?.trim()) {
    if (y > 255) { doc.addPage(); y = MARGIN }
    doc.setFillColor(...C_SUBTLE)
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.3)
    doc.roundedRect(MARGIN, y, CONTENT_W * 0.58, 5, 1, 1, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...A)
    doc.text('NOTAS', MARGIN + 3, y + 3.5)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_TEXT)
    doc.splitTextToSize(cotizacion.notas_cliente.trim(), CONTENT_W * 0.58 - 4).forEach(line => {
      if (y > 268) { doc.addPage(); y = MARGIN }
      doc.text(line, MARGIN + 3, y)
      y += 4.5
    })
    y += 3
  }

  y += 8

  // ══════════════════════════════════════════════════════════════════════════
  // ZONA DE FIRMAS
  // ══════════════════════════════════════════════════════════════════════════
  const pageH = doc.internal.pageSize.getHeight()
  if (y > pageH - 55) { doc.addPage(); y = MARGIN + 5 }

  const firmaW = (CONTENT_W - 8) / 2
  const firmaH = 24
  const firmaY = y

  ;[
    { x: MARGIN,              label: 'Elaborado por' },
    { x: MARGIN + firmaW + 8, label: 'Aceptado por (firma y sello)' },
  ].forEach(({ x, label }) => {
    doc.setFillColor(...C_WHITE)
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.35)
    doc.roundedRect(x, firmaY, firmaW, firmaH, 2, 2, 'FD')

    doc.setFillColor(...C_DARK)
    doc.roundedRect(x, firmaY, firmaW, 7, 2, 2, 'F')
    doc.rect(x, firmaY + 4, firmaW, 3, 'F')
    // Linea sutil amarilla
    doc.setFillColor(...A)
    doc.rect(x, firmaY + 7, firmaW, 0.8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...A)
    doc.text(label, x + firmaW / 2, firmaY + 5, { align: 'center' })

    const lineY = firmaY + firmaH - 5
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.3)
    doc.line(x + 4, lineY, x + firmaW - 4, lineY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_MID)
    doc.text('Nombre y C.I.', x + firmaW / 2, lineY + 3.5, { align: 'center' })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PIE DE PÁGINA — fondo oscuro con datos de contacto
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = doc.internal.pageSize.getHeight()
    const footerH = 14

    doc.setFillColor(...AD)
    doc.rect(0, ph - footerH, PAGE_W, footerH, 'F')
    doc.setFillColor(...A)
    doc.rect(0, ph - footerH, PAGE_W, 1, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...lighten(AD, 0.55))

    const contactItems = [
      config.telefono_negocio || null,
      config.email_negocio    || null,
      'Valencia, Edo. Carabobo · Zona Industrial Aeropuerto · Vía Flor Amarillo',
    ].filter(Boolean)

    doc.text(contactItems.join('   ·   '), PAGE_W / 2, ph - footerH + 5.5, { align: 'center' })
    doc.setTextColor(...lighten(AD, 0.4))
    doc.text(`${numDisplay}  ·  Pág. ${p}/${totalPages}`, PAGE_W / 2, ph - footerH + 10.5, { align: 'center' })
  }

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}

// ─── Construye dirección resumida en 2 líneas ─────────────────────────────────
function buildDirCorta(dir) {
  if (!dir) return []
  // Extrae ciudad y zona de la dirección larga
  return [
    'Valencia, Edo. Carabobo',
    'Zona Industrial Aeropuerto · Vía Flor Amarillo',
  ]
}
