// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Despacho — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtFecha(f) {
  if (!f) return '—'
  const d = new Date(f)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return C_DARK
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}

// ─── Constantes de diseño ─────────────────────────────────────────────────────
const MARGIN    = 14
const PAGE_W    = 210
const PAGE_H    = 297
const CONTENT_W = PAGE_W - MARGIN * 2

const C_PRIMARY = [58, 99, 168]     // Mariner — header, footer, accents
const C_ACCENT  = [124, 184, 242]   // Maya Blue — table headers, labels
const C_DARK    = [5, 8, 52]        // Midnight Express — text
const C_WHITE   = [255, 255, 255]

// Cuentas bancarias de Construacero
const CUENTAS_BANCARIAS = [
  'CTA. CTE. BANESCO 0134 0187 0128 7104 1852',
  'CTA. CTE. PROVINCIAL 0108 0071 4901 0129 1305',
]

function drawCheck(doc, label, x, y, checked = false) {
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.rect(x, y - 2.5, 3, 3, 'S')
  if (checked) {
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

export async function generarDespachoPDF({ despacho, items = [], config = {}, formaPago = '' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const logoData = await cargarLogo(config.logo_url)
  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numDes = `N°- ${String(despacho.numero).padStart(5, '0')}`

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA GIGANTE AMARILLA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 40
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Decoraciones: Cuadrícula de puntos a la izquierda (color del vendedor)
  const vendedorColor = hexToRgb(despacho.vendedor?.color)
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

  // "Nota de Entrega" + número a la derecha inferior
  doc.setFontSize(12)
  doc.text('Nota de Entrega', PAGE_W - MARGIN, HDR_H - 10, { align: 'right' })
  doc.setFontSize(11)
  doc.text(numDes, PAGE_W - MARGIN, HDR_H - 4, { align: 'right' })

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
  const cliente = despacho.cliente || {}

  // Encabezado
  doc.setFillColor(248, 248, 248)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('NOTA DE ENTREGA a nombre de:', MARGIN + 3, y + 4)
  doc.text(`NOTA # ${String(despacho.numero).padStart(6, '0')}`, PAGE_W - MARGIN - 3, y + 4, { align: 'right' })
  y += 9

  // Fila de fechas
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('Emisión:', MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtFecha(despacho.creado_en), MARGIN + 18, y)

  if (despacho.despachada_en) {
    doc.setFont('helvetica', 'bold')
    doc.text('Despachada:', MARGIN + 60, y)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtFecha(despacho.despachada_en), MARGIN + 82, y)
  }

  if (despacho.entregada_en) {
    doc.setFont('helvetica', 'bold')
    doc.text('Entregada:', MARGIN + 120, y)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtFecha(despacho.entregada_en), MARGIN + 140, y)
  }
  y += 6

  // Datos del cliente en líneas subrayadas
  const itemsCliente = [
    { label: 'Cliente', val: cliente.nombre || '—' },
    { label: 'R.I.F / Cédula', val: cliente.rif_cedula || '—' },
    { label: 'Teléfono', val: cliente.telefono || '—' },
    { label: 'Dirección Fiscal', val: cliente.direccion || '—' },
    { label: 'Vendedor', val: despacho.vendedor?.nombre || '—' },
    { label: 'Estado', val: (despacho.estado || 'PENDIENTE').toUpperCase() },
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
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 16,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 16,   w: 24,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 40,   w: 68,  align: 'left'   },
    { label: 'UNID.',       x: MARGIN + 108,  w: 16,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 124,  w: 26,  align: 'right'  },
    { label: 'TOTAL',       x: MARGIN + 150,  w: 32,  align: 'right'  },
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
    doc.text(fmtUsd(item.precio_unit_usd), COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(item.total_linea_usd), COLS[5].x + COLS[5].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Notas Adicionales
  if (despacho.notas?.trim()) {
    y += 3
    if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_ACCENT)
    doc.text('NOTAS:', MARGIN, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    lineas.forEach(lin => {
      y += 4
      doc.text(lin, MARGIN, y + 4)
    })
    y += 4
  }

  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONDICIONES + CUENTAS BANCARIAS (izq) + TOTALES (der)
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 70) { doc.addPage(); y = MARGIN }

  const totW = 75
  const totX = PAGE_W - MARGIN - totW
  const total = Number(despacho.total_usd || 0)

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
  doc.setTextColor(...C_ACCENT)
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
  // Forma de pago
  const fp = (formaPago || despacho.forma_pago || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', totX, y + 4)
  drawCheck(doc, 'EFECTIVO',   totX,      y + 12, fp === 'efectivo')
  drawCheck(doc, 'ZELLE',      totX + 25, y + 12, fp === 'zelle')
  drawCheck(doc, 'P. MÓVIL',   totX + 45, y + 12, fp === 'pago movil')
  drawCheck(doc, 'USDT',       totX + 65, y + 12, fp === 'usdt')

  // Total grande
  const totTopY = y + 18
  doc.setFillColor(...C_ACCENT)
  doc.rect(totX, totTopY, totW, 14, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', totX + 4, totTopY + 9)
  doc.text(fmtUsd(total), totX + totW - 4, totTopY + 9, { align: 'right' })

  // Avanzar Y
  y = Math.max(condY, totTopY + 18) + 5

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 70) { doc.addPage(); y = MARGIN }

  const transportista = despacho.transportista || null
  const col3W = (CONTENT_W - 8) / 3

  // Cabecera gris
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, y + 4)
  y += 10

  // Fila 1: Nombre / C.I. / Teléfono
  const fields1 = [
    { label: 'NOMBRE DEL CHOFER', val: transportista?.nombre   || '' },
    { label: 'N° IDENTIFICACIÓN', val: transportista?.rif      || '' },
    { label: 'TELÉFONO',          val: transportista?.telefono || '' },
  ]
  fields1.forEach((f, i) => {
    const fx = MARGIN + i * (col3W + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(`${f.label}:`, fx, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    if (f.val) doc.text(f.val, fx, y + 4)
    doc.setLineWidth(0.2)
    doc.setDrawColor(...C_PRIMARY)
    doc.line(fx, y + 5.5, fx + col3W, y + 5.5)
  })
  y += 11

  // Fila 2: Tipo de Vehículo / Color / Placa
  const fields2 = [
    { label: 'TIPO DE VEHÍCULO', val: '' },
    { label: 'COLOR',            val: '' },
    { label: 'PLACA',            val: '' },
  ]
  fields2.forEach((f, i) => {
    const fx = MARGIN + i * (col3W + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text(`${f.label}:`, fx, y)
    doc.setLineWidth(0.2)
    doc.setDrawColor(...C_PRIMARY)
    doc.line(fx, y + 5.5, fx + col3W, y + 5.5)
  })
  y += 12

  // ── Slogan ──
  y += 8
  if (y < PAGE_H - 35) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C_DARK)
    doc.text('A sus ordenes para cualquier duda. Gracias por preferirnos.', PAGE_W / 2, y, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER CON FRANJA DE PRECAUCIÓN
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

    const addr1 = 'Av. 76 (Calle 8-9) Nro. 70-C-768, Local Galpón Nro 8, Edif. Centro Industrial Mística II, Parcela Ms-0 Y Ms7'
    const addr2 = 'Urb. Industrial Aeropuerto Vía Flor Amarillo — Valencia, Carabobo, Zona Postal 2003'

    // Pin a la izquierda de addr1
    const addr1W = doc.getTextWidth(addr1)
    const addr1X = PAGE_W/2 - addr1W/2
    const pinX = addr1X - 5
    const pinY = ph - 16
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

  // ── Guardar ───────────────────────────────────────────────────────────────
  doc.save(`${numDes.replace(/ /g, '_')}.pdf`)
}
