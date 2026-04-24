// src/utils/despachoActions.js
// Configuración centralizada de acciones de despacho por rol
// Una sola fuente de verdad para labels, confirmaciones y variantes

export const ACCIONES = {
  ver: {
    default: { label: 'Ver detalle', icon: 'Eye' },
  },
  despachar: {
    supervisor: {
      label: 'Despachar y entregar',
      confirmTitle: '¿Despachar y marcar como entregada?',
      confirmMessage: 'Se calculará la comisión del vendedor y se cerrará el despacho.',
      confirmDetails: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, despachar',
      variant: 'success',
    },
  },
  entregada: {
    supervisor: {
      label: 'Marcar entregada',
      confirmTitle: '¿Marcar como entregada?',
      confirmMessage: 'Se calculará la comisión del vendedor y se cerrará el despacho.',
      confirmDetails: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, entregada',
      variant: 'success',
    },
  },
  anular: {
    vendedor: {
      label: 'Cancelar despacho',
      confirmTitle: '¿Cancelar este despacho?',
      confirmMessage: 'Se restaurará el stock de todos los productos al inventario.',
      confirmDetails: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, cancelar',
      variant: 'danger',
    },
    supervisor: {
      label: 'Anular despacho',
      confirmTitle: '¿Anular este despacho?',
      confirmMessage: 'Se restaurará el stock de todos los productos al inventario.',
      confirmDetails: 'Esta acción no se puede deshacer. El despacho quedará anulado permanentemente.',
      confirmText: 'Sí, anular',
      variant: 'danger',
    },
  },
  reciclar: {
    supervisor: {
      label: 'Reutilizar',
      confirmTitle: '¿Reciclar como cotización?',
      confirmMessage: 'Se creará una nueva cotización en borrador con los mismos productos y precios.',
      confirmDetails: 'El despacho anulado permanecerá en el historial.',
      confirmText: 'Sí, reciclar',
      variant: 'warning',
    },
  },
  pdf: {
    default: { label: 'Descargar PDF' },
  },
}

// Obtener la config de una acción para un rol específico
export function getDespachoAction(key, rol) {
  const action = ACCIONES[key]
  if (!action) return {}
  return action[rol] || action.default || {}
}

// Colores para el botón primario móvil según tipo de acción
export const PRIMARY_ACTION_COLORS = {
  despachar:  { bg: 'bg-indigo-500', text: 'text-white', active: 'active:bg-indigo-600' },
  entregada:  { bg: 'bg-emerald-500', text: 'text-white', active: 'active:bg-emerald-600' },
  reciclar:   { bg: 'bg-teal-500', text: 'text-white', active: 'active:bg-teal-600' },
  ver:        { bg: 'bg-slate-100', text: 'text-slate-700', active: 'active:bg-slate-200' },
  pdf:        { bg: 'bg-slate-100', text: 'text-slate-700', active: 'active:bg-slate-200' },
}
