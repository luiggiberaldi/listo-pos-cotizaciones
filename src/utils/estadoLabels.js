// src/utils/estadoLabels.js
// Etiquetas contextuales de estado de despacho por rol
// Cada rol ve lo que es relevante para SU responsabilidad

const LABELS_DESPACHO = {
  pendiente: {
    vendedor:        'Esperando aprobación',
    supervisor:      'Por aprobar',
    administracion:  'Por aprobar',
    logistica:       'Pendiente',
  },
  despachada: {
    vendedor:        'Aprobada',
    supervisor:      'En entrega',
    administracion:  'Aprobada – En entrega',
    logistica:       'Por entregar',
  },
  entregada: {
    vendedor:        'Entregada',
    supervisor:      'Entregada',
    administracion:  'Entregada',
    logistica:       'Entregada',
  },
  anulada: {
    vendedor:        'Anulada',
    supervisor:      'Anulada',
    administracion:  'Anulada',
    logistica:       'Anulada',
  },
}

// Etiquetas genéricas (cotizaciones — sin cambio por rol)
const LABELS_COTIZACION = {
  borrador:  'Borrador',
  enviada:   'Enviada',
  aceptada:  'Aceptada',
  rechazada: 'No aceptada',
  vencida:   'Vencida',
  anulada:   'Cancelada',
}

/**
 * Obtiene la etiqueta contextual de un estado de despacho según el rol.
 * @param {string} estado - Estado del despacho (pendiente, despachada, entregada, anulada)
 * @param {string} [rol] - Rol del usuario actual
 * @returns {string} Etiqueta contextualizada
 */
export function getDespachoLabel(estado, rol) {
  return LABELS_DESPACHO[estado]?.[rol] || LABELS_DESPACHO[estado]?.vendedor || estado
}

/**
 * Obtiene la etiqueta de un estado de cotización (sin contexto de rol).
 */
export function getCotizacionLabel(estado) {
  return LABELS_COTIZACION[estado] || estado
}

/**
 * Obtiene las opciones de filtro de despacho contextualizadas por rol.
 */
export function getFiltrosDespacho(rol) {
  if (rol === 'logistica') {
    return [
      { valor: '',           label: 'Todas' },
      { valor: 'despachada', label: 'Por entregar' },
      { valor: 'entregada',  label: 'Entregadas' },
    ]
  }
  return [
    { valor: '',           label: 'Todos' },
    { valor: 'pendiente',  label: getDespachoLabel('pendiente', rol) },
    { valor: 'despachada', label: getDespachoLabel('despachada', rol) },
    { valor: 'entregada',  label: 'Entregadas' },
    { valor: 'anulada',    label: 'Anuladas' },
  ]
}
