// src/services/pdf/ordenDespachoPDF.js
// Genera PDF de Orden de Despacho — sin footer, cuentas, slogan ni condiciones
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

// ─── Constantes de diseño ─────────────────────────────────────────────────────
const MARGIN    = 14
const PAGE_W    = 216
const PAGE_H    = 279
const CONTENT_W = PAGE_W - MARGIN * 2

const C_DARK    = [5, 8, 52]
const C_WHITE   = [255, 255, 255]

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

export async function generarOrdenDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0
  let y = 0

  const numDes = `N°- ${String(despacho.numero).padStart(5, '0')}`

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 20

  try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) {}

  const centerX = PAGE_W / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C_DARK)
  doc.text('CONSTRUACERO CARABOBO, C.A.', centerX, 16, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('RIF.: J-50115913-0', centerX, 22, { align: 'center' })

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
  // 2. DATOS DEL CLIENTE
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = despacho.cliente || {}
  const vendedorTlf = despacho.vendedor?.telefono ? ` — ${despacho.vendedor.telefono}` : ''

  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  // ── Fila 1-3: Header con título y datos ──
  const gY = y - 4
  const rowH = 7
  const leftColW = 38
  const rightLblW = 22
  const rightValW = 38
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW

  // Celda izquierda: DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central: ORDEN DE DESPACHO
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ORDEN DE DESPACHO', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(numDes, rValX + rightValW / 2, gY + rowH / 2 + 1, { align: 'center' })

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

  // ── Fila 4: CLIENTE + RIF ──
  const f4Y = gY + tripleH
  const clienteLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 1)

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

  // ── Fila 5: DIRECCIÓN ──
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

  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'S')
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

  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  items.forEach((item) => {
    const descLines = doc.splitTextToSize(item.nombre_snap || '', COLS[2].w - 4)
    const lineCount = Math.min(descLines.length, 3)
    const ROW_H = Math.max(ROW_H_BASE, lineCount * 4 + 3)

    if (y > PAGE_H - 40) { doc.addPage(); y = MARGIN }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    const midY = y + (lineCount === 1 ? ROW_H / 2 + 1.2 : 4.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    const singleMidY = y + ROW_H / 2 + 1.2
    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, singleMidY, { align: 'center' })
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, singleMidY, { align: 'center' })

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
    if (y > PAGE_H - 50) { doc.addPage(); y = MARGIN }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS:', MARGIN, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const lineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    lineas.forEach(lin => {
      y += 5
      doc.text(lin, MARGIN, y + 4)
    })
    y += 4
  }

  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Layout fijo desde el fondo: Chofer en footer, Totales encima
  // ══════════════════════════════════════════════════════════════════════════
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null

  // Datos del chofer fijos al fondo de la página (footer)
  const CHOFER_H = 22
  const choferY = PAGE_H - MARGIN - CHOFER_H

  // Total 6mm más alto que antes (originalmente ~36mm offset, ahora 30mm)
  const totW = (monedaPDF === 'mixto' || monedaPDF === 'mixto_bcv') ? 90 : 75
  const totX = PAGE_W - MARGIN - totW
  const total = Number(despacho.total_usd || 0)

  // Posicionar totales fijos sobre el chofer
  const ty = choferY - 56

  const fp = (formaPago || despacho.forma_pago || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', totX, ty + 4)
  drawCheck(doc, 'EFECTIVO',   totX,      ty + 12, fp === 'efectivo')
  drawCheck(doc, 'ZELLE',      totX + 22, ty + 12, fp === 'zelle')
  drawCheck(doc, 'P. MÓVIL',   totX + 40, ty + 12, fp === 'pago movil')
  drawCheck(doc, 'USDT',       totX + 60, ty + 12, fp === 'usdt')
  drawCheck(doc, 'TRANSF.',    totX + 76, ty + 12, fp === 'transferencia')
  drawCheck(doc, 'CTA X COB.', totX + 96, ty + 12, fp === 'cta por cobrar')

  // Total grande
  const totTopY = ty + 24
  doc.setFillColor(60, 60, 60)
  doc.rect(totX, totTopY, totW, 14, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', totX + 4, totTopY + 9)
  doc.text(fmtTotal(total, monedaPDF, tasa, factorBcv), totX + totW - 4, totTopY + 9, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — fijo al fondo (footer)
  // ══════════════════════════════════════════════════════════════════════════
  const col6W = (CONTENT_W - 10) / 6

  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferY + 4)

  const fieldsY = choferY + 10

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
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text(`${f.label}:`, fx, fieldsY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    if (f.val) doc.text(f.val, fx, fieldsY + 4)
    doc.setLineWidth(0.2)
    doc.setDrawColor(150, 150, 150)
    doc.line(fx, fieldsY + 5.5, fx + col6W, fieldsY + 5.5)
  })

  // ── NO cuentas, NO slogan, NO condiciones ──

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const filename = `ODC_${numDes.replace(/ /g, '_')}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
}
