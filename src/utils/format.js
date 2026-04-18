// src/utils/format.js
// Funciones compartidas de formateo

export function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtUsdSimple(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

export function fmtBs(n) {
  if (n == null || isNaN(n)) return 'Bs 0,00'
  return `Bs ${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function usdToBs(usd, tasa) {
  if (!usd || !tasa) return 0
  return Number(usd) * Number(tasa)
}

export function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtFechaLarga(f) {
  if (!f) return '—'
  const d = new Date(f)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return d.toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) + ` (${tz})`
}

// Sanitiza una cadena de búsqueda para uso seguro en filtros PostgREST .or()
export function sanitizePostgrestSearch(str) {
  if (!str) return ''
  // Escapar caracteres especiales de PostgREST: . , ( ) \
  return str.trim().replace(/[.,()\\%_]/g, '')
}
