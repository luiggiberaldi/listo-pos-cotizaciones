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

// ─── Layout y Colores ──────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_YELLOW = [250, 204, 21] // Amarillo vibrante principal
const C_ORANGE = [245, 158, 11] // Naranja-amarillo cabeceras
const C_DARK   = [20, 20, 20]   // Negro/Gris muy oscuro
const C_WHITE  = [255, 255, 255]

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  let y = 0
  
  const logoData = await cargarLogo(config.logo_url)
  
  const numDisplay = cotizacion.version > 1
    ? `Nº- ${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `Nº- ${String(cotizacion.numero).padStart(5, '0')}`

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
  
  // "Cotización" a la derecha inferior
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 12, { align: 'right' })
  doc.setFontSize(12)
  doc.text(numDisplay, PAGE_W - MARGIN, HDR_H - 5, { align: 'right' })
  
  y = HDR_H + 12

  // ══════════════════════════════════════════════════════════════════════════
  // 2. ÁREA DEL CLIENTE (Líneas subrayadas)
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = cotizacion.cliente || {}
  const itemsCliente = [
    { label: 'NOMBRE', val: cliente.nombre || '—' },
    { label: 'TELÉFONO', val: cliente.telefono || '—' },
    { label: 'E-MAIL/RIF', val: cliente.rif_cedula || '—' },
    { label: 'DIRECCIÓN', val: cliente.direccion || config.direccion_cliente || '—' },
    { label: 'FECHA DE EMISIÓN', val: fmtFecha(cotizacion.creado_en) }
  ]
  
  doc.setFontSize(8)
  itemsCliente.forEach(item => {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...C_DARK)
    doc.text(`${item.label}: `, MARGIN, y)
    
    doc.setFont('helvetica', 'normal')
    const lblW = doc.getTextWidth(`${item.label}: `)
    doc.text(String(item.val), MARGIN + lblW + 1, y)
    
    // Línea horizontal amarilla fina
    doc.setLineWidth(0.3)
    doc.setDrawColor(...C_YELLOW)
    doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2)
    y += 8
  })

  y += 5

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA CON FILAS TRANSPARENTES Y BORDES GRISES
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 16,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 16,   w: 92,  align: 'left'   },
    { label: 'P. UNIT.',    x: MARGIN + 108,  w: 36,  align: 'right'  },
    { label: 'TOTAL',       x: MARGIN + 144,  w: 38,  align: 'right'  },
  ]
  const ROW_H = 8

  // Cabecera Naranja
  doc.setFillColor(...C_ORANGE)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
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
    if (y > PAGE_H - 75) { doc.addPage(); y = MARGIN }
    
    // Rectangulo base de la fila
    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    // Lineas divisorias verticales de la tabla
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })
    
    const midY = y + ROW_H / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    
    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[1].w - 4)
    doc.text(descLines[0], COLS[1].x + 2, midY)
    doc.text(fmtUsd(item.precio_unit_usd), COLS[2].x + COLS[2].w - 2, midY, { align: 'right' })
    doc.text(fmtUsd(item.total_linea_usd), COLS[3].x + COLS[3].w - 2, midY, { align: 'right' })
    
    y += ROW_H
  })

  // Notas Adicionales
  if (cotizacion.notas_cliente?.trim()) {
    y += 5
    if (y > PAGE_H - 85) { doc.addPage(); y = MARGIN }
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

  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TOTALES LATERAL DERECHO
  // ══════════════════════════════════════════════════════════════════════════
  const totW = 75
  const totX = PAGE_W - MARGIN - totW

  if (y > PAGE_H - 100) { doc.addPage(); y = MARGIN }

  doc.setFillColor(...C_ORANGE)
  doc.rect(totX, y, totW, 25, 'F')
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Subtotal', totX + 5, y + 8)
  doc.setFontSize(13)
  doc.text('TOTAL', totX + 5, y + 18)
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(fmtUsd(cotizacion.subtotal_usd), totX + totW - 5, y + 8, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(fmtUsd(cotizacion.total_usd), totX + totW - 5, y + 18, { align: 'right' })

  // Firmas a la izquierda del total
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('Elaborado por', MARGIN + 25, y + 10, { align: 'center' })
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, y + 15, MARGIN + 50, y + 15)
  if (cotizacion.vendedor?.nombre) {
    doc.text(cotizacion.vendedor.nombre, MARGIN + 25, y + 19, { align: 'center' })
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
    // Diagonales a la izquierda y derecha
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
    doc.text(lineAddress, PAGE_W/2, ph - 16, { align: 'center' })
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    const extraContacts = [config.telefono_negocio, config.email_negocio].filter(Boolean).join('   |   ')
    if (extraContacts) {
      doc.text(extraContacts, PAGE_W/2, ph - 11, { align: 'center' })
    }
  }

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
