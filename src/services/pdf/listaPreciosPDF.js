// src/services/pdf/listaPreciosPDF.js
// Genera PDF "Lista de Precios" para enviar a clientes — Construacero Carabobo
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
function fmtPrecio(n, moneda, tasa) {
  const usd = Number(n || 0)
  if (moneda === 'bs' && tasa > 0) return fmtBs(usd * tasa)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(usd)}  /  ${fmtBs(usd * tasa)}`
  return fmtUsd(usd)
}

// ─── Layout y Colores ────────────────────────────────────────────────────────
const PAGE_W    = 210
const PAGE_H    = 297
const MARGIN    = 14
const CONTENT_W = PAGE_W - MARGIN * 2

const C_PRIMARY = [58, 99, 168]
const C_DARK    = [5, 8, 52]
const C_WHITE   = [255, 255, 255]
const C_GRAY    = [100, 116, 139]
const C_CAT_BG  = [235, 240, 250]

function addWatermark(doc) {
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}
}

function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
    addWatermark(doc)
    return MARGIN + 10
  }
  return y
}

// ─── Dibujar cabecera ────────────────────────────────────────────────────────
function drawHeader(doc, logoData, config, moneda, tasa) {
  const HDR_H = 36
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, HDR_H, 'F')

  // Hazard stripe
  const hazW = 40, hazX = PAGE_W - hazW
  doc.setFillColor(...C_DARK)
  doc.rect(hazX, 0, hazW, 14, 'F')
  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_PRIMARY)
  for (let k = 0; k < 15; k++) doc.line(hazX + k*4, 0, hazX + k*4 - 8, 14)

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 8, 3, 30, 30) } catch (_) {}
  }

  const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
  doc.setFont('times', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C_WHITE)
  const nombreNeg = (config.nombre_negocio || 'CONSTRUACERO CARABOBO').split(' ')
  doc.text((nombreNeg[0] || '').toUpperCase(), textCenterX, 16, { align: 'center' })
  if (nombreNeg.length > 1) {
    doc.setFontSize(12)
    doc.text(nombreNeg.slice(1).join(' ').toUpperCase(), textCenterX, 23, { align: 'center' })
  }

  // Título y fecha
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Lista de Precios', PAGE_W - MARGIN, HDR_H - 12, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  const fechaTxt = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
  const tasaTxt = (moneda === 'bs' || moneda === 'mixto') && tasa > 0
    ? `  ·  Tasa: Bs ${tasa.toFixed(2)}`
    : ''
  doc.text(fechaTxt + tasaTxt, PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  return HDR_H + 6
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function drawFooter(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    doc.text(config.nombre_negocio || 'Construacero Carabobo C.A.', MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }
}

// ─── Generar Lista de Precios ────────────────────────────────────────────────
/**
 * @param {Object} params
 * @param {Array}  params.productos  - Lista de productos a incluir
 * @param {Object} params.config     - Config del negocio (nombre_negocio, logo_url)
 * @param {Object} params.opciones   - { moneda: 'usd'|'bs'|'mixto', tasa: number, columnas: { codigo, categoria, unidad, stock, precio2, precio3 } }
 */
export async function generarListaPreciosPDF({ productos, config = {}, opciones = {} }) {
  const { moneda = 'usd', tasa = 0, columnas = {} } = opciones
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config, moneda, tasa)
  addWatermark(doc)

  // Agrupar por categoría
  const grupos = {}
  productos.forEach(p => {
    const cat = p.categoria || 'Sin categoría'
    if (!grupos[cat]) grupos[cat] = []
    grupos[cat].push(p)
  })
  const categoriasOrdenadas = Object.keys(grupos).sort()

  // ─── Definir columnas dinámicas ──────────────────────────────────────────
  const cols = []
  let xCursor = MARGIN

  if (columnas.codigo) {
    cols.push({ key: 'codigo', label: 'Código', x: xCursor, w: 22 })
    xCursor += 22
  }

  // Nombre siempre incluido — ancho dinámico (lo que sobre)
  const nombreCol = { key: 'nombre', label: 'Producto', x: xCursor, w: 0 }
  cols.push(nombreCol)

  let usedByOthers = xCursor // ya consumido antes de nombre
  // Calcular ancho de las columnas que van DESPUÉS de nombre
  const rightCols = []
  if (columnas.unidad) rightCols.push({ key: 'unidad', label: 'Unid.', w: 14 })
  if (columnas.stock) rightCols.push({ key: 'stock', label: 'Disp.', w: 16 })

  // Precio principal — ancho depende de moneda
  const precioW = moneda === 'mixto' ? 52 : 26
  rightCols.push({ key: 'precio', label: moneda === 'bs' ? 'Precio Bs' : moneda === 'mixto' ? 'Precio USD / Bs' : 'Precio USD', w: precioW })

  if (columnas.precio2) rightCols.push({ key: 'precio2', label: 'Precio 2', w: 22 })
  if (columnas.precio3) rightCols.push({ key: 'precio3', label: 'Precio 3', w: 22 })

  const rightTotalW = rightCols.reduce((sum, c) => sum + c.w, 0)
  nombreCol.w = CONTENT_W - usedByOthers - rightTotalW

  // Posicionar columnas derechas
  let rightX = nombreCol.x + nombreCol.w
  rightCols.forEach(c => {
    c.x = rightX
    rightX += c.w
    cols.push(c)
  })

  // ─── Función para dibujar cabecera de tabla ──────────────────────────────
  function drawTableHeader(yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    cols.forEach(col => {
      const align = ['precio', 'precio2', 'precio3', 'stock'].includes(col.key) ? 'right' : 'left'
      const tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
      doc.text(col.label, tx, yPos + 5, { align })
    })
    return yPos + 9
  }

  // ─── Resumen rápido ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C_GRAY)
  doc.text(`${productos.length} producto${productos.length !== 1 ? 's' : ''} · ${categoriasOrdenadas.length} categoría${categoriasOrdenadas.length !== 1 ? 's' : ''}`, MARGIN, y + 3)
  y += 8

  // ─── Iterar por categoría ────────────────────────────────────────────────
  let needsHeader = true

  categoriasOrdenadas.forEach(cat => {
    const items = grupos[cat]

    // Subtítulo de categoría
    y = checkPage(doc, y, 18)
    if (needsHeader || y < MARGIN + 20) {
      y = drawTableHeader(y)
      needsHeader = false
    }

    // Barra de categoría
    doc.setFillColor(...C_CAT_BG)
    doc.rect(MARGIN, y - 1, CONTENT_W, 6.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_PRIMARY)
    // Indicador visual: rectángulo azul oscuro en vez de caracter Unicode
    doc.setFillColor(...C_PRIMARY)
    doc.rect(MARGIN + 2, y - 0.5, 1.5, 5, 'F')
    doc.text(cat.toUpperCase(), MARGIN + 5.5, y + 3.5)
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    doc.text(`(${items.length})`, MARGIN + 7 + doc.getTextWidth(cat.toUpperCase()), y + 3.5)
    y += 7.5

    // Filas de productos
    items.forEach((p, idx) => {
      y = checkPage(doc, y, 6.5)
      if (y < MARGIN + 14) {
        y = drawTableHeader(y)
        needsHeader = false
      }

      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...C_DARK)

      cols.forEach(col => {
        let val = ''
        const align = ['precio', 'precio2', 'precio3', 'stock'].includes(col.key) ? 'right' : 'left'
        const tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
        const maxChars = Math.floor(col.w / 1.6)

        switch (col.key) {
          case 'codigo':
            val = (p.codigo || '—').substring(0, maxChars)
            break
          case 'nombre':
            val = (p.nombre || '—').substring(0, maxChars)
            doc.setFont('helvetica', 'bold')
            break
          case 'unidad':
            val = (p.unidad || 'und').substring(0, 6)
            break
          case 'stock':
            val = String(p.stock_actual ?? 0)
            if (p.stock_actual <= 0) doc.setTextColor(185, 28, 28)
            break
          case 'precio':
            doc.setFont('helvetica', 'bold')
            val = fmtPrecio(p.precio_usd, moneda, tasa)
            break
          case 'precio2':
            val = p.precio_2 != null ? fmtUsd(p.precio_2) : '—'
            break
          case 'precio3':
            val = p.precio_3 != null ? fmtUsd(p.precio_3) : '—'
            break
        }

        doc.text(val, tx, y + 3, { align })
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...C_DARK)
      })

      y += 6
    })
    y += 2
  })

  drawFooter(doc, config)
  doc.save(`Lista_Precios_${new Date().toISOString().slice(0, 10)}.pdf`)
}
