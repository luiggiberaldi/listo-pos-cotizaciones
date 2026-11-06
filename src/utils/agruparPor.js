// Agrupa una lista por una clave (Map clave -> filas). Sirve para buscar "las filas de esta venta"
// de una sola vez, en vez de recorrer la lista completa por cada venta (lento en períodos largos).
export function agruparPor(filas, clave) {
  const mapa = new Map()
  for (const fila of filas || []) {
    const k = fila?.[clave]
    if (k === undefined || k === null) continue
    const lista = mapa.get(k)
    if (lista) lista.push(fila)
    else mapa.set(k, [fila])
  }
  return mapa
}
