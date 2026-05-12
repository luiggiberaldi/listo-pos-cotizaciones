// src/utils/cotizacionActions.js
// Configuración centralizada de acciones de cotización por rol
// Una sola fuente de verdad para labels, confirmaciones y variantes

export const ACCIONES = {
  ver: {
    default: { label: 'Ver', icon: 'Eye' },
  },
  editar: {
    vendedor:   { label: 'Editar' },
    supervisor: { label: 'Editar' },
    default:    { label: 'Editar' },
  },
  revisar: {
    vendedor:   { label: 'Nueva versión' },
    supervisor: { label: 'Revisar' },
    default:    { label: 'Revisar' },
  },
  enviar: {
    vendedor:   { label: 'Enviar' },
    supervisor: { label: 'Enviar' },
    default:    { label: 'Enviar' },
  },
  anular: {
    vendedor: {
      label: 'Cancelar',
      confirmTitle: '¿Cancelar esta cotización?',
      confirmMessage: 'No podrás enviarla ni editarla después.',
      confirmText: 'Sí, cancelar',
      variant: 'danger',
    },
    supervisor: {
      label: 'Anular cotización',
      confirmTitle: '¿Anular esta cotización?',
      confirmMessage: 'Quedará anulada permanentemente. Si tiene stock comprometido, se liberará.',
      confirmText: 'Sí, anular',
      variant: 'danger',
    },
  },
  despachar: {
    supervisor: { label: 'Crear despacho' },
    default:    { label: 'Despachar' },
  },
  reciclar: {
    supervisor: { label: 'Reutilizar' },
    default:    { label: 'Reutilizar' },
  },
  pdf: {
    default: { label: 'PDF' },
  },
  whatsapp: {
    default: { label: 'WhatsApp' },
  },
}

// Obtener la config de una acción para un rol específico
export function getAction(key, rol) {
  const action = ACCIONES[key]
  if (!action) return {}
  return action[rol] || action.default || {}
}

// Colores para el botón primario móvil según tipo de acción
export const PRIMARY_ACTION_COLORS = {
  editar:    { bg: 'bg-sky-500', text: 'text-white', active: 'active:bg-sky-600' },
  despachar: { bg: 'bg-indigo-500', text: 'text-white', active: 'active:bg-indigo-600' },
  whatsapp:  { bg: 'bg-emerald-500', text: 'text-white', active: 'active:bg-emerald-600' },
  reciclar:  { bg: 'bg-teal-500', text: 'text-white', active: 'active:bg-teal-600' },
  ver:       { bg: 'bg-slate-100', text: 'text-slate-700', active: 'active:bg-slate-200' },
  pdf:       { bg: 'bg-slate-100', text: 'text-slate-700', active: 'active:bg-slate-200' },
}
