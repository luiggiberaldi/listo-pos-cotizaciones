// src/utils/despachoActions.js
// Configuración centralizada de acciones de despacho por rol
// Una sola fuente de verdad para labels, confirmaciones y variantes

export const ACCIONES = {
  ver: {
    default: { label: 'Ver detalle', icon: 'Eye' },
  },
  despachar: {
    supervisor: {
      label: 'Aprobar despacho',
      confirmTitle: '¿Aprobar este despacho?',
      confirmMessage: 'Se calculará la comisión del vendedor.',
      confirmDetails: 'El despacho pasará a estar listo para entrega.',
      confirmText: 'Sí, aprobar',
      variant: 'success',
    },
    administracion: {
      label: 'Aprobar despacho',
      confirmTitle: '¿Aprobar este despacho?',
      confirmMessage: 'Se calculará la comisión del vendedor.',
      confirmDetails: 'El despacho pasará a estar listo para entrega.',
      confirmText: 'Sí, aprobar',
      variant: 'success',
    },
  },
  entregar: {
    supervisor: {
      label: 'Marcar entregada',
      confirmTitle: '¿Marcar como entregada?',
      confirmMessage: 'Se confirmará la entrega del material al cliente.',
      confirmDetails: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, entregada',
      variant: 'success',
    },
    administracion: {
      label: 'Marcar entregada',
      confirmTitle: '¿Marcar como entregada?',
      confirmMessage: 'Se confirmará la entrega del material al cliente.',
      confirmDetails: 'Esta acción no se puede deshacer.',
      confirmText: 'Sí, entregada',
      variant: 'success',
    },
    logistica: {
      label: 'Confirmar entrega',
      confirmTitle: '¿Confirmar entrega realizada?',
      confirmMessage: 'Se marcará el despacho como entregado al cliente.',
      confirmDetails: '',
      confirmText: 'Sí, confirmar entrega',
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
    administracion: {
      label: 'Anular despacho',
      confirmTitle: '¿Anular este despacho?',
      confirmMessage: 'Se restaurará el stock de todos los productos al inventario.',
      confirmDetails: 'Esta acción no se puede deshacer.',
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
  despachar:  { bg: 'bg-blue-500', text: 'text-white', active: 'active:bg-blue-600' },
  entregar:   { bg: 'bg-emerald-500', text: 'text-white', active: 'active:bg-emerald-600' },
  reciclar:   { bg: 'bg-teal-500', text: 'text-white', active: 'active:bg-teal-600' },
  ver:        { bg: 'bg-slate-100', text: 'text-slate-700', active: 'active:bg-slate-200' },
  pdf:        { bg: 'bg-slate-100', text: 'text-slate-700', active: 'active:bg-slate-200' },
}
