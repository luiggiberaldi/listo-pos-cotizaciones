// src/services/pdf/listaPreciosPDF.js
// Genera PDF "Lista de Precios" para enviar a clientes — Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
// ─── Helpers ──────────────────────────────────────────────────────────────────
const CATEGORY_GROUPS = [
  'CONEXIONES',
  'ELECTRICIDAD',
  'LAMINAS',
  'PERFILES',
  'TUBOS ESTRUCTURALES',
  'TUBOS GALVANIZADO',
  'TUBOS PULIDO',
  'TUBOS PVC',
  'TUBOS',
  'VIGAS',
]

function normalizarCategoria(cat) {
  if (!cat) return 'SIN CATEGORÍA'
  let upper = cat.toUpperCase().trim()
  
  // Limpieza inicial
  upper = upper.replace(/\s+/g, ' ')
  if (upper.includes('AGUA') && upper.includes('FRIA') && upper.includes('PVC')) upper = 'TUBOS PVC AGUAS FRIAS'
  if (upper.includes('PVC') && upper.includes('ELECTRIC')) upper = 'TUBOS PVC ELECTRICIDAD'
  if (upper === 'TUBOS ESTRUCTURAL' || upper === 'TUBO ESTRUCTURAL') upper = 'TUBOS ESTRUCTURALES'

  // Estandarizar plurales iniciales
  if (upper.startsWith('TUBO ')) upper = upper.replace('TUBO ', 'TUBOS ')
  if (upper.startsWith('LAMINA ')) upper = upper.replace('LAMINA ', 'LAMINAS ')
  if (upper.startsWith('VIGA ')) upper = upper.replace('VIGA ', 'VIGAS ')
  if (upper.startsWith('PERFIL ')) upper = upper.replace('PERFIL ', 'PERFILES ')
  if (upper.startsWith('MALLA ')) upper = upper.replace('MALLA ', 'MALLAS ')
  if (upper.startsWith('CONEXION ')) upper = upper.replace('CONEXION ', 'CONEXIONES ')

  // Agrupación fuerte (como hace la UI principal)
  for (const prefix of CATEGORY_GROUPS) {
    if (upper.startsWith(prefix)) return prefix
  }

  return upper
}

function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPrecio(n, moneda, tasa) {
  const usd = Number(n || 0)
  if (moneda === 'bs' && tasa > 0) return fmtBs(usd * tasa)
  if ((moneda === 'mixto' || moneda === 'mixto_bcv') && tasa > 0) return `${fmtUsd(usd)}  /  ${fmtBs(usd * tasa)}`
  return fmtUsd(usd)
}
const MONEDA_LABELS = {
  '$': 'Precio Detal USDT',
  'bcv': 'Precio Detal BCV',
  'bs': 'Precio Bs',
  'mixto': 'Precio USDT / Bs',
  'mixto_bcv': 'Precio BCV / Bs',
  'usd': 'Precio Detal USD',
}

// ─── Layout y Colores ────────────────────────────────────────────────────────
const PAGE_W    = 216
const PAGE_H    = 279
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

// Trunca texto para que quepa en maxW mm, agregando '…' si se corta
function fitText(doc, text, maxW) {
  if (!text) return '—'
  if (doc.getTextWidth(text) <= maxW) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
  return t + '…'
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
  let n = config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.'
  if (n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'CONSTRUACERO CARABOBO C.A.'
  const nombreNeg = n.split(' ')
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
  const tasaTxt = (moneda === 'bs' || moneda === 'mixto' || moneda === 'mixto_bcv' || moneda === 'bcv') && tasa > 0
    ? `  ·  Tasa: Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
    let footName = config.nombre_negocio || 'Construacero Carabobo C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Construacero Carabobo C.A.'
    doc.text(footName, MARGIN, PAGE_H - 10)
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
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config, moneda, tasa)
  addWatermark(doc)

  // Agrupar por categoría usando el normalizador para corregir errores de tipeo
  const grupos = {}
  productos.forEach(p => {
    const cat = normalizarCategoria(p.categoria)
    if (!grupos[cat]) grupos[cat] = []
    grupos[cat].push(p)
  })
  const categoriasOrdenadas = Object.keys(grupos).sort()

  // ─── Definir columnas estrictas (diseño original) ──────────────────────────
  const cols = []
  let xCursor = MARGIN

  cols.push({ key: 'codigo', label: 'CODIGO', x: xCursor, w: 22 })
  xCursor += 22

  const nombreCol = { key: 'nombre', label: 'DESCRIPCION DE PRODUCTO', x: xCursor, w: 0 }
  cols.push(nombreCol)

  const rightCols = [
    { key: 'unidad', label: 'UND', w: 14 },
    { key: 'precio', label: 'PRECIO DETAL USD', w: 28 },
    { key: 'precio2', label: 'PRECIO MAYOR USD', w: 28 },
    { key: 'stock', label: 'STOCK', w: 16 }
  ]

  const rightTotalW = rightCols.reduce((sum, c) => sum + c.w, 0)
  nombreCol.w = CONTENT_W - 22 - rightTotalW

  let rightX = nombreCol.x + nombreCol.w
  rightCols.forEach(c => {
    c.x = rightX
    rightX += c.w
    cols.push(c)
  })

  // ─── Función para dibujar cabecera de tabla ──────────────────────────────
  function drawTableHeader(yPos) {
    doc.setDrawColor(0, 0, 0) // Black lines
    doc.setLineWidth(0.4)
    doc.line(MARGIN, yPos, MARGIN + CONTENT_W, yPos)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(0, 0, 0) // Black text
    
    cols.forEach(col => {
      const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
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

    // Barra de categoría (Estilo Clásico: texto negrita)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    const indexStr = String(categoriasOrdenadas.indexOf(cat) + 1)
    doc.text(indexStr, MARGIN + 1, y + 4.5)
    doc.text(cat.toUpperCase(), MARGIN + 10, y + 4.5)
    y += 7.5

    // Filas de productos
    items.forEach((p, idx) => {
      y = checkPage(doc, y, 8)
      if (y < MARGIN + 14) {
        y = drawTableHeader(y)
        needsHeader = false
      }

      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 7.5, 'F')
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C_DARK)

      cols.forEach(col => {
        let val = ''
        const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
        const tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
        const maxChars = Math.floor(col.w / 1.6)

        const colMaxW = col.w - 2 // 1mm padding each side

        switch (col.key) {
          case 'codigo':
            val = fitText(doc, p.codigo || '—', colMaxW)
            break
          case 'nombre':
            val = fitText(doc, p.nombre || '—', colMaxW)
            break
          case 'unidad':
            val = (p.unidad || 'Und')
            val = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
            break
          case 'stock':
            val = p.stock_actual != null ? String(p.stock_actual) : '—'
            if (p.stock_actual <= 0) doc.setTextColor(185, 28, 28)
            break
          case 'precio':
            val = p.precio_usd != null ? Number(p.precio_usd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
            break
          case 'precio2':
            val = p.precio_2 != null ? Number(p.precio_2).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
            break
        }

        doc.text(val, tx, y + 3, { align })
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...C_DARK)
      })

      y += 7.5
    })
    y += 2
  })

  drawFooter(doc, config)
  doc.save(`Lista_Precios_${new Date().toISOString().slice(0, 10)}.pdf`)
}
