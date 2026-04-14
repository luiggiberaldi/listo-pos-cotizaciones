// src/utils/format.js
// Funciones compartidas de formateo

export function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtUsdSimple(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

export function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Sanitiza una cadena de búsqueda para uso seguro en filtros PostgREST .or()
export function sanitizePostgrestSearch(str) {
  if (!str) return ''
  // Escapar caracteres especiales de PostgREST: . , ( ) \
  return str.trim().replace(/[.,()\\%_]/g, '')
}
