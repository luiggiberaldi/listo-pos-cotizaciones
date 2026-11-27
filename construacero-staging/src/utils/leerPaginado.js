// src/utils/leerPaginado.js
// OP-2026-057 (M7, M2): la base entrega como máximo un número fijo de filas por consulta (en Supabase, 1.000
// por defecto). Para no perder movimientos, las lecturas de la cartera se hacen por páginas hasta traer todo.
// `construir` debe devolver una consulta NUEVA cada vez (con su orden fijo); aquí se le agrega el rango.

/**
 * @param {() => any} construir   función que arma la consulta de Supabase (sin .range ni .limit)
 * @param {{ tam?: number, max?: number }} opciones
 * @returns {Promise<any[]>}
 */
export async function leerPaginado(construir, { tam = 1000, max = 200000 } = {}) {
  let filas = []
  for (let desde = 0; desde < max; desde += tam) {
    const { data, error } = await construir().range(desde, desde + tam - 1)
    if (error) throw error
    const lote = data || []
    filas = filas.concat(lote)
    if (lote.length < tam) break
  }
  return filas
}
