// src/services/pdf/pdfShared.js
// Utilidades compartidas para generación de PDFs — Construacero Carabobo
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Layout ──────────────────────────────────────────────────────────────────
export const PAGE_W    = 216
export const PAGE_H    = 279
export const MARGIN    = 14
export const CONTENT_W = PAGE_W - MARGIN * 2

// ─── Colores ─────────────────────────────────────────────────────────────────
export const C_PRIMARY = [58, 99, 168]     // Mariner — header, footer, accents
export const C_ACCENT  = [124, 184, 242]   // Maya Blue — table headers, labels
export const C_DARK    = [5, 8, 52]        // Midnight Express — text
export const C_WHITE   = [255, 255, 255]
export const C_EMERALD = [4, 120, 87]      // Para estados "pagada"/"entregada"
export const C_AMBER   = [146, 64, 14]     // Para estados "pendiente"
export const C_GRAY    = [100, 116, 139]   // Para texto deshabilitado
export const C_RED     = [185, 28, 28]     // Para montos críticos

// ─── Datos del negocio ───────────────────────────────────────────────────────
export const CUENTAS_BANCARIAS = [
  'CTA. CTE. BANESCO 0134 0187 0128 7104 1852',
  'CTA. CTE. PROVINCIAL 0108 0071 4901 0129 1305',
]

// ─── Formateadores ───────────────────────────────────────────────────────────
export function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtBsShort(n) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtBcvUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Formatea fecha corta dd/mm/yyyy. Variante 'short-month' usa mes abreviado. */
export function fmtFecha(f, variant) {
  if (!f) return '—'
  if (variant === 'short-month') {
    return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  if (variant === 'short') {
    return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }
  // Default: normaliza fechas sin timezone para evitar off-by-one
  return new Date(f + (String(f).includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export function fmtFechaCorta(f) {
  return fmtFecha(f, 'short')
}

export function fmtTelefono(tel) {
  if (!tel) return '—'
  const t = String(tel).trim()
  if (t.startsWith('+58')) {
    const num = t.slice(3).replace(/[^\d]/g, '')
    if (num.length === 10) return `0${num.slice(0, 3)}-${num.slice(3)}`
    return `0${num}`
  }
  return t
}

export function fmtPrecio(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if ((moneda === 'bcv' || moneda === 'mixto_bcv') && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  return fmtUsd(n)
}

export function fmtTotal(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if (moneda === 'bcv' && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(n)} / ${fmtBs(Number(n || 0) * tasa)}`
  if (moneda === 'mixto_bcv' && factorBcv > 0 && tasa > 0) return `${fmtBcvUsd(Number(n || 0) * factorBcv)} / ${fmtBs(Number(n || 0) * tasa)}`
  return fmtUsd(n)
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return C_DARK
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}

/** Dibuja checkbox con label */
export function drawCheck(doc, label, x, y, checked = false) {
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

/** Dibuja marca de agua centrada con opacidad */
export function drawWatermark(doc) {
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    const wmSize = 140
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - wmSize) / 2, (PAGE_H - wmSize) / 2, wmSize, wmSize)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}
}

/** Dibuja marca de agua "ANULADA" en rojo, diagonal, semitransparente */
export function drawAnuladaWatermark(doc) {
  try {
    doc.saveGraphicsState()
    const gState = new doc.GState({ opacity: 0.25 })
    doc.setGState(gState)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(60)
    doc.setTextColor(200, 0, 0)
    const cx = PAGE_W / 2
    const cy = PAGE_H / 2
    doc.text('ANULADA', cx, cy, { align: 'center', angle: 45 })
    doc.restoreGraphicsState()
  } catch (_) {}
}

/** Dibuja marca de agua "APROBADO POR: [NOMBRE]" en verde, diagonal, semitransparente */
export function drawAprobadoWatermark(doc, nombre) {
  try {
    doc.saveGraphicsState()
    const gState = new doc.GState({ opacity: 0.18 })
    doc.setGState(gState)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(24)
    doc.setTextColor(30, 80, 160)
    const cx = PAGE_W / 2
    const cy = (PAGE_H / 2) + 30
    // Ajustado para que quede más centrado y pequeño
    doc.text(`APROBADO POR:`, cx - 6, cy - 8, { align: 'center', angle: 35 })
    doc.setFontSize(18)
    doc.text(`${nombre}`.toUpperCase(), cx + 6, cy + 8, { align: 'center', angle: 35 })
    doc.restoreGraphicsState()
  } catch (_) {}
}

/** Verifica si necesita salto de página, agrega nueva con watermark y ejecuta callback si existe */
export function checkPage(doc, y, needed = 30, onPageAdd = null) {
  if (y + needed > PAGE_H - 35) {
    doc.addPage()
    drawWatermark(doc)
    if (onPageAdd && typeof onPageAdd === 'function') {
      return onPageAdd(doc)
    }
    return MARGIN + 10
  }
  return y
}

/** 
 * Dibuja un encabezado simplificado (banner azul pequeño) para páginas subsiguientes.
 * @param {Object} doc - Instancia de jsPDF
 * @param {string} logoData - Base64 del logo
 * @param {Object} config - Configuración del negocio
 * @param {string} rightTitle - Texto a mostrar a la derecha (ej: "Cotización Nº- 00001" o "Lista de Precios (Cont.)")
 */
export function drawSimplifiedHeader(doc, logoData, config, rightTitle = '') {
  const SHDR_H = 12
  doc.setFillColor(...C_PRIMARY)
  doc.rect(0, 0, PAGE_W, SHDR_H, 'F')

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 4, 1.5, 9, 9) } catch (_) {}
  }

  let n = config.nombre_negocio || 'CONSTRUACERO CARABOBO C.A.'
  if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'CONSTRUACERO CARABOBO C.A.'
  
  doc.setFont('times', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text(n.toUpperCase(), MARGIN + 16, 8.5)

  if (rightTitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(rightTitle, PAGE_W - MARGIN, 8.5, { align: 'right' })
  }

  return SHDR_H + 4
}
