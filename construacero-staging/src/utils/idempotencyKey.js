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

/**
 * OP-2026-086 (M3): clave estable a partir de un texto. La misma fila de un CSV produce siempre
 * la misma clave, así que reintentar una importación cortada no duplica productos (el servidor
 * reconoce la clave y devuelve el resultado anterior).
 */
export async function claveDeterministica(texto = '') {
  const datos = new TextEncoder().encode(String(texto))
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', datos))
  const b = Array.from(hash.slice(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // versión 5 (basada en nombre)
  b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
  const h = b.map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
