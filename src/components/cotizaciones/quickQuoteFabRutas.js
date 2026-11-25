// src/components/cotizaciones/quickQuoteFabRutas.js
// OP-2026-080: decisión del dueño — el botón + de cotización rápida solo se muestra en Inicio.
// En el resto de pantallas estorbaba (Clientes ya tiene su propio botón "Cotizar" por tarjeta).
// Va en archivo aparte para que QuickQuoteFAB.jsx solo exporte componentes (regla react-refresh).
export const QUICK_QUOTE_FAB_VISIBLE_PATHS = ['/']

export function isQuickQuoteFabVisible(pathname = '/') {
  return QUICK_QUOTE_FAB_VISIBLE_PATHS.includes(pathname || '/')
}
