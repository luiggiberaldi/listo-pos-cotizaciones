// src/hooks/useProductSearch.js
// Hook compartido de búsqueda de productos con smart search + filtro por categoría
import { useMemo } from 'react'
import { smartSearchProductos } from '../utils/smartSearch'

/**
 * Filtra y rankea productos por texto de búsqueda y categoría.
 * Usa smartSearchProductos (ranking por relevancia) cuando hay texto,
 * y filtro simple por categoría cuando no hay texto.
 *
 * @param {Array} productos  - Lista completa de productos
 * @param {string} busqueda  - Texto de búsqueda
 * @param {string} categoria - Categoría activa (vacío = todas)
 * @returns {Array} productos filtrados y ordenados
 */
export function useProductSearch(productos, busqueda, categoria) {
  return useMemo(() => {
    const activos = productos.filter(p => p.activo !== false)

    // Filtro por categoría
    const porCat = categoria
      ? activos.filter(p => (p.categoria ?? '').toUpperCase().startsWith(categoria.toUpperCase()))
      : activos

    // Smart search con ranking por relevancia
    if (!busqueda.trim()) return porCat
    return smartSearchProductos(porCat, busqueda)
  }, [productos, busqueda, categoria])
}
