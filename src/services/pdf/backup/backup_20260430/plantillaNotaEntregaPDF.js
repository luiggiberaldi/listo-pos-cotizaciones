// src/services/pdf/plantillaNotaEntregaPDF.js
// Plantilla VACÍA de Nota de Entrega — para llenado a mano
// Basada en despachoPDF.js pero sin datos (solo estructura)
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  CUENTAS_BANCARIAS,
  drawWatermark,
} from './pdfShared'

export async function generarPlantillaNotaEntregaPDF({ config = {} } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  let y = 0

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

  // Marca de agua
  drawWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula vacía
  // ══════════════════════════════════════════════════════════════════════════
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  const gY = y - 4
  const rowH = 7
  const leftColW = 38
  const rightLblW = 22
  const rightValW = 38
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW

  // Celda izquierda: DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central: NOTA DE ENTREGA
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('NOTA DE ENTREGA', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')

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

  // Fila 4: CLIENTE + R.I.F
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
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')

  // Fila 5: DIRECCIÓN
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.rect(MARGIN, f5Y, dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + rowH / 2 + 1)
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, rowH, 'S')

  // Fila 6: TELÉFONO + VENDEDOR
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
  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')

  y = f6Y + rowH + 2

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS — cabecera + filas vacías
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 11,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 11,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 87,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 118,  w: 11,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 129,  w: 27,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 156,  w: 32,  align: 'right'  },
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

  // Filas vacías para llenar a mano
  const BLANK_ROW_H = 6.5
  const BLANK_ROWS = 12
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)
  for (let i = 0; i < BLANK_ROWS; i++) {
    doc.rect(MARGIN, y, CONTENT_W, BLANK_ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + BLANK_ROW_H) })
    y += BLANK_ROW_H
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONDICIONES (izq) + CUENTAS BANCARIAS (der)
  // ══════════════════════════════════════════════════════════════════════════
  const sloganY = PAGE_H - 33

  const condiciones = [
    'Precios Sujetos a cambios sin previo aviso.',
    'El cliente se encarga de descargar la mercancía.',
  ]
  const condPadding = 2
  const condLineH = 4.5
  const condBoxH = 6 + condiciones.length * condLineH + condPadding * 2
  const halfW = CONTENT_W / 2 - 2

  // Calcular posiciones desde abajo
  const TRANS_H = 18
  const choferStartY = sloganY - 9 - TRANS_H
  const comboRows = 3 // crédito + base + IVA
  const dataRowH = 7
  const totalBarH = 10
  const comboTop = choferStartY - 3 - totalBarH - comboRows * dataRowH
  const condTopY = comboTop - 5 - condBoxH

  // Condiciones (izquierda)
  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, condTopY, halfW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C_DARK)
  doc.text('CONDICIONES GENERALES:', MARGIN + condPadding, condTopY + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(MARGIN + condPadding, condTopY + condPadding + 5.5, MARGIN + halfW - condPadding, condTopY + condPadding + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  let condY = condTopY + condPadding + 9.5
  condiciones.forEach(c => {
    doc.text(`• ${c}`, MARGIN + condPadding, condY)
    condY += condLineH
  })

  // Cuentas bancarias (derecha)
  const rightX = MARGIN + halfW + 4

  doc.setFillColor(245, 245, 245)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.4)
  doc.roundedRect(rightX, condTopY, halfW, condBoxH, 1, 1, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('Transferencias a nombre de ' + (config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.').toUpperCase(), rightX + condPadding, condTopY + condPadding + 3.5)

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.line(rightX + condPadding, condTopY + condPadding + 5.5, rightX + halfW - condPadding, condTopY + condPadding + 5.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let cuentaY = condTopY + condPadding + 9.5
  CUENTAS_BANCARIAS.forEach(cuenta => {
    doc.text(cuenta, rightX + condPadding, cuentaY)
    cuentaY += condLineH
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. BLOQUE COMBINADO: Crédito + Transporte (izq) | Base/IVA (der) + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  const comboLeftW = Math.round(CONTENT_W * 0.62)
  const comboRightW = CONTENT_W - comboLeftW
  const ivaPct = Number(config.iva_pct) || 16

  const leftLabels = ['8 DÍAS DE CRÉDITO CONTINUO', 'Chofer:', 'Vehículo:']
  const rightLabels = ['Base', `IVA ${ivaPct}%`, 'Flete']

  for (let r = 0; r < comboRows; r++) {
    const ry = comboTop + r * dataRowH

    // Celda izquierda
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, ry, comboLeftW, dataRowH, 'S')
    doc.setFont('helvetica', r === 0 ? 'bold' : 'normal')
    doc.setFontSize(r === 0 ? 9 : 7.5)
    doc.setTextColor(...C_DARK)
    doc.text(leftLabels[r], MARGIN + 3, ry + dataRowH / 2 + 1)

    // Celda derecha
    doc.rect(MARGIN + comboLeftW, ry, comboRightW, dataRowH, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text(rightLabels[r], MARGIN + comboLeftW + 3, ry + dataRowH / 2 + 1)
    // Línea para monto
    doc.setLineWidth(0.3)
    doc.setDrawColor(150, 150, 150)
    doc.line(MARGIN + comboLeftW + 30, ry + dataRowH / 2 + 1.5, MARGIN + CONTENT_W - 3, ry + dataRowH / 2 + 1.5)
  }

  // Barra TOTAL
  const totTopY = comboTop + comboRows * dataRowH
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, totTopY, CONTENT_W, totalBarH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL', MARGIN + 4, totTopY + 7)
  doc.setLineWidth(0.4)
  doc.setDrawColor(150, 150, 150)
  doc.line(MARGIN + 30, totTopY + 7.5, MARGIN + CONTENT_W - 4, totTopY + 7.5)

  // ══════════════════════════════════════════════════════════════════════════
  // 6. DATOS DEL CHOFER Y VEHÍCULO — vacíos (2 filas: 3+4 cols)
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferStartY, CONTENT_W, 6, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferStartY, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferStartY + 4)

  const ROW_H2 = 12
  const row1Y = choferStartY + 6
  const row2Y = row1Y + ROW_H2
  const col3W = CONTENT_W / 3
  const col4W = CONTENT_W / 4

  // Fila 1: CHOFER, C.I., COLOR
  const row1Labels = ['CHOFER', 'C.I.', 'COLOR']
  row1Labels.forEach((label, i) => {
    const fx = MARGIN + i * col3W
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.3)
    doc.rect(fx, row1Y, col3W, ROW_H2, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 100, 100)
    doc.text(label, fx + 2, row1Y + 3.5)
  })

  // Fila 2: VEHÍCULO, PLACA, PLACA CHUTO, PLACA BATEA
  const row2Labels = ['VEHÍCULO', 'PLACA', 'PLACA CHUTO', 'PLACA BATEA']
  row2Labels.forEach((label, i) => {
    const fx = MARGIN + i * col4W
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.3)
    doc.rect(fx, row2Y, col4W, ROW_H2, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 100, 100)
    doc.text(label, fx + 2, row2Y + 3.5)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 7. SLOGAN
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(16)
  doc.setTextColor(...C_DARK)
  doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })

  // ══════════════════════════════════════════════════════════════════════════
  // 8. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  const footerY = PAGE_H - 28
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

  doc.save('plantilla_nota_entrega.pdf')
}
