// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Despacho — formato Construacero Carabobo
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBcvUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPrecio(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if ((moneda === 'bcv' || moneda === 'mixto_bcv') && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  return fmtUsd(n)
}
function fmtTotal(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if (moneda === 'bcv' && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(n)} / ${fmtBs(Number(n || 0) * tasa)}`
  if (moneda === 'mixto_bcv' && factorBcv > 0 && tasa > 0) return `${fmtBcvUsd(Number(n || 0) * factorBcv)} / ${fmtBs(Number(n || 0) * tasa)}`
  return fmtUsd(n)
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
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text(label, x + 4.5, y)
}

export async function generarDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numDes = `N°- ${String(despacho.numero).padStart(5, '0')}`

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA HORIZONTAL COMPACTA (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 20

  // Logo a la izquierda (más pequeño)
  try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 1, 22, 22) } catch (_) {}

  // Nombre del negocio centrado
  const centerX = PAGE_W / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C_DARK)
  doc.text('CONSTRUACERO CARABOBO, C.A.', centerX, 11, { align: 'center' })

  // RIF centrado
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('RIF.: J-50115913-0', centerX, 16, { align: 'center' })

  // Línea separadora
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, HDR_H + 4, PAGE_W - MARGIN, HDR_H + 4)

  y = HDR_H + 11

  // ── Marca de agua central ──
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    const wmSize = 140
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - wmSize) / 2, (PAGE_H - wmSize) / 2, wmSize, wmSize)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — compacto
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente || {}

  // Barra ORDEN DE DESPACHO con fechas integradas
  const notaBarY = y - 4
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, notaBarY, CONTENT_W, 7, 'F')
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, notaBarY, CONTENT_W, 7, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('ORDEN DE DESPACHO', MARGIN + 3, notaBarY + 5)
  doc.text(numDes, PAGE_W - MARGIN - 3, notaBarY + 5, { align: 'right' })

  // Fechas dentro de la barra
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let fechaX = MARGIN + 55
  doc.setFont('helvetica', 'bold')
  doc.text('Emisión:', fechaX, notaBarY + 5)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtFecha(despacho.creado_en), fechaX + 17, notaBarY + 5)
  if (despacho.despachada_en) {
    fechaX += 45
    doc.setFont('helvetica', 'bold')
    doc.text('Despachada:', fechaX, notaBarY + 5)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtFecha(despacho.despachada_en), fechaX + 22, notaBarY + 5)
  }
  if (despacho.entregada_en) {
    fechaX += 45
    doc.setFont('helvetica', 'bold')
    doc.text('Entregada:', fechaX, notaBarY + 5)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtFecha(despacho.entregada_en), fechaX + 20, notaBarY + 5)
  }
  y += 8

  // Datos del cliente en 2 columnas
  const halfW = CONTENT_W / 2 - 2
  const col2X = MARGIN + halfW + 4
  const clienteRows = [
    [{ label: 'Cliente', val: cliente.nombre || '—' },         { label: 'R.I.F / Cédula', val: cliente.rif_cedula || '—' }],
    [{ label: 'Teléfono', val: cliente.telefono || '—' },      { label: 'Vendedor', val: despacho.vendedor?.nombre || '—' }],
    [{ label: 'Dirección Fiscal', val: cliente.direccion || '—' }, { label: 'Tlf. Vendedor', val: despacho.vendedor?.telefono || '—' }],
  ]

  doc.setFontSize(9.5)
  clienteRows.forEach(row => {
    row.forEach((item, colIdx) => {
      const baseX = colIdx === 0 ? MARGIN : col2X
      const lineEndX = row.length === 1 ? PAGE_W - MARGIN : (colIdx === 0 ? MARGIN + halfW : PAGE_W - MARGIN)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...C_DARK)
      doc.setFontSize(9.5)
      doc.text(`${item.label}: `, baseX, y)
      const lblW = doc.getTextWidth(`${item.label}: `)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10.5)
      doc.text(String(item.val), baseX + lblW + 2, y)
      doc.setFontSize(9.5)

      doc.setLineWidth(0.3)
      doc.setDrawColor(150, 150, 150)
      doc.line(baseX, y + 1.5, lineEndX, y + 1.5)
    })
    y += 6.5
  })

  y += 2

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'TOTAL BCV'  : 'TOTAL'
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 16,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 16,   w: 24,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 40,   w: 68,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 108,  w: 16,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 124,  w: 26,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 150,  w: 32,  align: 'right'  },
  ]
  const ROW_H = 9

  // Cabecera tabla
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 6.5, { align: col.align })
  })
  y += 9

  // Items
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  items.forEach((item) => {
    if (y > PAGE_H - 55) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + ROW_H / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    doc.text(descLines[0], COLS[2].x + 2, midY)
    doc.text(item.unidad_snap || '—', COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })
    doc.text(fmtPrecio(item.precio_unit_usd, monedaPDF, tasa, factorBcv), COLS[4].x + COLS[4].w - 2, midY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtPrecio(item.total_linea_usd, monedaPDF, tasa, factorBcv), COLS[5].x + COLS[5].w - 2, midY, { align: 'right' })

    y += ROW_H
  })

  // Notas Adicionales
  if (despacho.notas?.trim()) {
    y += 3
    if (y > PAGE_H - 65) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS:', MARGIN, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    const lineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    lineas.forEach(lin => {
      y += 5
      doc.text(lin, MARGIN, y + 4)
    })
    y += 4
  }

  y += 2

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONDICIONES + CUENTAS BANCARIAS (izq) + TOTALES (der)
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 75) { doc.addPage(); y = MARGIN }

  const totW = (monedaPDF === 'mixto' || monedaPDF === 'mixto_bcv') ? 90 : 75
  const totX = PAGE_W - MARGIN - totW
  const leftW = totX - MARGIN - 5
  const total = Number(despacho.total_usd || 0)

  // ── Condiciones (izquierda) — recuadro compacto ──
  const condiciones = [
    'Precios Sujetos a cambios sin previo aviso.',
    'El cliente se encarga de descargar la mercancía.',
  ]
  const condPadding = 2
  const condLineH = 4.5
  const condBoxH = 6 + condiciones.length * condLineH + condPadding * 2

  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, y, leftW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('CONDICIONES GENERALES:', MARGIN + condPadding, y + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(MARGIN + condPadding, y + condPadding + 5.5, MARGIN + leftW - condPadding, y + condPadding + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  let condY = y + condPadding + 9.5
  condiciones.forEach(c => {
    doc.text(`• ${c}`, MARGIN + condPadding, condY)
    condY += condLineH
  })

  condY = y + condBoxH + 1

  // Cuentas bancarias (compactas)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('Transferencias a nombre de ' + (config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.').toUpperCase(), MARGIN, condY + 3)
  condY += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  CUENTAS_BANCARIAS.forEach(cuenta => {
    doc.text(cuenta, MARGIN, condY + 3)
    condY += 3.5
  })

  // ── Totales (derecha) ──
  // Forma de pago
  const fp = (formaPago || despacho.forma_pago || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', totX, y + 4)
  drawCheck(doc, 'EFECTIVO',   totX,      y + 12, fp === 'efectivo')
  drawCheck(doc, 'ZELLE',      totX + 25, y + 12, fp === 'zelle')
  drawCheck(doc, 'P. MÓVIL',   totX + 45, y + 12, fp === 'pago movil')
  drawCheck(doc, 'USDT',       totX + 65, y + 12, fp === 'usdt')
  drawCheck(doc, 'TRANSF.',    totX,      y + 19, fp === 'transferencia')
  drawCheck(doc, 'CTA X COB.', totX + 25, y + 19, fp === 'cta por cobrar')

  // Total grande
  const totTopY = y + 26
  doc.setFillColor(60, 60, 60)
  doc.rect(totX, totTopY, totW, 14, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', totX + 4, totTopY + 9)
  doc.text(fmtTotal(total, monedaPDF, tasa, factorBcv), totX + totW - 4, totTopY + 9, { align: 'right' })

  // Avanzar Y
  y = Math.max(condY, totTopY + 18) + 2

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN }

  const transportista = despacho.transportista || null
  const col6W = (CONTENT_W - 10) / 6

  // Cabecera gris compacta
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, y + 4)
  y += 10

  // Una sola fila con 6 campos
  const choferFields = [
    { label: 'CHOFER', val: transportista?.nombre || '' },
    { label: 'C.I.', val: transportista?.rif || '' },
    { label: 'TELÉFONO', val: transportista?.telefono || '' },
    { label: 'VEHÍCULO', val: transportista?.vehiculo || '' },
    { label: 'PLACA CHUTO', val: transportista?.placa_chuto || '' },
    { label: 'PLACA BATEA', val: transportista?.placa_batea || '' },
  ]
  choferFields.forEach((f, i) => {
    const fx = MARGIN + i * (col6W + 2)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text(`${f.label}:`, fx, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    if (f.val) doc.text(f.val, fx, y + 4)
    doc.setLineWidth(0.2)
    doc.setDrawColor(150, 150, 150)
    doc.line(fx, y + 5.5, fx + col6W, y + 5.5)
  })
  y += 8

  // ── Slogan ──
  y += 4
  if (y < PAGE_H - 40) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...C_DARK)
    doc.text('A sus ordenes para cualquier duda. Gracias por preferirnos.', PAGE_W / 2, y, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER LIMPIO (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    // Línea separadora
    const footerY = ph - 22
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

    // Dirección
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)

    const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
    const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

    doc.text(addr1, PAGE_W / 2, footerY + 5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W / 2, footerY + 9, { align: 'center' })

    // Teléfono y correo
    doc.setFontSize(8)
    const tel = config.telefono_negocio || ''
    const email = config.email_negocio || ''
    const contactLine = [tel, email].filter(Boolean).join('     |     ')
    if (contactLine) {
      doc.setFont('helvetica', 'normal')
      doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
    }
  }

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const filename = `${numDes.replace(/ /g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
}
