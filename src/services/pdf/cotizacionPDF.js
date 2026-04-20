// src/services/pdf/cotizacionPDF.js
// Genera PDF profesional de Cotización — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f + (f.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ─── Layout y Colores ──────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_YELLOW = [124, 184, 242]   // Maya Blue — acentos, líneas
const C_ORANGE = [58, 99, 168]     // Mariner — headers, barras
const C_DARK   = [5, 8, 52]        // Midnight Express — texto, fondos oscuros
const C_WHITE  = [255, 255, 255]

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return C_DARK
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}

// Cuentas bancarias de Construacero
const CUENTAS_BANCARIAS = [
  'CTA. CTE. BANESCO 0134 0187 0128 7104 1852',
  'CTA. CTE. PROVINCIAL 0108 0071 4901 0129 1305',
]

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0

  const logoData = await cargarLogo(config.logo_url)
  const rif = config.rif_negocio || 'J-50115913-0'

  const numDisplay = cotizacion.version > 1
    ? `Nº- ${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `Nº- ${String(cotizacion.numero).padStart(5, '0')}`

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA GIGANTE AMARILLA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 55
  doc.setFillColor(...C_YELLOW)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Decoraciones: Cuadrícula de puntos a la izquierda (color del vendedor)
  const vendedorColor = hexToRgb(cotizacion.vendedor?.color)
  doc.setFillColor(...vendedorColor)
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

  // Logo a la izquierda
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
  doc.text((splitName[0] || '').toUpperCase(), textX, 22)

  if (splitName.length > 1) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(18)
    doc.text(splitName.slice(1).join(' ').toUpperCase(), textX, 32)
  }

  // "Cotización" + número a la derecha inferior
  doc.setFontSize(14)
  doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 12, { align: 'right' })
  doc.setFontSize(12)
  doc.text(numDisplay, PAGE_W - MARGIN, HDR_H - 5, { align: 'right' })

  y = HDR_H + 10

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — formato de nota física
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = cotizacion.cliente || {}

  // Fila superior: RIF cliente + Emisión / Vencimiento / Nota #
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)

  // Encabezado tipo "COTIZACIÓN a nombre de:"
  doc.setFillColor(235, 241, 250)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
  doc.setDrawColor(192, 200, 215)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, y, CONTENT_W, 7, 'S')
  doc.text('COTIZACIÓN a nombre de:', MARGIN + 3, y + 4.8)

  // R.I.F. al centro
  const rifLbl = `R.I.F.: ${rif}`
  doc.text(rifLbl, MARGIN + 70, y + 4.8)

  // NOTA # a la derecha
  doc.text(numDisplay, PAGE_W - MARGIN - 3, y + 4.8, { align: 'right' })
  y += 10

  // Fila de fechas
  const halfW = CONTENT_W / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('Emisión:', MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtFecha(cotizacion.creado_en), MARGIN + 18, y)

  doc.setFont('helvetica', 'bold')
  doc.text('Vencimiento:', MARGIN + halfW, y)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtFecha(cotizacion.valida_hasta), MARGIN + halfW + 25, y)
  y += 7

  // Datos del cliente en líneas subrayadas
  const itemsCliente = [
    { label: 'Cliente', val: cliente.nombre || '—' },
    { label: 'R.I.F / Cédula', val: cliente.rif_cedula || '—' },
    { label: 'Teléfono', val: cliente.telefono || '—' },
    { label: 'Dirección Fiscal', val: cliente.direccion || '—' },
    { label: 'Correo', val: cliente.email || '—' },
    { label: 'Vendedor', val: cotizacion.vendedor?.nombre || '—' },
  ]

  doc.setFontSize(8)
  itemsCliente.forEach(item => {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(`${item.label}: `, MARGIN, y)

    doc.setFont('helvetica', 'normal')
    const lblW = doc.getTextWidth(`${item.label}: `)
    doc.text(String(item.val), MARGIN + lblW + 1, y)

    doc.setLineWidth(0.3)
    doc.setDrawColor(...C_YELLOW)
    doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2)
    y += 7
  })

  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 16,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 16,   w: 24,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 40,   w: 68,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 108,  w: 16,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 124,  w: 26,  align: 'right'  },
    { label: 'TOTAL',       x: MARGIN + 150,  w: 32,  align: 'right'  },
  ]
  const ROW_H = 8

  // Cabecera de tabla azul
  doc.setFillColor(...C_ORANGE)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 5.5, { align: col.align })
  })
  y += 8

  // Items
  doc.setLineWidth(0.2)
  doc.setDrawColor(185, 195, 210)

  items.forEach((item) => {
    if (y > PAGE_H - 90) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + ROW_H / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)

    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    doc.text(descLines[0], COLS[2].x + 2, midY)
    doc.text(item.unidad_snap || '—', COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })
    doc.text(fmtUsd(item.precio_unit_usd), COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd), COLS[5].x + COLS[5].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Notas Adicionales
  if (cotizacion.notas_cliente?.trim()) {
    y += 5
    if (y > PAGE_H - 100) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_ORANGE)
    doc.text('NOTAS:', MARGIN, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(cotizacion.notas_cliente.trim(), CONTENT_W)
    lineas.forEach(lin => {
      y += 4
      doc.text(lin, MARGIN, y + 4)
    })
    y += 4
  }

  y += 8

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONDICIONES + CUENTAS BANCARIAS (izquierda) + TOTALES (derecha)
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 110) { doc.addPage(); y = MARGIN }

  // Layout: izquierda condiciones+cuentas, derecha totales
  const totW = 75
  const totX = PAGE_W - MARGIN - totW
  const leftW = totX - MARGIN - 5

  // ── Condiciones (izquierda) ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_ORANGE)
  doc.text('CONDICIONES GENERALES:', MARGIN, y + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_DARK)

  const condiciones = [
    'Precios Sujetos a cambios sin previo aviso.',
    `Cotización válida por ${config.validez_cotizacion_dias || 8} días continuos.`,
    'Construacero Carabobo corre con el costo del flete.',
    'El cliente se encarga de descargar la mercancía.',
  ]
  let condY = y + 8
  condiciones.forEach(c => {
    doc.text(`• ${c}`, MARGIN, condY)
    condY += 4
  })

  // Cuentas bancarias
  condY += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_ORANGE)
  doc.text('Realizar Transferencias a nombre de', MARGIN, condY)
  condY += 4
  doc.text((config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.').toUpperCase(), MARGIN, condY)
  condY += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_DARK)
  CUENTAS_BANCARIAS.forEach(cuenta => {
    doc.text(cuenta, MARGIN, condY)
    condY += 4
  })

  // ── Totales (derecha) ──
  const subtotal = Number(cotizacion.subtotal_usd || 0)
  const descuento = Number(cotizacion.descuento_usd || 0)
  const total = Number(cotizacion.total_usd || 0)
  const tasaBcv = Number(cotizacion.tasa_bcv_snapshot || 0)
  const totalBs = Number(cotizacion.total_bs_snapshot || 0) || (tasaBcv > 0 ? total * tasaBcv : 0)
  const ivaPct = Number(config.iva_pct || 0)
  // Base imponible = subtotal - descuento
  const baseImponible = subtotal - descuento
  const ivaUsd = ivaPct > 0 ? baseImponible * (ivaPct / 100) : 0

  const totLines = []
  totLines.push({ label: 'Subtotal:', val: fmtUsd(subtotal), bold: false })
  if (descuento > 0) {
    totLines.push({ label: 'Descuento:', val: `-${fmtUsd(descuento)}`, bold: false, color: [220, 50, 50] })
  }
  totLines.push({ label: 'Base Imponible:', val: fmtUsd(baseImponible), bold: false })
  if (ivaPct > 0) {
    totLines.push({ label: `IVA (${ivaPct}%):`, val: fmtUsd(ivaUsd), bold: false })
  }

  // Borde del cuadro de totales
  const totStartY = y
  const totLineH = 7
  const totHeight = (totLines.length + 1) * totLineH + 4

  doc.setFillColor(238, 243, 250)
  doc.setDrawColor(192, 200, 215)
  doc.setLineWidth(0.3)
  doc.roundedRect(totX, totStartY, totW, totHeight, 1.5, 1.5, 'FD')

  let ty = totStartY + 5
  totLines.forEach(line => {
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...(line.color || C_DARK))
    doc.text(line.label, totX + 4, ty)
    doc.text(line.val, totX + totW - 4, ty, { align: 'right' })
    ty += totLineH
  })

  // Total grande azul
  doc.setFillColor(...C_ORANGE)
  doc.rect(totX, ty - 2, totW, 10, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', totX + 4, ty + 5)
  doc.text(fmtUsd(total), totX + totW - 4, ty + 5, { align: 'right' })

  // Total en Bs debajo
  if (tasaBcv > 0) {
    ty += 14
    doc.setFillColor(...C_DARK)
    doc.roundedRect(totX, ty - 2, totW, 9, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_YELLOW)
    doc.text('Total Bs:', totX + 4, ty + 4)
    doc.text(fmtBs(totalBs), totX + totW - 4, ty + 4, { align: 'right' })
  }

  // Avanzar Y al final de lo que sea más alto (condiciones o totales)
  y = Math.max(condY, ty + 14) + 5

  // ── Slogan ──
  y += 8
  if (y < PAGE_H - 45) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('A sus ordenes para cualquier duda. Gracias por preferirnos.', PAGE_W / 2, y, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. FOOTER CON FRANJA DE PRECAUCIÓN
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    // Franja negra superior con las diagonales
    const hazardY = ph - 33
    doc.setFillColor(...C_DARK)
    doc.rect(0, hazardY, PAGE_W, 5, 'F')

    doc.setDrawColor(...C_YELLOW)
    doc.setLineWidth(0.8)
    for(let k = 1; k < 20; k++) {
      doc.line(k * 4, hazardY, k * 4 - 4, hazardY + 5)
      doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 4, hazardY + 5)
    }

    // Franja principal amarilla
    doc.setFillColor(...C_YELLOW)
    doc.rect(0, ph - 28, PAGE_W, 28, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    const lineAddress = config.direccion_negocio || 'VÍA FLOR AMARILLO VALENCIA EDO CARABOBO'
    doc.text(lineAddress, PAGE_W/2, ph - 18, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    const contactParts = [config.telefono_negocio, config.email_negocio].filter(Boolean)
    if (contactParts.length) {
      doc.text(contactParts.join('   |   '), PAGE_W/2, ph - 13, { align: 'center' })
    }

    // RIF en el footer
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(`RIF: ${rif}`, PAGE_W/2, ph - 8, { align: 'center' })
  }

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
