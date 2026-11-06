// src/utils/leerPaginas.js
// La base de datos entrega como máximo 1.000 filas por pedido y NO avisa cuando corta.
// Esta herramienta pide de 1.000 en 1.000 hasta traerlo todo (como pedir las hojas de una
// fotocopiadora por bloques hasta que no quede ninguna). La usan los reportes.

export const TAMANO_PAGINA = 1000 // igual al tope del servidor: una página "corta" significa que ya no hay más
export const MAX_PAGINAS = 50 // red de seguridad: 50.000 filas; más que eso es un período absurdo

export class ReporteDemasiadoGrandeError extends Error {
  constructor(maximo) {
    super(`El reporte tiene más de ${maximo.toLocaleString('es-VE')} filas. Elige un período más corto.`)
    this.name = 'ReporteDemasiadoGrandeError'
  }
}

/**
 * Pide todas las páginas de una consulta.
 * @param {(desde: number, hasta: number) => Promise<{data?: any[], error?: any} | any[]>} pedirPagina
 *   Recibe el rango de filas (inclusive, empezando en 0) y devuelve la respuesta de esa página.
 *   La consulta DEBE tener un orden estable (p. ej. terminar en `id`) para que las páginas no se pisen.
 */
export async function leerTodasLasPaginas(pedirPagina, { tamano = TAMANO_PAGINA, maxPaginas = MAX_PAGINAS } = {}) {
  const filas = []
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const desde = pagina * tamano
    const respuesta = await pedirPagina(desde, desde + tamano - 1)
    if (respuesta?.error) throw respuesta.error
    const lote = Array.isArray(respuesta) ? respuesta : (respuesta?.data ?? [])
    if (!Array.isArray(lote)) throw new Error('Respuesta inválida al leer el reporte')
    filas.push(...lote)
    if (lote.length < tamano) return filas
  }
  throw new ReporteDemasiadoGrandeError(tamano * maxPaginas)
}
