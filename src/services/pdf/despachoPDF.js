// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Despacho usando jsPDF 4.x
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs. ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  const d = new Date(f)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Convierte hex (#RRGGBB) → [R, G, B]
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}
// Aclara un color RGB en un porcentaje (0-1)
function lighten(rgb, pct) {
  return rgb.map(c => Math.min(255, Math.round(c + (255 - c) * pct)))
}

// ─── Constantes de diseño ─────────────────────────────────────────────────────
const MARGIN    = 14
const PAGE_W    = 210
const CONTENT_W = PAGE_W - MARGIN * 2

// Paleta base (neutra / fallback cuando no hay color de vendedor)
const C_STEEL   = [18,  26,  44]   // carbón oscuro (fondo principal)
const C_STEEL2  = [30,  44,  74]   // azul acero
const C_ACCENT_DEFAULT = [210, 74, 20]  // naranja industrial (fallback)
const C_DARK    = [15,  23,  42]
const C_MID     = [100, 116, 139]
const C_LIGHT   = [226, 232, 240]
const C_SUBTLE  = [248, 250, 252]
const C_WHITE   = [255, 255, 255]
const C_GREEN   = [22,  163, 74]
const C_RED     = [220,  38,  38]

// ─── Generador principal ──────────────────────────────────────────────────────
/**
 * @param {object}  despacho   — header de la nota (del hook useDespachos)
 * @param {Array}   items      — cotizacion_items[] de la cotización vinculada
 * @param {object}  [config]   — fila de configuracion_negocio
 */
export async function generarDespachoPDF({ despacho, items = [], config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const logoData = await cargarLogo(config.logo_url)
  let y = 0

  // ── Color de acento: usa el color del vendedor, si no el default ──────────
  const C_ACCENT  = hexToRgb(despacho.vendedor?.color) || C_ACCENT_DEFAULT
  const C_ACCENT2 = lighten(C_ACCENT, 0.3)

  // Mapa de estado con el acento dinámico
  const ESTADO_MAP = {
    pendiente:  { label: 'PENDIENTE',  color: C_ACCENT },
    despachada: { label: 'DESPACHADA', color: C_STEEL2 },
    entregada:  { label: 'ENTREGADA',  color: C_GREEN },
    anulada:    { label: 'ANULADA',    color: C_RED },
  }

  // ── Números de documento ──────────────────────────────────────────────────
  const numDes = `DES-${String(despacho.numero).padStart(5, '0')}`
  const numCot = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}${despacho.cotizacion.version > 1 ? ` Rev.${despacho.cotizacion.version}` : ''}`
    : '—'

  const estadoInfo = ESTADO_MAP[despacho.estado] || { label: despacho.estado?.toUpperCase() || '—', color: C_MID }

  // ══════════════════════════════════════════════════════════════════════════
  // CABECERA: franja degradada + datos empresa
  // ══════════════════════════════════════════════════════════════════════════
  // Fondo principal (acero oscuro)
  doc.setFillColor(...C_STEEL)
  doc.rect(0, 0, PAGE_W, 30, 'F')

  // Franja naranja de acento (izquierda)
  doc.setFillColor(...C_ACCENT)
  doc.rect(0, 0, 4, 30, 'F')

  // Línea naranja inferior de cabecera
  doc.setFillColor(...C_ACCENT)
  doc.rect(0, 28.5, PAGE_W, 1.5, 'F')

  // Logo (si existe) — negativo blanco sobre fondo oscuro
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 2, 3, 34, 22) } catch (_) {}
  }
  const textStartX = logoData ? MARGIN + 40 : MARGIN + 8

  // Nombre empresa
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...C_WHITE)
  doc.text(config.nombre_negocio || 'Mi Empresa', textStartX, 12)

  // Sub-datos empresa
  const subItems = [
    config.rif_negocio ? `RIF: ${config.rif_negocio}` : null,
    config.telefono_negocio || null,
    config.direccion_negocio || null,
  ].filter(Boolean)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(200, 210, 225)
  doc.text(subItems.join('   ·   '), textStartX, 19)

  // Bloque número + tipo documento (derecha) — fondo naranja
  const docBlockX = PAGE_W - MARGIN - 48

  doc.setFillColor(...C_ACCENT)
  doc.roundedRect(docBlockX, 3, 52, 24, 2, 2, 'F')

  // Triángulo decorativo izquierdo del bloque
  doc.setFillColor(...C_ACCENT2)
  doc.roundedRect(docBlockX, 3, 8, 24, 2, 2, 'F')
  doc.rect(docBlockX + 4, 3, 4, 24, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...C_WHITE)
  doc.text(numDes, docBlockX + 29, 12, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...lighten(C_ACCENT, 0.5))
  doc.text('NOTA DE DESPACHO', docBlockX + 29, 18, { align: 'center' })

  // Badge de estado (debajo del bloque naranja)
  doc.setFillColor(...C_STEEL2)
  doc.roundedRect(docBlockX + 9, 20, 34, 5, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...estadoInfo.color)
  doc.text(estadoInfo.label, docBlockX + 26, 23.5, { align: 'center' })

  y = 36

  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUE INFO: 3 columnas — cliente / despacho / fechas
  // ══════════════════════════════════════════════════════════════════════════
  const bW   = (CONTENT_W - 8) / 3
  const bH   = 34
  const bY   = y
  const cols = [MARGIN, MARGIN + bW + 4, MARGIN + (bW + 4) * 2]

  const cliente = despacho.cliente || {}

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
      titulo: 'DATOS DEL DESPACHO',
      filas: [
        ['N° Despacho:', numDes],
        ['Cotización:', numCot],
        ['Vendedor:', despacho.vendedor?.nombre || '—'],
      ],
    },
    {
      titulo: 'FECHAS',
      filas: [
        ['Emitida:', fmtFecha(despacho.creado_en)],
        ['Despachada:', fmtFecha(despacho.despachada_en)],
        ['Entregada:', fmtFecha(despacho.entregada_en)],
      ],
    },
  ]

  bloques.forEach((b, i) => {
    const bx = cols[i]

    doc.setFillColor(...C_SUBTLE)
    doc.roundedRect(bx, bY, bW, bH, 2, 2, 'F')
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx, bY, bW, bH, 2, 2, 'S')

    // Tira de color en la parte superior del bloque
    doc.setFillColor(...C_STEEL)
    doc.roundedRect(bx, bY, bW, 5.5, 2, 2, 'F')
    doc.rect(bx, bY + 3, bW, 2.5, 'F') // elimina redondeo inferior

    // Línea naranja debajo del título del bloque
    doc.setFillColor(...C_ACCENT)
    doc.rect(bx, bY + 5.5, bW, 1, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(b.titulo, bx + 3, bY + 4)

    b.filas.forEach(([label, val], j) => {
      const fy = bY + 10 + j * 7
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...C_MID)
      doc.text(label, bx + 3, fy)

      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...C_DARK)
      const maxW = bW - 22
      const lines = doc.splitTextToSize(String(val), maxW)
      doc.text(lines[0], bx + 22, fy)
    })
  })

  y = bY + bH + 7

  // ══════════════════════════════════════════════════════════════════════════
  // TABLA DE ARTÍCULOS
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: '#',           x: MARGIN,        w: 7,   align: 'center' },
    { label: 'Código',      x: MARGIN + 7,    w: 22,  align: 'left'   },
    { label: 'Descripción', x: MARGIN + 29,   w: 74,  align: 'left'   },
    { label: 'Cant.',       x: MARGIN + 103,  w: 14,  align: 'center' },
    { label: 'Unidad',      x: MARGIN + 117,  w: 16,  align: 'center' },
    { label: 'P. Unit.',    x: MARGIN + 133,  w: 24,  align: 'right'  },
    { label: 'Total',       x: MARGIN + 157,  w: 25,  align: 'right'  },
  ]

  const ROW_H = 7.5

  // Encabezado tabla (acero oscuro)
  doc.setFillColor(...C_STEEL)
  doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')
  // Acento naranja en la parte inferior del encabezado
  doc.setFillColor(...C_ACCENT)
  doc.rect(MARGIN, y + 6.5, CONTENT_W, 1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_WHITE)

  COLS.forEach(col => {
    const tx = col.align === 'right'
      ? col.x + col.w
      : col.align === 'center'
        ? col.x + col.w / 2
        : col.x + 2
    doc.text(col.label, tx, y + 5.3, { align: col.align })
  })
  y += 7.5

  // Filas de artículos
  items.forEach((item, idx) => {
    if (y > 248) {
      doc.addPage()
      y = MARGIN
    }

    // Fondo alternado
    if (idx % 2 === 1) {
      doc.setFillColor(...C_SUBTLE)
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F')
    }

    doc.setTextColor(...C_DARK)
    const midY = y + ROW_H / 2 + 1.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)

    // #
    doc.setTextColor(...C_MID)
    doc.text(String(idx + 1), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    // Código (naranja de marca)
    doc.setTextColor(...C_ACCENT)
    doc.setFont('helvetica', 'bold')
    doc.text(item.codigo_snap || '—', COLS[1].x + 2, midY)

    // Descripción
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_DARK)
    const desc = item.nombre_snap || ''
    const descLines = doc.splitTextToSize(desc, COLS[2].w - 2)
    doc.text(descLines[0], COLS[2].x + 2, midY)

    // Cantidad
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(String(item.cantidad), COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    // Unidad
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_MID)
    doc.text(item.unidad_snap || '—', COLS[4].x + COLS[4].w / 2, midY, { align: 'center' })

    // Precio
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(item.precio_unit_usd), COLS[5].x + COLS[5].w, midY, { align: 'right' })

    // Total línea
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd), COLS[6].x + COLS[6].w, midY, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    y += ROW_H
  })

  // Línea cierre tabla
  doc.setDrawColor(...C_LIGHT)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // TOTALES
  // ══════════════════════════════════════════════════════════════════════════
  if (y > 245) { doc.addPage(); y = MARGIN }

  const totW  = 75
  const totX  = MARGIN + CONTENT_W - totW
  const total = Number(despacho.total_usd || 0)

  // Caja total (acero oscuro)
  doc.setFillColor(...C_STEEL)
  doc.roundedRect(totX, y, totW, 14, 2, 2, 'F')
  // Borde naranja izquierdo del total
  doc.setFillColor(...C_ACCENT)
  doc.roundedRect(totX, y, 4, 14, 2, 2, 'F')
  doc.rect(totX + 2, y, 2, 14, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(200, 210, 225)
  doc.text('TOTAL USD', totX + 8, y + 5.5)
  doc.setFontSize(12)
  doc.setTextColor(...C_WHITE)
  doc.text(fmtUsd(total), totX + totW - 5, y + 10, { align: 'right' })

  y += 18

  // Notas del despacho
  if (despacho.notas?.trim()) {
    if (y > 255) { doc.addPage(); y = MARGIN }
    doc.setFillColor(...C_SUBTLE)
    doc.roundedRect(MARGIN, y, CONTENT_W, 4.5, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_MID)
    doc.text('NOTAS', MARGIN + 3, y + 3.2)
    y += 6.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    const noteLines = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W - 6)
    noteLines.forEach(line => {
      if (y > 268) { doc.addPage(); y = MARGIN }
      doc.text(line, MARGIN + 3, y)
      y += 4.5
    })
    y += 3
  }

  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // ZONA DE FIRMAS
  // ══════════════════════════════════════════════════════════════════════════
  const pageH = doc.internal.pageSize.getHeight()
  // Si no caben las firmas en esta página, nueva página
  if (y > pageH - 55) { doc.addPage(); y = MARGIN + 5 }

  const firmaY   = y + 8
  const firmaH   = 30
  const firmaW   = (CONTENT_W - 12) / 3
  const firmaXs  = [MARGIN, MARGIN + firmaW + 6, MARGIN + (firmaW + 6) * 2]
  const firmaLabels = ['Elaborado por', 'Entregado por', 'Recibido por (firma y sello)']

  doc.setDrawColor(...C_LIGHT)
  doc.setLineWidth(0.3)

  firmaXs.forEach((fx, i) => {
    doc.setFillColor(...C_SUBTLE)
    doc.roundedRect(fx, firmaY, firmaW, firmaH, 2, 2, 'FD')

    // Etiqueta superior (acero oscuro)
    doc.setFillColor(...C_STEEL)
    doc.roundedRect(fx, firmaY, firmaW, 5.5, 2, 2, 'F')
    doc.rect(fx, firmaY + 3, firmaW, 2.5, 'F')
    // Línea naranja inferior del encabezado de firma
    doc.setFillColor(...C_ACCENT)
    doc.rect(fx, firmaY + 5.5, firmaW, 0.8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(firmaLabels[i], fx + firmaW / 2, firmaY + 4, { align: 'center' })

    // Campos internos
    const lineY = firmaY + firmaH - 5
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.3)
    doc.line(fx + 4, lineY, fx + firmaW - 4, lineY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_MID)
    doc.text('Nombre y C.I.', fx + firmaW / 2, lineY + 3.5, { align: 'center' })

    // Si es el vendedor, pre-llenar
    if (i === 1 && despacho.vendedor?.nombre) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)
      doc.text(despacho.vendedor.nombre, fx + firmaW / 2, firmaY + 18, { align: 'center' })
    }
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PIE DE PÁGINA en todas las páginas
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = doc.internal.pageSize.getHeight()

    doc.setFillColor(...C_STEEL)
    doc.rect(0, ph - 10, PAGE_W, 10, 'F')
    // Franja naranja izquierda en pie
    doc.setFillColor(...C_ACCENT)
    doc.rect(0, ph - 10, 4, 10, 'F')
    // Línea superior del pie
    doc.setFillColor(...C_ACCENT)
    doc.rect(0, ph - 10, PAGE_W, 0.8, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(200, 210, 225)

    const pieTxt = config.pie_pagina_pdf
      || config.direccion_negocio
      || 'Documento emitido por sistema ListoPOS'
    doc.text(pieTxt, MARGIN, ph - 3.8)
    doc.text(`${numDes}  ·  Pág. ${p}/${totalPages}`, PAGE_W - MARGIN, ph - 3.8, { align: 'right' })
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  doc.save(`${numDes}.pdf`)
}
