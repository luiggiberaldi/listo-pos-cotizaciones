// src/services/pdf/listaPreciosPDF.js
// Genera PDF "Lista de Precios" para enviar a clientes — Construacero Carabobo
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import { 
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, 
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY,
  drawSimplifiedHeader, checkPage, drawWatermark
} from './pdfShared'

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
const C_CAT_BG  = [235, 240, 250]


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
  doc.text(fechaTxt, PAGE_W - MARGIN, HDR_H - 3, { align: 'right' })

  return HDR_H + 6
}

function fmtTelefono(tel) {
  if (!tel) return ''
  const s = String(tel).replace(/\D/g, '')
  if (s.length === 11) return `${s.slice(0, 4)}-${s.slice(4, 7)}.${s.slice(7, 9)}.${s.slice(9, 11)}`
  return tel
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function drawFooter(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    // Franja negra superior con las diagonales
    const hazardY = ph - 30
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
    doc.rect(0, ph - 29, PAGE_W, 29, 'F')

    // ── Icono pin ubicación + dirección ──
    doc.setFillColor(...C_WHITE)
    doc.setDrawColor(...C_WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_WHITE)

    const addr1 = 'Av. 76, (Calle S-3) Nro. 70-C-766, Local Galpón Nro. 3 Edificio Centro Industrial Massico II'
    const addr2 = 'Parcela MB-6 y Mb7, Urb. Industrial Aeropuerto Vía Flor Amarillo, Valencia, Edo. Carabobo, Zona Postal 2003'

    const addr1W = doc.getTextWidth(addr1)
    const addr1X = PAGE_W/2 - addr1W/2
    const pinX = addr1X - 4
    const pinY = ph - 21
    doc.circle(pinX, pinY - 0.3, 1.4, 'F')
    doc.triangle(pinX - 1.2, pinY, pinX + 1.2, pinY, pinX, pinY + 2.4, 'F')

    doc.text(addr1, PAGE_W/2, ph - 19.5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W/2, ph - 15, { align: 'center' })

    const tel = fmtTelefono(config.telefono_negocio) || ''
    const email = config.email_negocio || ''
    if (tel || email) {
      const parts = []
      if (tel && tel !== '—') parts.push({ icon: 'phone', text: tel })
      if (email) parts.push({ icon: 'mail', text: email })

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
           doc.setLineWidth(0.4)
           doc.roundedRect(cx, cy - 2.2, 1.6, 2.8, 0.3, 0.3, 'S')
           doc.setLineWidth(0.3)
           doc.line(cx + 0.3, cy + 0.2, cx + 1.3, cy + 0.2)
        } else {
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

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - 10, ph - 4, { align: 'right' })
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
  const { moneda = 'usd', tasa = 0, columnas = {}, formato = 'lista' } = opciones
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config, moneda, tasa)
  drawWatermark(doc)


  // Agrupar por categoría usando el normalizador para corregir errores de tipeo
  const grupos = {}
  productos.forEach(p => {
    const cat = normalizarCategoria(p.categoria)
    if (!grupos[cat]) grupos[cat] = []
    grupos[cat].push(p)
  })
  const categoriasOrdenadas = Object.keys(grupos).sort()

  // ─── Definir columnas dinámicas según opciones ──────────────────────────
  const cols = []
  let xCursor = MARGIN

  let usedCodigoW = 0
  if (columnas.codigo !== false) { // Default to true if undefined
    cols.push({ key: 'codigo', label: 'CÓDIGO', x: xCursor, w: 22 })
    usedCodigoW = 22
    xCursor += 22
  }

  const nombreCol = { key: 'nombre', label: 'DESCRIPCIÓN DE PRODUCTO', x: xCursor, w: 0 }
  cols.push(nombreCol)

  const rightCols = []
  if (columnas.unidad !== false) rightCols.push({ key: 'unidad', label: 'UND', w: 14 })

  const labelPrecio = (MONEDA_LABELS[moneda] || 'PRECIO DETAL USDT').toUpperCase()
  rightCols.push({ key: 'precio', label: labelPrecio, w: 32 })

  if (columnas.precio2) {
    const labelPrecio2 = moneda === 'bs' ? 'PRECIO MAYOR Bs' : moneda === 'bcv' ? 'PRECIO MAYOR BCV' : 'PRECIO MAYOR USDT'
    rightCols.push({ key: 'precio2', label: labelPrecio2, w: 32 })
  }

  if (columnas.stock) {
    rightCols.push({ key: 'stock', label: 'STOCK', w: 16 })
  }

  const rightTotalW = rightCols.reduce((sum, c) => sum + c.w, 0)
  nombreCol.w = CONTENT_W - usedCodigoW - rightTotalW

  let rightX = nombreCol.x + nombreCol.w
  rightCols.forEach(c => {
    c.x = rightX
    rightX += c.w
    cols.push(c)
  })

  // ─── Función para dibujar cabecera de tabla ──────────────────────────────
  function drawTableHeader(yPos, isGrid) {
    const TH_H = 5.5
    if (isGrid) {
      doc.setDrawColor(60, 60, 60)
      doc.setLineWidth(0.3)
      doc.setFillColor(20, 20, 20)
      doc.rect(MARGIN, yPos, CONTENT_W, TH_H, 'FD')
      cols.forEach(col => {
        if (col.x > MARGIN) doc.line(col.x, yPos, col.x, yPos + TH_H)
      })
    } else {
      doc.setDrawColor(0, 0, 0) // Black lines
      doc.setLineWidth(0.4)
      doc.line(MARGIN, yPos, MARGIN + CONTENT_W, yPos)
      doc.line(MARGIN, yPos + TH_H, MARGIN + CONTENT_W, yPos + TH_H)
    }
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    if (isGrid) {
      doc.setTextColor(255, 255, 255)
    } else {
      doc.setTextColor(0, 0, 0)
    }
    
    cols.forEach(col => {
      const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
      let tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
      if (isGrid && align === 'left') tx = col.x + 2
      
      let fs = 6.5
      doc.setFontSize(fs)
      while (doc.getTextWidth(col.label) > col.w - 3 && fs > 4.5) {
        fs -= 0.5
        doc.setFontSize(fs)
      }
      
      doc.text(col.label, tx, yPos + 3.8, { align })
      doc.setFontSize(6.5) // restore
    })
    return yPos + (isGrid ? 5.5 : 6.5)
  }

  // ─── Resumen rápido ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C_GRAY)
  doc.text(`${productos.length} producto${productos.length !== 1 ? 's' : ''} · ${categoriasOrdenadas.length} categoría${categoriasOrdenadas.length !== 1 ? 's' : ''}`, MARGIN, y + 3)
  y += 8

  // ─── Iterar por categoría ────────────────────────────────────────────────
  const isGrid = formato === 'cuadricula'
  let needsHeader = true
  const ROW_H = 6.0

  categoriasOrdenadas.forEach(cat => {
    const items = grupos[cat]

    // Subtítulo de categoría
    let prevY = y
      y = checkPage(doc, y, ROW_H, (d) => drawSimplifiedHeader(d, logoData, config, 'Lista de Precios (Cont.)'))
    if (needsHeader || y < prevY) {
      y = drawTableHeader(y, isGrid)
      needsHeader = false
    }

    const CAT_H = 5.5
    if (isGrid) {
      doc.setFillColor(200, 205, 210)
      doc.rect(MARGIN, y, CONTENT_W, CAT_H, 'F')
      doc.setDrawColor(180, 180, 180)
      doc.setLineWidth(0.3)
      doc.rect(MARGIN, y, CONTENT_W, CAT_H, 'S')
    } else {
      doc.setFillColor(210, 210, 210)
      doc.rect(MARGIN, y, CONTENT_W, CAT_H, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(0, 0, 0)
    const indexStr = String(categoriasOrdenadas.indexOf(cat) + 1)
    doc.text(indexStr, MARGIN + 2, y + 3.8)
    doc.text(cat.toUpperCase(), MARGIN + 10, y + 3.8)
    y += (isGrid ? 5.5 : 6.0)

    // Filas de productos
    items.forEach((p, idx) => {
      let prevY = y
      y = checkPage(doc, y, ROW_H, (d) => drawSimplifiedHeader(d, logoData, config, 'Lista de Precios (Cont.)'))
      if (y < prevY) {
        y = drawTableHeader(y, isGrid)
        needsHeader = false
      }

      if (isGrid) {
        if (idx % 2 === 0) {
          doc.setFillColor(252, 252, 255)
          doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'FD')
        } else {
          doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
        }
        cols.forEach(col => {
          if (col.x > MARGIN) doc.line(col.x, y, col.x, y + ROW_H)
        })
      } else {
        if (idx % 2 === 0) {
          doc.setFillColor(252, 252, 253)
          doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F')
        }
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...C_DARK)

      cols.forEach(col => {
        let val = ''
        const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
        let tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
        if (isGrid && align === 'left') tx = col.x + 2

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
          case 'precio2':
            const basePrecio = col.key === 'precio' ? p.precio_usd : p.precio_2;
            if (basePrecio != null) {
              const usd = Number(basePrecio)
              if (moneda === 'bs' && tasa > 0) {
                 val = 'Bs ' + (usd * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              } else {
                 val = '$' + usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              }
            } else {
              val = '—'
            }
            break
        }

        const textY = y + 4.2
        if (isGrid && ['precio', 'precio2', 'stock'].includes(col.key) && val !== '—') doc.setFont('helvetica', 'bold')

        doc.text(val, tx, textY, { align })
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...C_DARK)
      })

      y += ROW_H
    })
    y += (isGrid ? 0 : 2)
  })

  drawFooter(doc, config)
  doc.save(`Lista_Precios_${new Date().toISOString().slice(0, 10)}.pdf`)
}
