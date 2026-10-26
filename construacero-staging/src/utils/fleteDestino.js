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
 * Regla completa del estado del destino (2026-10-25): el destino es la dirección
 * del CLIENTE registrado (estado/ciudad son obligatorios al registrarlo), salvo
 * que se active "¿Enviar a otra dirección?" — cuyo bloque ya trae su selector de
 * estado. El selector "Estado del destino" SOLO se muestra como respaldo cuando
 * el cliente no tiene estado guardado (clientes legados).
 *
 * Devuelve:
 *   requiere            — hay chofer local con flete > 0.
 *   mostrarSelector     — solo respaldo: requiere + sin dirección alternativa +
 *                         cliente sin estado.
 *   estadoEnvioEfectivo — lo que viaja al servidor como estado del envío (solo
 *                         dirección alternativa o el respaldo); vacío = que el
 *                         servidor use el estado del cliente.
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
  const clienteTieneEstado = !!String(estadoCliente ?? '').trim()
  const mostrarSelector = requiere && !direccionEnvioActiva && !clienteTieneEstado
  const estadoEnvioEfectivo = (direccionEnvioActiva || mostrarSelector)
    ? String(estadoEnvio ?? '').trim()
    : ''
  const estadoDestino = resolverEstadoDestinoFlete({ estadoEnvio: estadoEnvioEfectivo, estadoCliente })
  return {
    requiere,
    mostrarSelector,
    estadoEnvioEfectivo,
    estadoDestino,
    valido: !requiere || (direccionEnvioActiva ? !!estadoEnvioEfectivo : !!estadoDestino),
  }
}
