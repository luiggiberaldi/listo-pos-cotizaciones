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

// ─── Layout y Colores ──────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_YELLOW = [250, 204, 21]
const C_ORANGE = [245, 158, 11]
const C_DARK   = [20, 20, 20]
const C_WHITE  = [255, 255, 255]
const C_GRAY   = [120, 120, 120]

// Dibuja campo etiqueta + valor + línea subrayada
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

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)

  const numDisplay = cotizacion.version > 1
    ? `Nº- ${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `Nº- ${String(cotizacion.numero).padStart(5, '0')}`

  const cliente = cotizacion.cliente || {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA GIGANTE AMARILLA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 55
  doc.setFillColor(...C_YELLOW)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Cuadrícula de puntos izquierda
  doc.setFillColor(...C_DARK)
  for(let i = 0; i < 4; i++) {
    for(let j = 0; j < 8; j++) {
      doc.circle(MARGIN + i * 2.5, 6 + j * 2.5, 0.4, 'F')
    }
  }

  // Rayas "Hazard" derecha
  const hazW = 40
  const hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_YELLOW)
  for (let k = 0; k < 15; k++) {
    doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)
  }

  // Logo
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 14, 8, 38, 38) } catch (_) {}
  }
  const textX = MARGIN + 58

  // Nombre negocio
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

  // "Cotización" + número
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 12, { align: 'right' })
  doc.setFontSize(12)
  doc.text(numDisplay, PAGE_W - MARGIN, HDR_H - 5, { align: 'right' })

  y = HDR_H + 10

  // ══════════════════════════════════════════════════════════════════════════
  // 2. ÁREA DEL CLIENTE — DOS COLUMNAS
  // ══════════════════════════════════════════════════════════════════════════
  const colW  = (CONTENT_W - 6) / 2
  const col2X = MARGIN + colW + 6

  // Fila 1: DÍA + FECHA
  drawField(doc, 'DÍA',   fmtDia(cotizacion.creado_en),    MARGIN, y, colW)
  drawField(doc, 'FECHA', fmtFecha(cotizacion.creado_en),  col2X,  y, colW)
  y += 9

  // Fila 2: CLIENTE (ancho completo)
  drawField(doc, 'NOMBRE', cliente.nombre || '—', MARGIN, y, CONTENT_W)
  y += 9

  // Fila 3: RIF/CI + TELÉFONO
  drawField(doc, 'RIF / C.I.', cliente.rif_cedula || '—', MARGIN, y, colW)
  drawField(doc, 'TELÉFONO',   cliente.telefono   || '—', col2X,  y, colW)
  y += 9

  // Fila 4: DIRECCIÓN
  drawField(doc, 'DIRECCIÓN', cliente.direccion || '—', MARGIN, y, CONTENT_W)
  y += 9

  // Fila 5: VENDEDOR + VÁLIDO HASTA
  drawField(doc, 'VENDEDOR',     cotizacion.vendedor?.nombre || '—',   MARGIN, y, colW)
  drawField(doc, 'VÁLIDO HASTA', fmtFecha(cotizacion.valida_hasta),    col2X,  y, colW)
  y += 12

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA: ITEM | CÓD. | DESCRIPCIÓN | UNID. | P. UNIT. | CANT. | TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'ITEM',        x: MARGIN,        w: 10,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 10,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 30,   w: 66,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 96,   w: 14,  align: 'center' },
    { label: 'P. UNIT.',    x: MARGIN + 110,  w: 26,  align: 'right'  },
    { label: 'CANT.',       x: MARGIN + 136,  w: 14,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 150,  w: 32,  align: 'right'  },
  ]
  const ROW_H = 8

  // Cabecera naranja
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

  // Filas
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  items.forEach((item, idx) => {
    if (y > PAGE_H - 80) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + ROW_H / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)

    doc.text(String(idx + 1),                         COLS[0].x + COLS[0].w/2,  midY, { align: 'center' })
    doc.text(item.codigo_snap || '—',                 COLS[1].x + COLS[1].w/2,  midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    doc.text(descLines[0],                             COLS[2].x + 2,             midY)
    doc.text(item.unidad_snap || '—',                 COLS[3].x + COLS[3].w/2,  midY, { align: 'center' })
    doc.text(fmtUsd(item.precio_unit_usd),            COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })
    doc.text(String(item.cantidad),                   COLS[5].x + COLS[5].w/2,  midY, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd),            COLS[6].x + COLS[6].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Notas
  if (cotizacion.notas_cliente?.trim()) {
    y += 4
    if (y > PAGE_H - 95) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_ORANGE)
    doc.text('NOTAS:', MARGIN, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(cotizacion.notas_cliente.trim(), CONTENT_W)
    lineas.forEach(lin => { y += 4; doc.text(lin, MARGIN, y + 4) })
    y += 4
  }

  y += 8

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TOTALES LATERAL DERECHO
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 100) { doc.addPage(); y = MARGIN }

  const totW    = 75
  const totX    = PAGE_W - MARGIN - totW
  const ivaPct  = Number(config.iva_pct || 0)
  const ivaBase = Number(cotizacion.subtotal_usd || 0) - Number(cotizacion.descuento_usd || 0)
  const ivaUsd  = ivaPct > 0 ? Math.round(ivaBase * ivaPct) / 100 : 0

  // Calcular altura del bloque de totales
  const hasDescuento = Number(cotizacion.descuento_usd || 0) > 0
  const hasEnvio     = Number(cotizacion.costo_envio_usd || 0) > 0
  let boxH = 18
  if (ivaPct > 0)    boxH += 9
  if (hasDescuento)  boxH += 9
  if (hasEnvio)      boxH += 9

  doc.setFillColor(...C_ORANGE)
  doc.rect(totX, y, totW, boxH, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)

  let ty = y + 8
  // Subtotal
  doc.text('Subtotal', totX + 5, ty)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtUsd(cotizacion.subtotal_usd), totX + totW - 5, ty, { align: 'right' })
  ty += 9

  // Descuento
  if (hasDescuento) {
    doc.setFont('helvetica', 'bold')
    const dPct = Number(cotizacion.descuento_global_pct || 0)
    doc.text(`Descuento${dPct > 0 ? ` (${dPct}%)` : ''}`, totX + 5, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(`- ${fmtUsd(cotizacion.descuento_usd)}`, totX + totW - 5, ty, { align: 'right' })
    ty += 9
  }

  // Envío
  if (hasEnvio) {
    doc.setFont('helvetica', 'bold')
    doc.text('Envío', totX + 5, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(cotizacion.costo_envio_usd), totX + totW - 5, ty, { align: 'right' })
    ty += 9
  }

  // IVA
  if (ivaPct > 0) {
    doc.setFont('helvetica', 'bold')
    doc.text(`IVA (${ivaPct}%)`, totX + 5, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(ivaUsd), totX + totW - 5, ty, { align: 'right' })
    ty += 9
  }

  // TOTAL grande
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('TOTAL', totX + 5, ty)
  doc.setFontSize(14)
  doc.text(fmtUsd(cotizacion.total_usd), totX + totW - 5, ty, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. FIRMAS: ASESOR / APROBADO / ACEPTA CONFORME
  // ══════════════════════════════════════════════════════════════════════════
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
  // 6. FOOTER CON FRANJA DE PRECAUCIÓN (todas las páginas)
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

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
