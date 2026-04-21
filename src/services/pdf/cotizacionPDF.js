// src/services/pdf/cotizacionPDF.js
// Genera PDF profesional de Cotización — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'

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
function fmtPrecio(n, moneda, tasa) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  return fmtUsd(n)
}
function fmtTotalLinea(n, moneda, tasa) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(n)} / ${fmtBs(Number(n || 0) * tasa)}`
  return fmtUsd(n)
}

// ─── Layout y Colores ──────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_PRIMARY = [58, 99, 168]     // Mariner — header, footer, accents
const C_ACCENT  = [124, 184, 242]   // Maya Blue — table headers, labels
const C_DARK    = [5, 8, 52]        // Midnight Express — text
const C_WHITE   = [255, 255, 255]

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

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false, monedaPDF = '$', tasa = 0 }) {
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
  const HDR_H = 40
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Decoraciones: Cuadrícula de puntos a la izquierda (color del vendedor)
  const vendedorColor = hexToRgb(cotizacion.vendedor?.color)
  doc.setFillColor(...vendedorColor)
  for(let i = 0; i < 4; i++) {
    for(let j = 0; j < 6; j++) {
      doc.circle(MARGIN + i * 2.5, 4 + j * 2.5, 0.4, 'F')
    }
  }

  // Cuadro derecho con rayas diagonales "Hazard"
  const hazW = 40
  const hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')

  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_PRIMARY)
  for (let k = 0; k < 15; k++) {
    doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)
  }

  // Logo a la izquierda
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 12, 4, 32, 32) } catch (_) {}
  }
  const textX = MARGIN + 48

  // Títulos Negocio Grandes — centrados entre logo y bloque derecho
  const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
  doc.setFont('times', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...C_WHITE)

  let name = config.nombre_negocio || 'CONSTRUACERO CARABOBO'
  let splitName = name.split(' ')
  doc.text((splitName[0] || '').toUpperCase(), textCenterX, 18, { align: 'center' })

  if (splitName.length > 1) {
    doc.setFont('times', 'bold')
    doc.setFontSize(14)
    doc.text(splitName.slice(1).join(' ').toUpperCase(), textCenterX, 27, { align: 'center' })
  }

  // "Cotización" + número a la derecha inferior
  doc.setFontSize(13)
  doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 10, { align: 'right' })
  doc.setFontSize(11)
  doc.text(numDisplay, PAGE_W - MARGIN, HDR_H - 4, { align: 'right' })

  y = HDR_H + 8

  // ── Marca de agua central ──
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    const wmSize = 140
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - wmSize) / 2, (PAGE_H - wmSize) / 2, wmSize, wmSize)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — formato de nota física
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = cotizacion.cliente || {}

  // Fila superior: RIF cliente + Emisión / Vencimiento / Nota #
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)

  // Encabezado tipo "COTIZACIÓN a nombre de:"
  doc.setFillColor(248, 248, 248)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'S')
  doc.text('COTIZACIÓN a nombre de:', MARGIN + 3, y + 4)

  // NOTA # a la derecha
  doc.text(numDisplay, PAGE_W - MARGIN - 3, y + 4, { align: 'right' })
  y += 9

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
  y += 6

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
    doc.setDrawColor(...C_PRIMARY)
    doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5)
    y += 5.5
  })

  y += 3

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : 'TOTAL'
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 16,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 16,   w: 24,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 40,   w: 68,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 108,  w: 16,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 124,  w: 26,  align: 'right'  },
    { label: totalLabel,     x: MARGIN + 150,  w: 32,  align: 'right'  },
  ]
  const ROW_H = 8

  // Cabecera tabla
  doc.setFillColor(...C_ACCENT)
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
  doc.setDrawColor(200, 200, 200)

  items.forEach((item) => {
    if (y > PAGE_H - 50) { doc.addPage(); y = MARGIN }

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

    const tasaEfectiva = tasa > 0 ? tasa : Number(cotizacion.tasa_bcv_snapshot || 0)
    doc.text(fmtPrecio(item.precio_unit_usd, monedaPDF, tasaEfectiva), COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtPrecio(item.total_linea_usd, monedaPDF, tasaEfectiva), COLS[5].x + COLS[5].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Notas Adicionales
  if (cotizacion.notas_cliente?.trim()) {
    y += 3
    if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_ACCENT)
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

  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONDICIONES + CUENTAS BANCARIAS (izquierda) + TOTALES (derecha)
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 70) { doc.addPage(); y = MARGIN }

  // Layout: izquierda condiciones+cuentas, derecha totales
  const totW = monedaPDF === 'mixto' ? 90 : 75
  const totX = PAGE_W - MARGIN - totW
  const leftW = totX - MARGIN - 5

  // ── Condiciones (izquierda) ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_ACCENT)
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

  condY += 2

  // ── Totales (derecha) ──
  const subtotal = Number(cotizacion.subtotal_usd || 0)
  const descuento = Number(cotizacion.descuento_usd || 0)
  const total = Number(cotizacion.total_usd || 0)
  const tasaEfectivaTot = tasa > 0 ? tasa : Number(cotizacion.tasa_bcv_snapshot || 0)
  const totalBs = Number(cotizacion.total_bs_snapshot || 0) || (tasaEfectivaTot > 0 ? total * tasaEfectivaTot : 0)
  const ivaPct = Number(config.iva_pct || 0)
  // Base imponible = subtotal - descuento
  const baseImponible = subtotal - descuento
  const ivaUsd = ivaPct > 0 ? baseImponible * (ivaPct / 100) : 0

  const totLines = []
  totLines.push({ label: 'Subtotal:', val: fmtTotalLinea(subtotal, monedaPDF, tasaEfectivaTot), bold: false })
  if (descuento > 0) {
    const descVal = monedaPDF === 'bs' && tasaEfectivaTot > 0
      ? `-${fmtBs(descuento * tasaEfectivaTot)}`
      : monedaPDF === 'mixto' && tasaEfectivaTot > 0
        ? `-${fmtUsd(descuento)} / -${fmtBs(descuento * tasaEfectivaTot)}`
        : `-${fmtUsd(descuento)}`
    totLines.push({ label: 'Descuento:', val: descVal, bold: false, color: [220, 50, 50] })
  }
  totLines.push({ label: 'Base Imponible:', val: fmtTotalLinea(baseImponible, monedaPDF, tasaEfectivaTot), bold: false })
  if (ivaPct > 0) {
    totLines.push({ label: `IVA (${ivaPct}%):`, val: fmtTotalLinea(ivaUsd, monedaPDF, tasaEfectivaTot), bold: false })
  }

  // Borde del cuadro de totales
  const totStartY = y
  const totLineH = 7
  const totHeight = (totLines.length + 1) * totLineH + 4

  doc.setFillColor(250, 250, 250)
  doc.setDrawColor(220, 220, 220)
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

  // Total grande
  doc.setFillColor(...C_ACCENT)
  doc.rect(totX, ty - 2, totW, 10, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', totX + 4, ty + 5)
  doc.text(fmtTotalLinea(total, monedaPDF, tasaEfectivaTot), totX + totW - 4, ty + 5, { align: 'right' })

  // (Total en Bs omitido en modo USD — solo se muestra en mixto/bs)

  // Avanzar Y al final de lo que sea más alto (condiciones o totales)
  y = Math.max(condY, ty + 14) + 3

  // ── (Sección de firma eliminada) ──

  // ── Slogan ──
  y += 8
  if (y < PAGE_H - 35) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
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
    const hazardY = ph - 25
    doc.setFillColor(...C_DARK)
    doc.rect(0, hazardY, PAGE_W, 4, 'F')

    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.8)
    for(let k = 1; k < 20; k++) {
      doc.line(k * 4, hazardY, k * 4 - 3, hazardY + 4)
      doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 3, hazardY + 4)
    }

    // Franja principal azul
    doc.setFillColor(...C_PRIMARY)
    doc.rect(0, ph - 24, PAGE_W, 24, 'F')

    // ── Icono pin ubicación + dirección ──
    doc.setFillColor(...C_WHITE)
    doc.setDrawColor(...C_WHITE)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...C_WHITE)

    const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
    const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

    // Pin a la izquierda de addr1
    const addr1W = doc.getTextWidth(addr1)
    const addr1X = PAGE_W/2 - addr1W/2
    const pinX = addr1X - 3
    const pinY = ph - 17
    doc.circle(pinX, pinY - 0.3, 1.2, 'F')
    doc.triangle(pinX - 1, pinY, pinX + 1, pinY, pinX, pinY + 2, 'F')

    doc.text(addr1, PAGE_W/2, ph - 15.5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W/2, ph - 12, { align: 'center' })

    // ── Icono teléfono + icono correo en la línea de contacto ──
    doc.setFontSize(6.5)
    const tel = config.telefono_negocio || ''
    const email = config.email_negocio || ''
    if (tel || email) {
      const parts = []
      if (tel) parts.push({ icon: 'phone', text: tel })
      if (email) parts.push({ icon: 'mail', text: email })

      // Calcular ancho total para centrar
      doc.setFont('helvetica', 'normal')
      const gap = 12
      let totalW = 0
      parts.forEach((p, i) => {
        totalW += 5 + doc.getTextWidth(p.text)
        if (i < parts.length - 1) totalW += gap
      })

      let cx = PAGE_W/2 - totalW/2
      const cy = ph - 7

      parts.forEach((p, i) => {
        doc.setFillColor(...C_WHITE)
        doc.setDrawColor(...C_WHITE)
        if (p.icon === 'phone') {
          // Icono teléfono: rectángulo redondeado
          doc.setLineWidth(0.4)
          doc.roundedRect(cx, cy - 2.2, 1.6, 2.8, 0.3, 0.3, 'S')
          doc.setLineWidth(0.3)
          doc.line(cx + 0.3, cy + 0.2, cx + 1.3, cy + 0.2)
        } else {
          // Icono sobre: rectángulo + V
          doc.setLineWidth(0.3)
          doc.rect(cx, cy - 1.8, 2.4, 1.8, 'S')
          doc.line(cx, cy - 1.8, cx + 1.2, cy - 0.6)
          doc.line(cx + 2.4, cy - 1.8, cx + 1.2, cy - 0.6)
        }
        doc.setTextColor(...C_WHITE)
        doc.text(p.text, cx + 4, cy)
        cx += 5 + doc.getTextWidth(p.text) + gap
      })
    }
  }

  const filename = `${numDisplay.replace(/\s+/g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
