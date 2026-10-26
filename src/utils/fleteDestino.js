// src/utils/fleteDestino.js
// Regla del flete de chofer local (misma que el trigger SQL de la migración 235):
// el ESTADO DEL DESTINO decide si el flete va por nómina externa (Carabobo) o
// genera comisión al chofer. Sin estado no se puede decidir y el despacho se
// bloquea. Estas funciones puras mantienen la lógica de pantalla testeable.

/**
 * ¿Se exige indicar el estado del destino?
 * Solo cuando el transportista es local y hay flete mayor que 0.
 */
export function requiereEstadoDestinoFlete({ esLocal, fleteUsd }) {
  return !!esLocal && Number(fleteUsd) > 0
}

/**
 * Estado del destino efectivo: primero el estado del envío (lo que se elige en
 * pantalla / dirección alternativa) y, si no, el estado guardado en la ficha del
 * cliente. Se recortan espacios; vacío = sin estado (bloquea al chofer local).
 */
export function resolverEstadoDestinoFlete({ estadoEnvio = '', estadoCliente = '' } = {}) {
  return String(estadoEnvio ?? '').trim() || String(estadoCliente ?? '').trim()
}

/**
 * Regla completa del estado del destino (2026-10-26): el destino es la dirección
 * del CLIENTE registrado (estado/ciudad son obligatorios al registrarlo), salvo
 * que se active "¿Enviar a otra dirección?" — cuyo bloque ya trae su selector de
 * estado. El selector de respaldo "Estado del destino" se eliminó: ya ningún
 * cliente real queda sin estado (el único registro sin estado era un fixture de
 * pruebas, y el fixture ahora también crea sus clientes con estado y ciudad).
 *
 * Devuelve:
 *   requiere            — hay chofer local con flete > 0.
 *   estadoEnvioEfectivo — estado de la dirección alternativa (solo si está
 *                         activa); vacío = que se use el estado del cliente.
 *   estadoDestino       — estado efectivo del destino (envío o ficha del cliente).
 *   valido              — no bloquea la confirmación; con dirección alternativa
 *                         exige el estado de esa dirección (el flete va allí).
 */
export function reglaEstadoDestinoFlete({
  esLocal = false,
  fleteUsd = 0,
  direccionEnvioActiva = false,
  estadoEnvio = '',
  estadoCliente = '',
} = {}) {
  const requiere = requiereEstadoDestinoFlete({ esLocal, fleteUsd })
  const estadoEnvioEfectivo = direccionEnvioActiva
    ? String(estadoEnvio ?? '').trim()
    : ''
  const estadoDestino = resolverEstadoDestinoFlete({ estadoEnvio: estadoEnvioEfectivo, estadoCliente })
  return {
    requiere,
    estadoEnvioEfectivo,
    estadoDestino,
    valido: !requiere || (direccionEnvioActiva ? !!estadoEnvioEfectivo : !!estadoDestino),
  }
}
