// src/services/pdf/cotizacionPDF.js
// Genera PDF profesional de cotización usando jsPDF 4.x
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
  return new Date(f + (f.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ─── Paleta ───────────────────────────────────────────────────────────────────
const PAGE_W    = 210
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_AMBER   = [217, 119,   6]   // amber-600
const C_AMBER2  = [245, 158,  11]   // amber-500
const C_DARK    = [15,   23,  42]   // slate-900
const C_MID     = [100, 116, 139]   // slate-500
const C_LIGHT   = [226, 232, 240]   // slate-200
const C_SUBTLE  = [248, 250, 252]   // slate-50
const C_WHITE   = [255, 255, 255]
const C_GREEN   = [22,  163,  74]
const C_RED     = [220,  38,  38]

const ESTADO_MAP = {
  borrador:  { label: 'BORRADOR',  color: C_MID },
  enviada:   { label: 'ENVIADA',   color: C_AMBER2 },
  aceptada:  { label: 'ACEPTADA',  color: C_GREEN },
  rechazada: { label: 'RECHAZADA', color: C_RED },
  vencida:   { label: 'VENCIDA',   color: [148, 163, 184] },
}

// ─── Generador principal ──────────────────────────────────────────────────────
export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0

  // Cargar logo en paralelo con la generación
  const logoData = await cargarLogo(config.logo_url)

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  const estadoInfo = ESTADO_MAP[cotizacion.estado] || { label: (cotizacion.estado || 'BORRADOR').toUpperCase(), color: C_MID }

  // ══════════════════════════════════════════════════════════════════════════
  // CABECERA
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(...C_AMBER)
  doc.rect(0, 0, PAGE_W, 28, 'F')
  doc.setFillColor(...C_AMBER2)
  doc.rect(0, 0, 3, 28, 'F')

  // Logo (si existe)
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN, 2, 36, 24) } catch (_) {}
  }
  const textStartX = logoData ? MARGIN + 40 : MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...C_WHITE)
  doc.text(config.nombre_negocio || 'Mi Empresa', textStartX, 11)

  const subItems = [
    config.rif_negocio      ? `RIF: ${config.rif_negocio}` : null,
    config.telefono_negocio || null,
    config.direccion_negocio || null,
  ].filter(Boolean)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(254, 243, 199)
  doc.text(subItems.join('  ·  '), textStartX, 17)

  // Bloque número (derecha)
  const docBlockX = PAGE_W - MARGIN - 46
  doc.setFillColor(...C_AMBER2)
  doc.roundedRect(docBlockX, 3, 50, 22, 2, 2, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_WHITE)
  doc.text(numDisplay, docBlockX + 25, 12, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(254, 243, 199)
  doc.text('COTIZACIÓN', docBlockX + 25, 18, { align: 'center' })

  doc.setFillColor(...estadoInfo.color)
  doc.roundedRect(docBlockX + 7, 19.5, 36, 4.5, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_WHITE)
  doc.text(estadoInfo.label, docBlockX + 25, 22.8, { align: 'center' })

  y = 34

  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUES INFO: cliente / cotización / fechas
  // ══════════════════════════════════════════════════════════════════════════
  const bW  = (CONTENT_W - 8) / 3
  const bH  = 34
  const bY  = y
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
      titulo: 'DATOS DE LA COTIZACIÓN',
      filas: [
        ['N° Cotización:', numDisplay],
        ['Vendedor:', cotizacion.vendedor?.nombre || '—'],
        ['Estado:', estadoInfo.label],
      ],
    },
    {
      titulo: 'FECHAS',
      filas: [
        ['Emisión:', fmtFecha(cotizacion.creado_en)],
        ['Válida hasta:', cotizacion.valida_hasta ? fmtFecha(cotizacion.valida_hasta) : '—'],
        ['Tasa BCV:', cotizacion.tasa_bcv_snapshot
          ? `${Number(cotizacion.tasa_bcv_snapshot).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$`
          : '—'],
      ],
    },
  ]

  bloques.forEach((b, i) => {
    const bx = colX[i]
    doc.setFillColor(...C_SUBTLE)
    doc.roundedRect(bx, bY, bW, bH, 2, 2, 'F')
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx, bY, bW, bH, 2, 2, 'S')

    doc.setFillColor(...C_AMBER2)
    doc.roundedRect(bx, bY, bW, 5.5, 2, 2, 'F')
    doc.rect(bx, bY + 3, bW, 2.5, 'F')

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
      const lines = doc.splitTextToSize(String(val), bW - 22)
      doc.text(lines[0], bx + 22, fy)
    })
  })

  y = bY + bH + 7

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
    { label: 'Total',       x: MARGIN + 151,  w: 31,  align: 'right'  },
  ]
  const ROW_H = 7.5

  doc.setFillColor(...C_AMBER)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_WHITE)

  COLS.forEach(col => {
    const tx = col.align === 'right'
      ? col.x + col.w
      : col.align === 'center'
        ? col.x + col.w / 2
        : col.x + 2
    doc.text(col.label, tx, y + 4.8, { align: col.align })
  })
  y += 7

  items.forEach((item, idx) => {
    if (y > 248) { doc.addPage(); y = MARGIN }

    if (idx % 2 === 1) {
      doc.setFillColor(...C_SUBTLE)
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F')
    }

    const midY = y + ROW_H / 2 + 1.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_MID)
    doc.text(String(idx + 1), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    doc.setTextColor(...C_AMBER)
    doc.setFont('helvetica', 'bold')
    doc.text(item.codigo_snap || '—', COLS[1].x + 2, midY)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...C_DARK)
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 2)
    doc.text(descLines[0], COLS[2].x + 2, midY)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(String(item.cantidad), COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(item.precio_unit_usd), COLS[4].x + COLS[4].w, midY, { align: 'right' })

    doc.setTextColor(...C_MID)
    doc.text(item.descuento_pct > 0 ? `${item.descuento_pct}%` : '—', COLS[5].x + COLS[5].w, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(item.total_linea_usd), COLS[6].x + COLS[6].w, midY, { align: 'right' })

    y += ROW_H
  })

  doc.setDrawColor(...C_LIGHT)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // TOTALES
  // ══════════════════════════════════════════════════════════════════════════
  if (y > 245) { doc.addPage(); y = MARGIN }

  const totW = 78
  const totX = MARGIN + CONTENT_W - totW

  function totRow(label, value, highlight = false) {
    if (y > 258) { doc.addPage(); y = MARGIN }
    if (highlight) {
      doc.setFillColor(...C_AMBER)
      doc.roundedRect(totX, y - 5, totW, 12, 2, 2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...C_WHITE)
      doc.text(label, totX + 5, y + 2)
      doc.setFontSize(11)
      doc.text(value, totX + totW - 5, y + 3.5, { align: 'right' })
      y += 14
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C_MID)
      doc.text(label, totX + 5, y)
      doc.setTextColor(...C_DARK)
      doc.text(value, totX + totW - 5, y, { align: 'right' })
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

  if (cotizacion.tasa_bcv_snapshot && cotizacion.total_bs_snapshot) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_MID)
    doc.text(
      `Equivalente: ${fmtBs(cotizacion.total_bs_snapshot)}  (Tasa BCV: ${Number(cotizacion.tasa_bcv_snapshot).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$)`,
      MARGIN + CONTENT_W, y, { align: 'right' }
    )
    y += 6
  }

  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // NOTAS
  // ══════════════════════════════════════════════════════════════════════════
  if (cotizacion.notas_cliente?.trim()) {
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
    doc.splitTextToSize(cotizacion.notas_cliente.trim(), CONTENT_W - 6).forEach(line => {
      if (y > 268) { doc.addPage(); y = MARGIN }
      doc.text(line, MARGIN + 3, y)
      y += 4.5
    })
    y += 3
  }

  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // ZONA DE FIRMAS
  // ══════════════════════════════════════════════════════════════════════════
  const pageH = doc.internal.pageSize.getHeight()
  if (y > pageH - 45) { doc.addPage(); y = MARGIN + 5 }

  const firmaW = (CONTENT_W - 8) / 2
  const firmaH = 25
  const firmaY = y

  ;[
    { x: MARGIN,              label: 'Elaborado por' },
    { x: MARGIN + firmaW + 8, label: 'Aceptado por (firma y sello)' },
  ].forEach(({ x, label }) => {
    doc.setFillColor(...C_SUBTLE)
    doc.setDrawColor(...C_LIGHT)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, firmaY, firmaW, firmaH, 2, 2, 'FD')

    doc.setFillColor(...C_AMBER2)
    doc.roundedRect(x, firmaY, firmaW, 5.5, 2, 2, 'F')
    doc.rect(x, firmaY + 3, firmaW, 2.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(label, x + firmaW / 2, firmaY + 4, { align: 'center' })

    const lineY = firmaY + firmaH - 5
    doc.setDrawColor(...C_LIGHT)
    doc.line(x + 4, lineY, x + firmaW - 4, lineY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_MID)
    doc.text('Nombre y C.I.', x + firmaW / 2, lineY + 3.5, { align: 'center' })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PIE DE PÁGINA
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = doc.internal.pageSize.getHeight()

    doc.setFillColor(...C_AMBER)
    doc.rect(0, ph - 10, PAGE_W, 10, 'F')
    doc.setFillColor(...C_AMBER2)
    doc.rect(0, ph - 10, 3, 10, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(254, 243, 199)

    const pieTxt = config.pie_pagina_pdf || config.direccion_negocio || 'Gracias por su preferencia'
    doc.text(pieTxt, MARGIN, ph - 3.8)
    doc.text(`${numDisplay}  ·  Pág. ${p}/${totalPages}`, PAGE_W - MARGIN, ph - 3.8, { align: 'right' })
  }

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
