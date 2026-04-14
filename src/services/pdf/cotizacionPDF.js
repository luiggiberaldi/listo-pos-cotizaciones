// src/services/pdf/cotizacionPDF.js
// Genera PDF profesional de cotización usando jsPDF 4.x
import { jsPDF } from 'jspdf'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs. ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f + 'T12:00:00').toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ─── Constantes de diseño ─────────────────────────────────────────────────────
const MARGIN = 14
const PAGE_W = 210   // A4 mm
const CONTENT_W = PAGE_W - MARGIN * 2

// Paleta
const COLOR_AMBER  = [245, 158, 11]   // amber-500
const COLOR_DARK   = [30,  41,  59]   // slate-800
const COLOR_MID    = [100, 116, 139]  // slate-500
const COLOR_LIGHT  = [226, 232, 240]  // slate-200
const COLOR_WHITE  = [255, 255, 255]
const COLOR_ROW_ALT = [248, 250, 252] // slate-50

// ─── Generador principal ──────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {object} opts.cotizacion   — header de cotización (del hook useCotizacion)
 * @param {Array}  opts.items        — array de cotizacion_items
 * @param {object} [opts.config]     — fila de configuracion_negocio (puede ser {})
 * @returns {void} — llama a doc.save() para descargar el PDF
 */
export function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  let y = MARGIN  // cursor vertical

  // ── Número de cotización ──────────────────────────────────────────────────
  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  // ── CABECERA ──────────────────────────────────────────────────────────────
  // Franja amber
  doc.setFillColor(...COLOR_AMBER)
  doc.rect(0, 0, PAGE_W, 22, 'F')

  // Nombre del negocio
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...COLOR_WHITE)
  doc.text(config.nombre_negocio || 'Mi Empresa', MARGIN, 10)

  // Subtítulo / RIF
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const subHeader = [
    config.rif_negocio     ? `RIF: ${config.rif_negocio}` : null,
    config.telefono_negocio ? config.telefono_negocio : null,
  ].filter(Boolean).join('  ·  ')
  if (subHeader) doc.text(subHeader, MARGIN, 16)

  // Número de cotización (esquina derecha)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(numDisplay, PAGE_W - MARGIN, 10, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('COTIZACIÓN', PAGE_W - MARGIN, 16, { align: 'right' })

  y = 30

  // ── BLOQUE: Info cotización + cliente ─────────────────────────────────────
  // Dos columnas: izquierda = datos cot, derecha = datos cliente
  const colW = CONTENT_W / 2 - 4

  // Columna izquierda
  doc.setFillColor(...COLOR_LIGHT)
  doc.roundedRect(MARGIN, y, colW, 32, 2, 2, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLOR_MID)
  doc.text('DATOS DE LA COTIZACIÓN', MARGIN + 3, y + 5)

  doc.setTextColor(...COLOR_DARK)
  doc.setFontSize(8)
  const leftRows = [
    ['Fecha:', fmtFecha(cotizacion.creado_en)],
    ['Válida hasta:', cotizacion.valida_hasta ? fmtFecha(cotizacion.valida_hasta) : '—'],
    ['Estado:', (cotizacion.estado || 'borrador').charAt(0).toUpperCase() + (cotizacion.estado || 'borrador').slice(1)],
  ]
  leftRows.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, MARGIN + 3, y + 11 + i * 6)
    doc.setFont('helvetica', 'normal')
    doc.text(value, MARGIN + 28, y + 11 + i * 6)
  })

  // Columna derecha
  const colX2 = MARGIN + colW + 8
  doc.setFillColor(...COLOR_LIGHT)
  doc.roundedRect(colX2, y, colW, 32, 2, 2, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLOR_MID)
  doc.text('CLIENTE', colX2 + 3, y + 5)

  doc.setTextColor(...COLOR_DARK)
  doc.setFontSize(8)
  const TIPO_LABELS = {
    ferreteria: 'Ferretería', constructor: 'Constructor',
    particular: 'Particular', empresa: 'Empresa',
  }
  const cliente = cotizacion.cliente || {}
  const rightRows = [
    ['Nombre:', cliente.nombre || '—'],
    ['Tipo:', TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente || '—'],
    ['RIF/CI:', cliente.rif_cedula || '—'],
    ['Teléfono:', cotizacion.cliente?.telefono || '—'],
  ]
  rightRows.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, colX2 + 3, y + 11 + i * 6)
    doc.setFont('helvetica', 'normal')
    // truncar si es muy largo
    const maxW = colW - 22
    const truncated = doc.getStringUnitWidth(value) * 8 / doc.internal.scaleFactor > maxW
      ? value.substring(0, Math.floor(maxW / 2.5)) + '...'
      : value
    doc.text(truncated, colX2 + 22, y + 11 + i * 6)
  })

  y += 40

  // ── TABLA DE ITEMS ────────────────────────────────────────────────────────
  // Encabezado tabla
  const colsDef = [
    { label: '#',          x: MARGIN,         w: 8,   align: 'center' },
    { label: 'Código',     x: MARGIN + 8,     w: 20,  align: 'left'   },
    { label: 'Descripción',x: MARGIN + 28,    w: 72,  align: 'left'   },
    { label: 'Cant.',      x: MARGIN + 100,   w: 14,  align: 'center' },
    { label: 'P. Unit.',   x: MARGIN + 114,   w: 24,  align: 'right'  },
    { label: 'Desc.',      x: MARGIN + 138,   w: 16,  align: 'right'  },
    { label: 'Total',      x: MARGIN + 154,   w: 28,  align: 'right'  },
  ]

  // Fila encabezado
  doc.setFillColor(...COLOR_AMBER)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLOR_WHITE)
  colsDef.forEach(col => {
    const textX = col.align === 'right'
      ? col.x + col.w
      : col.align === 'center'
        ? col.x + col.w / 2
        : col.x + 1.5
    doc.text(col.label, textX, y + 4.8, { align: col.align })
  })
  y += 7

  // Filas de items
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  items.forEach((item, idx) => {
    // Nueva página si no alcanza
    if (y > 250) {
      doc.addPage()
      y = MARGIN
    }

    // Fondo alternado
    if (idx % 2 === 1) {
      doc.setFillColor(...COLOR_ROW_ALT)
      doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    }

    doc.setTextColor(...COLOR_DARK)
    const rowH = 7
    const midY = y + rowH / 2 + 1.5

    // #
    doc.text(String(idx + 1), colsDef[0].x + colsDef[0].w / 2, midY, { align: 'center' })
    // Código
    doc.text(item.codigo_snap || '—', colsDef[1].x + 1.5, midY)
    // Descripción (puede hacer wrap)
    const desc = item.nombre_snap || ''
    const maxDescW = colsDef[2].w - 2
    const descLines = doc.splitTextToSize(desc, maxDescW)
    doc.text(descLines[0], colsDef[2].x + 1.5, midY) // solo primera línea en tabla compacta
    // Cantidad
    doc.text(String(item.cantidad), colsDef[3].x + colsDef[3].w / 2, midY, { align: 'center' })
    // Precio unit
    doc.text(fmtUsd(item.precio_unit_usd), colsDef[4].x + colsDef[4].w, midY, { align: 'right' })
    // Descuento
    doc.text(item.descuento_pct > 0 ? `${item.descuento_pct}%` : '—', colsDef[5].x + colsDef[5].w, midY, { align: 'right' })
    // Total línea
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd), colsDef[6].x + colsDef[6].w, midY, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    y += rowH
  })

  // Línea inferior tabla
  doc.setDrawColor(...COLOR_LIGHT)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 4

  // ── BLOQUE TOTALES ────────────────────────────────────────────────────────
  const totX = MARGIN + CONTENT_W - 70  // columna de totales alineada a la derecha

  function totRow(label, value, bold = false, highlight = false) {
    if (y > 260) { doc.addPage(); y = MARGIN }
    if (highlight) {
      doc.setFillColor(...COLOR_AMBER)
      doc.rect(totX - 2, y - 4, 72, 7, 'F')
      doc.setTextColor(...COLOR_WHITE)
    } else {
      doc.setTextColor(...COLOR_DARK)
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(8.5)
    doc.text(label, totX + 10, y)
    doc.text(value, MARGIN + CONTENT_W, y, { align: 'right' })
    if (highlight) doc.setTextColor(...COLOR_DARK)
    y += 6
  }

  totRow('Subtotal:', fmtUsd(cotizacion.subtotal_usd))
  if (cotizacion.descuento_global_pct > 0) {
    totRow(`Descuento (${cotizacion.descuento_global_pct}%):`, `- ${fmtUsd(cotizacion.descuento_usd)}`)
  }
  if (cotizacion.costo_envio_usd > 0) {
    totRow('Envío:', fmtUsd(cotizacion.costo_envio_usd))
  }
  y += 1
  totRow('TOTAL USD:', fmtUsd(cotizacion.total_usd), true, true)

  // Total en Bs si hay tasa snapshot
  if (cotizacion.tasa_bcv_snapshot && cotizacion.total_bs_snapshot) {
    y += 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...COLOR_MID)
    doc.text(
      `Equivalente: ${fmtBs(cotizacion.total_bs_snapshot)}  (Tasa BCV: ${Number(cotizacion.tasa_bcv_snapshot).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$)`,
      MARGIN + CONTENT_W,
      y,
      { align: 'right' }
    )
    y += 6
  }

  y += 4

  // ── NOTAS AL CLIENTE ──────────────────────────────────────────────────────
  if (cotizacion.notas_cliente?.trim()) {
    if (y > 255) { doc.addPage(); y = MARGIN }
    doc.setFillColor(...COLOR_ROW_ALT)
    doc.roundedRect(MARGIN, y, CONTENT_W, 4, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...COLOR_MID)
    doc.text('NOTAS', MARGIN + 3, y + 2.8)
    y += 6

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLOR_DARK)
    const notaLines = doc.splitTextToSize(cotizacion.notas_cliente.trim(), CONTENT_W - 6)
    notaLines.forEach(line => {
      if (y > 270) { doc.addPage(); y = MARGIN }
      doc.text(line, MARGIN + 3, y)
      y += 5
    })
    y += 2
  }

  // ── PIE DE PÁGINA ─────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)

    // Franja inferior
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFillColor(...COLOR_LIGHT)
    doc.rect(0, pageH - 12, PAGE_W, 12, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...COLOR_MID)

    // Pie personalizado
    const pieTexto = config.pie_pagina_pdf ||
      (config.direccion_negocio ? config.direccion_negocio : 'Gracias por su preferencia')
    doc.text(pieTexto, MARGIN, pageH - 5.5)

    // Paginación
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, pageH - 5.5, { align: 'right' })
  }

  // ── GUARDAR ───────────────────────────────────────────────────────────────
  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`

  if (returnBlob) {
    return doc.output('blob')
  }

  doc.save(filename)
  return null
}
