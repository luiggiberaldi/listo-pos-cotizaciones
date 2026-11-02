// Reglas de la actualización masiva de precios, para mostrar el efecto en pantalla
// mientras el usuario escribe. Deben coincidir con las del servidor
// (handleBatchPriceUpdate): el servidor es quien manda y vuelve a validar todo.

export const MAX_PORCENTAJE = 1000
export const MAX_PRECIO = 99999999.99

// Devuelve un texto de error si el valor no se puede usar, o null si está bien o vacío.
export function validarValorMasivo(modo, texto) {
  if (texto === '' || texto === null || texto === undefined) return null
  const n = Number(texto)
  if (!Number.isFinite(n)) return 'Escribe un número válido'
  if (modo === 'porcentaje') {
    if (n === 0) return 'Indica un porcentaje distinto de 0'
    if (n <= -100) return 'El porcentaje debe ser mayor a -100: dejaría precios en cero o negativos'
    if (n > MAX_PORCENTAJE) return `El porcentaje no puede superar ${MAX_PORCENTAJE}`
    return null
  }
  if (n <= 0) return 'El precio fijo debe ser mayor a 0'
  if (n > MAX_PRECIO) return 'El precio fijo es demasiado alto'
  return null
}

// Precio nuevo de un producto, o null si no se puede calcular (sin precio actual,
// valor inválido o resultado fuera de rango).
export function precioNuevoMasivo(modo, texto, actual) {
  if (actual === null || actual === undefined || actual === '') return null
  if (texto === '' || validarValorMasivo(modo, texto)) return null
  const a = Number(actual)
  if (!Number.isFinite(a)) return null
  const bruto = modo === 'porcentaje' ? a * (1 + Number(texto) / 100) : Number(texto)
  const nuevo = Math.round(bruto * 100) / 100
  if (!Number.isFinite(nuevo) || nuevo < 0 || nuevo > MAX_PRECIO) return null
  return nuevo
}
