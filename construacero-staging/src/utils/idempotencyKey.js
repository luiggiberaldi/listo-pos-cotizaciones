/**
 * Generador reutilizable de claves de idempotencia por firma de operación.
 * Mantiene la misma clave ante reintentos o doble clic del mismo envío y
 * genera una nueva solo si cambia el payload o tras confirmar éxito.
 */
export function generarUuidSeguro() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const s = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${s()}${s()}-${s()}-4${s().slice(1)}-${((8 + Math.random() * 4) | 0).toString(16)}${s().slice(1)}-${s()}${s()}${s()}`
}

export function crearGeneradorClaveIdempotente() {
  let firmaActual = null
  let claveActual = null

  return {
    resolver(firma = '') {
      const claveFirma = typeof firma === 'string' ? firma : JSON.stringify(firma ?? '')
      if (!claveActual || firmaActual !== claveFirma) {
        firmaActual = claveFirma
        claveActual = generarUuidSeguro()
      }
      return claveActual
    },
    limpiar(firma) {
      if (firma === undefined) {
        firmaActual = null
        claveActual = null
        return
      }
      const claveFirma = typeof firma === 'string' ? firma : JSON.stringify(firma ?? '')
      if (firmaActual === claveFirma) {
        firmaActual = null
        claveActual = null
      }
    },
    reiniciar() {
      firmaActual = null
      claveActual = null
    },
  }
}
