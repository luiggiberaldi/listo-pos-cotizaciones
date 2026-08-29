// src/services/pdf/despachoPlantillaPDF.js
// Plantilla VACÍA de Nota de Despacho — para llenado a mano
// Basada en despachoPDF.js pero sin datos (solo líneas y espacio en blanco)
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import { WATERMARK_LOGO } from './watermarkBase64'

const MARGIN    = 14
const PAGE_W    = 216
const PAGE_H    = 279
const CONTENT_W = PAGE_W - MARGIN * 2
const C_DARK    = [5, 8, 52]
const C_WHITE   = [255, 255, 255]

function drawCheck(doc, label, x, y) {
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.rect(x, y - 2.5, 3, 3, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text(label, x + 4.5, y)
}

export async function generarDespachoPlantillaPDF({ config = {} } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  let y = 0

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA
  // ══════════════════════════════════════════════════════════════════════════
  const HDR_H = 20

  try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 1, 22, 22) } catch (_) {}

  const centerX = PAGE_W / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C_DARK)
  doc.text('CONSTRUACERO CARABOBO, C.A.', centerX, 11, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('RIF.: J-50115913-0', centerX, 16, { align: 'center' })

  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, HDR_H + 4, PAGE_W - MARGIN, HDR_H + 4)

  y = HDR_H + 11

  // Marca de agua
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    const wmSize = 140
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - wmSize) / 2, (PAGE_H - wmSize) / 2, wmSize, wmSize)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2-3. CUADRÍCULA DATOS DEL CLIENTE — formato profesional (vacío)
  // ══════════════════════════════════════════════════════════════════════════
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  const gY = y - 4    // inicio de la cuadrícula
  const rowH = 7       // altura de cada fila
  const leftColW = 38  // "DEPARTAMENTO DE VENTAS"
  const rightLblW = 22 // columna label derecha
  const rightValW = 38 // columna valor derecha
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW

  // ── Fila 1-3: Header ──
  const tripleH = rowH * 3

  // Celda izquierda: DEPARTAMENTO DE VENTAS
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

  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')
  // línea vacía para número
  doc.setLineWidth(0.3)
  doc.setDrawColor(150, 150, 150)
  doc.line(rValX + 4, gY + rowH / 2 + 2, rValX + rightValW - 4, gY + rowH / 2 + 2)
  doc.setDrawColor(120, 120, 120)

  // Fila 2: DIA
  const f2Y = gY + rowH
  doc.rect(rLblX, f2Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')

  // ── Fila 4: CLIENTE + R.I.F ──
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
  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + 2, f4Y + rowH / 2 + 1)
  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')

  // ── Fila 5: DIRECCIÓN ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.rect(MARGIN, f5Y, dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + rowH / 2 + 1)
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, rowH, 'S')

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
  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'S')

  y = f6Y + rowH + 4

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TABLA DE PRODUCTOS — cabecera + espacio en blanco
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 16,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 16,   w: 24,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 40,   w: 68,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 108,  w: 16,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 124,  w: 26,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 150,  w: 32,  align: 'right'  },
  ]

  // Cabecera oscura
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w / 2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 6.5, { align: col.align })
  })
  y += 9

  // Espacio en blanco (sin líneas de filas) — solo borde exterior
  const BLANK_AREA_H = 80
  doc.setLineWidth(0.3)
  doc.setDrawColor(200, 200, 200)
  doc.rect(MARGIN, y, CONTENT_W, BLANK_AREA_H, 'S')

  // Líneas verticales de columnas (solo el divisor de columnas, sin filas)
  doc.setLineWidth(0.2)
  COLS.forEach(col => {
    doc.line(col.x, y, col.x, y + BLANK_AREA_H)
  })

  y += BLANK_AREA_H + 4

  // ══════════════════════════════════════════════════════════════════════════
  // 5. NOTAS — líneas vacías
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_DARK)
  doc.text('NOTAS:', MARGIN, y + 4)
  y += 6
  for (let i = 0; i < 2; i++) {
    doc.setLineWidth(0.3)
    doc.setDrawColor(150, 150, 150)
    doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5)
    y += 5.5
  }

  y += 3

  // ══════════════════════════════════════════════════════════════════════════
  // 6. CONDICIONES + CUENTAS + FORMA DE PAGO + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 75) { doc.addPage(); y = MARGIN }

  const totW = 75
  const totX = PAGE_W - MARGIN - totW
  const leftW = totX - MARGIN - 5

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

  // Cuentas bancarias
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('Transferencias a nombre de ' + (config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.').toUpperCase(), MARGIN, condY + 3)
  condY += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  ;[
    'CTA. CTE. BANESCO 0134 0187 0128 7104 1852',
    'CTA. CTE. PROVINCIAL 0108 0071 4901 0129 1305',
  ].forEach(cuenta => {
    doc.text(cuenta, MARGIN, condY + 3)
    condY += 3.5
  })

  // Forma de pago — todos sin marcar
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', totX, y + 4)
  drawCheck(doc, 'EFECTIVO',   totX,      y + 12)
  drawCheck(doc, 'ZELLE',      totX + 25, y + 12)
  drawCheck(doc, 'P. MÓVIL',   totX + 45, y + 12)
  drawCheck(doc, 'USDT',       totX + 65, y + 12)
  drawCheck(doc, 'TRANSF.',    totX,      y + 19)
  drawCheck(doc, 'CTA X COB.', totX + 25, y + 19)

  // Total — caja con línea en blanco
  const totTopY = y + 36
  doc.setFillColor(60, 60, 60)
  doc.rect(totX, totTopY, totW, 14, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('TOTAL', totX + 4, totTopY + 9)
  // Línea en blanco donde iría el monto
  doc.setLineWidth(0.4)
  doc.setDrawColor(...C_WHITE)
  doc.line(totX + 30, totTopY + 9.5, totX + totW - 4, totTopY + 9.5)

  y = Math.max(condY, totTopY + 18) + 2

  // Slogan — fijo 10mm sobre el footer (footerY = PAGE_H - 22)
  const sloganY = PAGE_H - 27

  // ══════════════════════════════════════════════════════════════════════════
  // 7. DATOS DEL CHOFER Y VEHÍCULO — fijo 5mm sobre el slogan
  // ══════════════════════════════════════════════════════════════════════════
  const FIRMA_H = 20   // firma: 6 + 10 + 4
  const TRANS_H = 18   // chofer: header 6 + y+=10 + fila 8
  const choferStartY = sloganY - 9 - FIRMA_H - TRANS_H

  const col6W = (CONTENT_W - 10) / 6

  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferStartY, CONTENT_W, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferStartY + 4)

  const choferFieldsY = choferStartY + 10
  const choferFields = ['CHOFER', 'C.I.', 'TELÉFONO', 'VEHÍCULO', 'PLACA CHUTO', 'PLACA BATEA']
  choferFields.forEach((label, i) => {
    const fx = MARGIN + i * (col6W + 2)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    doc.text(`${label}:`, fx, choferFieldsY)
    doc.setLineWidth(0.2)
    doc.setDrawColor(150, 150, 150)
    doc.line(fx, choferFieldsY + 5.5, fx + col6W, choferFieldsY + 5.5)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 8. FIRMA DEL CLIENTE — fijo entre chofer y slogan
  // ══════════════════════════════════════════════════════════════════════════
  const sigY = choferStartY + TRANS_H + 10
  const sigW = 70

  doc.setLineWidth(0.4)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, sigY, MARGIN + sigW, sigY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('Firma y Sello del Cliente', MARGIN + sigW / 2, sigY + 4, { align: 'center' })

  const sigRX = PAGE_W - MARGIN - sigW
  doc.line(sigRX, sigY, sigRX + sigW, sigY)
  doc.text('Firma del Despachador', sigRX + sigW / 2, sigY + 4, { align: 'center' })

  if (y < sloganY) {
    doc.setFont('helvetica', 'bolditalic')
    doc.setFontSize(16)
    doc.setTextColor(...C_DARK)
    doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H
    const footerY = ph - 22

    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C_DARK)
    doc.text('Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II', PAGE_W / 2, footerY + 5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text('Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003', PAGE_W / 2, footerY + 9, { align: 'center' })

    const tel = config.telefono_negocio || ''
    const email = config.email_negocio || ''
    const contactLine = [tel, email].filter(Boolean).join('     |     ')
    if (contactLine) {
      doc.setFontSize(8)
      doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
    }
  }

  doc.save('plantilla_nota_despacho.pdf')
}
