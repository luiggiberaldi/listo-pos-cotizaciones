// src/services/pdf/ventasDiaPDF.js
// PDF "Ventas generales del día": la hoja que Logística le deja a Administración los sábados.
// Hoja horizontal, mismas columnas que la de papel (solo las formas de pago usadas ese día),
// subtotales, resumen, cuadre de efectivo, notas que faltan y firmas. Sin marca de agua para que pese poco.
import { jsPDF } from 'jspdf'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import { drawPremiumHeader } from './pdfShared'
import { COLUMNAS_PAGO, montoFila, subtotalMostrado } from '../../utils/ventasDia'

const M = 10
const fmt = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const pad = v => String(v ?? '').padStart(5, '0')
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const fmtFechaLarga = ymd => {
  const [y, m, d] = ymd.split('-')
  return `${DIAS[new Date(`${ymd}T12:00:00Z`).getUTCDay()]} ${d}/${m}/${y}`
}

function cortar(doc, texto, ancho) {
  const t = String(texto ?? '')
  if (doc.getTextWidth(t) <= ancho) return t
  let s = t
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > ancho) s = s.slice(0, -1)
  return `${s}…`
}

export function nombreArchivoVentasDia(reporte) {
  return `Ventas_del_dia_${reporte.fecha}.pdf`
}

export function generarVentasDiaPDF({ reporte, tasa = 0, config = {}, comprimir = true }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape', compress: comprimir })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const ANCHO = W - M * 2
  const columnas = COLUMNAS_PAGO.filter(c => reporte.columnasUsadas.includes(c.id))
  const hayBs = columnas.some(c => c.bs)

  // Anchos: #, cliente, nota, columnas de pago, total, referencias/avisos
  const wItem = 8, wNota = 16, wTotal = 22, wRef = 46
  const wPago = columnas.length ? Math.min(28, (ANCHO - wItem - wNota - wTotal - wRef - 50) / columnas.length) : 0
  const wCliente = ANCHO - wItem - wNota - wTotal - wRef - wPago * columnas.length
  const xs = []
  let x = M
  for (const w of [wItem, wCliente, wNota, ...columnas.map(() => wPago), wTotal, wRef]) { xs.push(x); x += w }
  const xCol = i => xs[3 + i]
  const xTotal = xs[3 + columnas.length]
  const xRef = xs[4 + columnas.length]
  const derecha = (texto, xIni, ancho, yy) => doc.text(texto, xIni + ancho - 1.5, yy, { align: 'right' })

  const subtitulo = `${fmtFechaLarga(reporte.fecha)} · Tasa del día: ${tasa > 0 ? `${fmt(tasa)} Bs/$` : '—'}`
  let y = drawPremiumHeader({
    doc, logoData: LOGO_LISTA_PRECIOS, config,
    title: 'Ventas generales del día', subtitle: subtitulo,
    customBgColor: [255, 255, 255], customAccentColor: [0, 0, 0], customTextColor: [0, 0, 0],
    customSubtitleColor: [0, 0, 0], customBorderColor: [0, 0, 0], centerBusinessName: true,
  })

  const encabezadoTabla = () => {
    doc.setFillColor(30, 41, 59)
    doc.rect(M, y, ANCHO, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255)
    doc.text('#', xs[0] + 1.5, y + 4.7)
    doc.text('CLIENTE', xs[1] + 1.5, y + 4.7)
    doc.text('NOTA N°', xs[2] + 1.5, y + 4.7)
    columnas.forEach((c, i) => derecha(cortar(doc, c.corto.toUpperCase(), wPago - 2), xCol(i), wPago, y + 4.7))
    derecha('TOTAL $', xTotal, wTotal, y + 4.7)
    doc.text('REF. / AVISOS', xRef + 1.5, y + 4.7)
    y += 7
  }
  const saltoSiHaceFalta = (alto, margenInferior = 14) => {
    if (y + alto > H - margenInferior) {
      doc.addPage()
      y = M + 4
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
      doc.text(`Ventas generales del día · ${fmtFechaLarga(reporte.fecha)} (continuación)`, M, y)
      y += 4
      return true
    }
    return false
  }

  if (!reporte.filas.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(100, 116, 139)
    doc.text('No hay notas creadas este día.', M, y + 6)
    y += 12
  } else {
    encabezadoTabla()
    reporte.filas.forEach((f, idx) => {
      const notas = [
        ...(f.referencias.length ? [`Ref. ${f.referencias.join(', ')}`] : []),
        ...(f.otrosDetalle.length ? [f.otrosDetalle.join(', ')] : []),
        ...f.avisos.map(a => `! ${a}`),
      ]
      doc.setFontSize(6.5)
      const lineasRef = notas.flatMap(t => doc.splitTextToSize(t, wRef - 3))
      const alto = Math.max(5.2, 2.4 + lineasRef.length * 2.8)
      if (saltoSiHaceFalta(alto + 2)) encabezadoTabla()
      if (f.avisos.length) { doc.setFillColor(255, 251, 235); doc.rect(M, y, ANCHO, alto, 'F') }
      else if (idx % 2) { doc.setFillColor(248, 250, 252); doc.rect(M, y, ANCHO, alto, 'F') }
      const yt = y + 3.7
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(15, 23, 42)
      doc.text(String(f.item), xs[0] + 1.5, yt)
      doc.setFont('helvetica', 'bold')
      doc.text(cortar(doc, f.cliente, wCliente - 3), xs[1] + 1.5, yt)
      doc.setFont('helvetica', 'normal')
      doc.text(pad(f.numero), xs[2] + 1.5, yt)
      columnas.forEach((c, i) => {
        const v = f.montos[c.id]
        doc.setTextColor(...(v ? [15, 23, 42] : [180, 190, 200]))
        derecha(v ? fmt(montoFila(f, c.id, tasa)) : '0,00', xCol(i), wPago, yt)
      })
      doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold')
      derecha(fmt(f.totalUsd), xTotal, wTotal, yt)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
      lineasRef.forEach((l, k) => {
        doc.setTextColor(...(l.startsWith('! ') ? [146, 64, 14] : [71, 85, 105]))
        doc.text(l, xRef + 1.5, y + 3.6 + k * 2.8)
      })
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(M, y + alto, M + ANCHO, y + alto)
      y += alto
    })

    // Subtotales
    saltoSiHaceFalta(hayBs ? 14 : 8)
    doc.setDrawColor(15, 23, 42); doc.setLineWidth(0.5); doc.line(M, y, M + ANCHO, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42)
    doc.text('SUBTOTALES', xs[1] + 1.5, y + 5)
    columnas.forEach((c, i) => derecha(fmt(subtotalMostrado(reporte, c.id, tasa)), xCol(i), wPago, y + 5))
    derecha(fmt(reporte.resumen.totalVendidoUsd), xTotal, wTotal, y + 5)
    y += 7
    if (hayBs) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105)
      doc.text('En dólares', xs[1] + 1.5, y + 3.5)
      columnas.forEach((c, i) => derecha(fmt(reporte.totales[c.id]), xCol(i), wPago, y + 3.5))
      y += 6
    }
  }

  // Resumen
  saltoSiHaceFalta(32)
  y += 3
  const anchoCaja = ANCHO
  const caja = (x0, titulo, lineas) => {
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3)
    doc.roundedRect(x0, y, anchoCaja, 8 + lineas.length * 5.5, 1.5, 1.5)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
    doc.text(titulo, x0 + 3, y + 5)
    lineas.forEach(([label, valor, fuerte], k) => {
      const yy = y + 10.5 + k * 5.5
      doc.setFont('helvetica', fuerte ? 'bold' : 'normal'); doc.setFontSize(fuerte ? 10 : 8.5); doc.setTextColor(15, 23, 42)
      doc.text(label, x0 + 3, yy)
      doc.text(valor, x0 + anchoCaja - 3, yy, { align: 'right' })
    })
    return 8 + lineas.length * 5.5
  }
  const r = reporte.resumen
  const resumen = [
    ['Dinero que entró (cobrado)', `$${fmt(r.cobradoUsd)}`],
    ['Quedó por cobrar (crédito o al entregar)', `$${fmt(r.porCobrarUsd)}`],
    ...(r.otrosUsd ? [['Otros (cruce, donación…)', `$${fmt(r.otrosUsd)}`]] : []),
    ['TOTAL VENDIDO', `$${fmt(r.totalVendidoUsd)}`, true],
  ]
  y += caja(M, 'RESUMEN', resumen) + 3

  // Notas que faltan
  if (reporte.faltantes.length) {
    const textos = reporte.faltantes.map(f => `${pad(f.numero)}: ${f.motivo}`)
    doc.setFontSize(7.5)
    const lineas = doc.splitTextToSize(textos.join('   ·   '), ANCHO - 6)
    saltoSiHaceFalta(8 + lineas.length * 3.6)
    doc.setFillColor(255, 251, 235); doc.setDrawColor(252, 211, 77)
    doc.roundedRect(M, y, ANCHO, 7 + lineas.length * 3.6, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(146, 64, 14)
    doc.text('NOTAS QUE NO APARECEN EN ESTA HOJA', M + 3, y + 4.5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    lineas.forEach((l, k) => doc.text(l, M + 3, y + 8.5 + k * 3.6))
    y += 7 + lineas.length * 3.6
  }

  // Pie en todas las páginas
  const total = doc.getNumberOfPages()
  const generado = new Date(reporte.generadoEn || Date.now()).toLocaleString('es-VE', { timeZone: 'America/Caracas', dateStyle: 'short', timeStyle: 'short' })
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184)
    doc.text(`${config?.nombre_negocio || 'Construacero'} · Ventas del día ${fmtFechaLarga(reporte.fecha)} · Generado ${generado}${reporte.preparadoPor ? ` por ${reporte.preparadoPor}` : ''}`, M, H - 6)
    doc.text(`Página ${p} de ${total}`, W - M, H - 6, { align: 'right' })
  }

  return { blob: doc.output('blob'), filename: nombreArchivoVentasDia(reporte), doc }
}
