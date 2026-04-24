// src/services/pdf/despachoPDF.js
// Genera PDF profesional de Nota de Entrega — formato Construacero Carabobo
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
const PAGE_W    = 216
const PAGE_H    = 279
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
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numDes = `N°- ${String(despacho.numero).padStart(5, '0')}`

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA HORIZONTAL COMPACTA (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 20

  // Logo a la izquierda (más pequeño)
  try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) {}

  // Nombre del negocio centrado
  const centerX = PAGE_W / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C_DARK)
  doc.text('CONSTRUACERO CARABOBO, C.A.', centerX, 16, { align: 'center' })

  // RIF centrado
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('RIF.: J-50115913-0', centerX, 22, { align: 'center' })

  // Línea separadora
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)

  y = HDR_H + 17

  // ── Marca de agua central ──
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    const wmSize = 140
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - wmSize) / 2, (PAGE_H - wmSize) / 2, wmSize, wmSize)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula profesional
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente || {}
  const vendedorTlf = despacho.vendedor?.telefono ? ` — ${despacho.vendedor.telefono}` : ''

  // Nombre del día
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  // Helper para dibujar una celda con borde
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  function drawCell(x, cy, w, h, label, value, opts = {}) {
    // Borde de la celda
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(gridLW)
    doc.rect(x, cy, w, h, 'S')

    if (opts.fill) {
      doc.setFillColor(...(opts.fillColor || [240, 240, 240]))
      doc.rect(x + 0.15, cy + 0.15, w - 0.3, h - 0.3, 'F')
    }

    const pad = 2
    const midY = cy + h / 2

    if (label && value !== undefined) {
      // Label + valor
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(opts.labelSize || 8)
      doc.setTextColor(...C_DARK)
      doc.text(label, x + pad, midY + 0.5)
      const lblW = doc.getTextWidth(label + ' ')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(opts.valSize || 10)
      const valStr = String(value)
      const maxW = w - lblW - pad * 2 - 1
      let displayVal = valStr
      if (doc.getTextWidth(displayVal) > maxW && maxW > 0) {
        while (displayVal.length > 1 && doc.getTextWidth(displayVal + '…') > maxW) {
          displayVal = displayVal.slice(0, -1)
        }
        displayVal += '…'
      }
      doc.text(displayVal, x + pad + lblW, midY + 0.5)
    } else if (label) {
      // Solo texto centrado (título)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(opts.fontSize || 12)
      doc.setTextColor(...C_DARK)
      if (opts.center) {
        doc.text(label, x + w / 2, midY + 1, { align: 'center' })
      } else {
        doc.text(label, x + pad, midY + 1)
      }
    }
  }

  // ── Fila 1-3: Header con título y datos de correlativo/fecha ──
  const gY = y - 4    // inicio de la cuadrícula
  const rowH = 7       // altura de cada fila pequeña
  const leftColW = 38  // "DEPARTAMENTO DE VENTAS"
  const rightLblW = 22 // columna label derecha (ODC, DIA, FECHA)
  const rightValW = 38 // columna valor derecha
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW // columna central

  // Celda izquierda (3 filas de alto): DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central (3 filas de alto): NOTA DE ENTREGA
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('NOTA DE ENTREGA', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas (label + valor por fila)
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC / Correlativo
  drawCell(rLblX, gY, rightLblW, rowH, 'ODC', undefined, { fontSize: 8, center: false })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  drawCell(rValX, gY, rightValW, rowH, null, undefined)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(numDes, rValX + rightValW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')

  // Fila 2: DIA
  const f2Y = gY + rowH
  doc.rect(rLblX, f2Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(diaNombre, rValX + rightValW / 2, f2Y + rowH / 2 + 1, { align: 'center' })

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(fmtFecha(despacho.creado_en), rValX + rightValW / 2, f3Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 4: CLIENTE + R.I.F / Cédula ──
  const f4Y = gY + tripleH
  const clienteLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

  drawCell(MARGIN, f4Y, clienteLblW, rowH, 'CLIENTE:', undefined, { fontSize: 8 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 1)
  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')

  doc.rect(MARGIN + clienteLblW, f4Y, clienteValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const clienteNombre = cliente.nombre || '—'
  const maxClienteW = clienteValW - 4
  let cNombre = clienteNombre
  if (doc.getTextWidth(cNombre) > maxClienteW) {
    while (cNombre.length > 1 && doc.getTextWidth(cNombre + '…') > maxClienteW) cNombre = cNombre.slice(0, -1)
    cNombre += '…'
  }
  doc.text(cNombre, MARGIN + clienteLblW + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(cliente.rif_cedula || '—', MARGIN + clienteLblW + clienteValW + rifLblW + 2, f4Y + rowH / 2 + 1)

  // ── Fila 5: DIRECCIÓN (ancho completo) ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.rect(MARGIN, f5Y, dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + rowH / 2 + 1)

  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirStr = cliente.direccion || '—'
  const maxDirW = CONTENT_W - dirLblW - 4
  let dStr = dirStr
  if (doc.getTextWidth(dStr) > maxDirW) {
    while (dStr.length > 1 && doc.getTextWidth(dStr + '…') > maxDirW) dStr = dStr.slice(0, -1)
    dStr += '…'
  }
  doc.text(dStr, MARGIN + dirLblW + 2, f5Y + rowH / 2 + 1)

  // ── Fila 6: TELÉFONO + VENDEDOR ──
  const f6Y = f5Y + rowH
  const tlfLblW = 25
  const tlfValW = 35
  const vendLblW = 25
  const vendValW = CONTENT_W - tlfLblW - tlfValW - vendLblW

  doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(cliente.telefono || '—', MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)

  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const vendStr = (despacho.vendedor?.nombre || '—') + vendedorTlf
  const maxVendW = vendValW - 4
  let vStr = vendStr
  if (doc.getTextWidth(vStr) > maxVendW) {
    while (vStr.length > 1 && doc.getTextWidth(vStr + '…') > maxVendW) vStr = vStr.slice(0, -1)
    vStr += '…'
  }
  doc.text(vStr, MARGIN + tlfLblW + tlfValW + vendLblW + 2, f6Y + rowH / 2 + 1)

  y = f6Y + rowH + 4

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'TOTAL BCV'  : 'TOTAL'
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 11,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 11,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 97,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 128,  w: 11,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 139,  w: 22,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 161,  w: 21,  align: 'right'  },
  ]
  const ROW_H_BASE = 7

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
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    const lineCount = Math.min(descLines.length, 3)
    const ROW_H = Math.max(ROW_H_BASE, lineCount * 4 + 3)

    if (y > PAGE_H - 55) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + (lineCount === 1 ? ROW_H / 2 + 1.2 : 4.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    const singleMidY = y + ROW_H / 2 + 1.2
    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, singleMidY, { align: 'center' })
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, singleMidY, { align: 'center' })

    // Descripción multi-línea
    for (let li = 0; li < lineCount; li++) {
      doc.text(descLines[li], COLS[2].x + 2, midY + li * 4)
    }

    doc.text(item.unidad_snap || '—', COLS[3].x + COLS[3].w / 2, singleMidY, { align: 'center' })
    doc.text(fmtPrecio(item.precio_unit_usd, monedaPDF, tasa, factorBcv), COLS[4].x + COLS[4].w - 2, singleMidY, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(fmtPrecio(item.total_linea_usd, monedaPDF, tasa, factorBcv), COLS[5].x + COLS[5].w - 2, singleMidY, { align: 'right' })

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

  // ── Layout fijo: posiciones calculadas desde el fondo ──
  const sloganY = PAGE_H - 28
  const TRANS_H = 18

  // ── Recuadro unificado: FORMA DE PAGO + TOTAL — 3mm encima del chofer ──
  const total = Number(despacho.total_usd || 0)
  const fp = (formaPago || despacho.forma_pago || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const choferStartY = sloganY - 9 - TRANS_H
  const fpY = choferStartY - 3 - 19      // 19mm alto del recuadro (9 + 10), 3mm gap

  // Fila FORMA DE PAGO arriba (con borde)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, fpY, CONTENT_W, 9, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', MARGIN + 3, fpY + 6)
  drawCheck(doc, 'EFECTIVO',   MARGIN + 38, fpY + 6, fp === 'efectivo')
  drawCheck(doc, 'ZELLE',      MARGIN + 60, fpY + 6, fp === 'zelle')
  drawCheck(doc, 'P. MÓVIL',   MARGIN + 78, fpY + 6, fp === 'pago movil')
  drawCheck(doc, 'USDT',       MARGIN + 98, fpY + 6, fp === 'usdt')
  drawCheck(doc, 'TRANSF.',    MARGIN + 114, fpY + 6, fp === 'transferencia')
  drawCheck(doc, 'CTA X COB.', MARGIN + 134, fpY + 6, fp === 'cta por cobrar')

  // Barra oscura TOTAL abajo (ancho completo)
  const totTopY = fpY + 9
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, totTopY, CONTENT_W, 10, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', MARGIN + 4, totTopY + 7)
  doc.text(fmtTotal(total, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, totTopY + 7, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONDICIONES (izq) + CUENTAS BANCARIAS (der) — 5mm encima del recuadro pago
  // ══════════════════════════════════════════════════════════════════════════
  const condiciones = [
    'Precios Sujetos a cambios sin previo aviso.',
    'El cliente se encarga de descargar la mercancía.',
  ]
  const condPadding = 2
  const condLineH = 4.5
  const condBoxH = 6 + condiciones.length * condLineH + condPadding * 2
  const halfW = CONTENT_W / 2 - 2
  const ty = fpY - 5 - condBoxH

  // ── Condiciones (izquierda) ──
  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, ty, halfW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('CONDICIONES GENERALES:', MARGIN + condPadding, ty + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(MARGIN + condPadding, ty + condPadding + 5.5, MARGIN + halfW - condPadding, ty + condPadding + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  let condY = ty + condPadding + 9.5
  condiciones.forEach(c => {
    doc.text(`• ${c}`, MARGIN + condPadding, condY)
    condY += condLineH
  })

  // ── Cuentas bancarias (derecha) ──
  const rightX = MARGIN + halfW + 4

  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(rightX, ty, halfW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('Transferencias a nombre de ' + (config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.').toUpperCase(), rightX + condPadding, ty + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(rightX + condPadding, ty + condPadding + 5.5, rightX + halfW - condPadding, ty + condPadding + 5.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  let cuentaY = ty + condPadding + 9.5
  CUENTAS_BANCARIAS.forEach(cuenta => {
    doc.text(cuenta, rightX + condPadding, cuentaY)
    cuentaY += condLineH
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — fijo 5mm sobre el slogan
  // ══════════════════════════════════════════════════════════════════════════
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null

  if (transportista) {
    const TRANS_H = 18
    const ty = sloganY - 9 - TRANS_H

    // Cabecera gris compacta
    doc.setFillColor(240, 240, 240)
    doc.rect(MARGIN, ty, CONTENT_W, 6, 'F')
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.3)
    doc.rect(MARGIN, ty, CONTENT_W, 6, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_DARK)
    doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, ty + 4)

    const cellY = ty + 6
    const cellH = 12
    const choferFields = [
      { label: 'CHOFER', val: transportista?.nombre || '' },
      { label: 'C.I.', val: transportista?.rif || '' },
      { label: 'TELÉFONO', val: transportista?.telefono || '' },
      { label: 'VEHÍCULO', val: transportista?.vehiculo || '' },
      { label: 'PLACA CHUTO', val: transportista?.placa_chuto || '' },
      { label: 'PLACA BATEA', val: transportista?.placa_batea || '' },
    ]
    const colW = CONTENT_W / choferFields.length
    choferFields.forEach((f, i) => {
      const fx = MARGIN + i * colW
      doc.setDrawColor(120, 120, 120)
      doc.setLineWidth(0.3)
      doc.rect(fx, cellY, colW, cellH, 'S')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 100, 100)
      doc.text(f.label + ':', fx + 2, cellY + 4)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...C_DARK)
      if (f.val) doc.text(f.val, fx + 2, cellY + 9.5)
    })
  }

  if (y < sloganY) {
    doc.setFont('helvetica', 'bolditalic')
    doc.setFontSize(16)
    doc.setTextColor(...C_DARK)
    doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER LIMPIO (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    // Línea separadora
    const footerY = ph - 23
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
