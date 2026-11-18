// ¿A quién le corresponde la comisión de una venta? (OP-2026-032)
//
// Misma regla que la base de datos (calcularcomisiondespacho_238b): la comisión
// es del DUEÑO DEL CLIENTE, no de quien hace la venta. Si el dueño es un usuario
// sin comisión (p. ej. EMPRESA) o un rol administrativo, no hay comisión.
// Las pantallas usan esto para no mostrarle al vendedor una "comisión estimada"
// que en realidad no va a cobrar.

const ROLES_SIN_COMISION = ['jefe', 'administracion', 'logistica', 'desarrollador']

/**
 * @param {object|null} cliente - cliente con vendedor_id y vendedor {id, nombre, rol}
 * @param {object|null} perfil  - operador actual
 * @returns {{ tipo: 'propio'|'ajeno'|'sin_comision', duenoNombre: string|null }}
 */
export function destinoComision(cliente, perfil) {
  const duenoId = cliente?.vendedor_id || cliente?.vendedor?.id || null
  if (!cliente || !duenoId) return { tipo: 'propio', duenoNombre: null }

  const esPropio = duenoId === perfil?.id
  const dueno = esPropio ? { ...cliente.vendedor, ...perfil } : (cliente.vendedor || {})
  const duenoNombre = dueno.nombre || 'otro vendedor'
  const rol = dueno.rol

  if (ROLES_SIN_COMISION.includes(rol)) return { tipo: 'sin_comision', duenoNombre }
  if (rol === 'vendedor_sin_comision' && !dueno.es_externo) return { tipo: 'sin_comision', duenoNombre }
  if (!esPropio) return { tipo: 'ajeno', duenoNombre }
  return { tipo: 'propio', duenoNombre }
}

/** Texto corto para mostrar en lugar del monto cuando la comisión no es del vendedor. */
export function textoDestinoComision(destino) {
  if (destino?.tipo === 'ajeno') return `Comisión para ${destino.duenoNombre} (dueño del cliente)`
  if (destino?.tipo === 'sin_comision') return `Sin comisión (cliente de ${destino.duenoNombre})`
  return null
}
