// src/hooks/useInventario.js
// Queries y mutations para productos
// — Vendedor usa RPCs SECURITY DEFINER (sin costo_usd)
// — Supervisor usa la tabla productos directa (con costo_usd)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { buildSmartFilter, parseSearchTerms } from '../utils/smartSearch'
import { notifyStockBajo } from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { MOVIMIENTOS_KEY } from './useMovimientosInventario'

export const INVENTARIO_KEY = ['inventario']

// ─── Lista de productos ───────────────────────────────────────────────────────
export function useInventario({ busqueda = '', categoria = '', page = 0, pageSize = 100 } = {}) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, busqueda, categoria, esSupervisor, page, pageSize],
    queryFn: async () => {
      if (esSupervisor) {
        // Supervisor: tabla directa (con costo_usd)
        let query = supabase
          .from('productos')
          .select('id, codigo, nombre, descripcion, categoria, unidad, precio_usd, precio_2, precio_3, costo_usd, stock_actual, stock_minimo, activo, imagen_url, creado_en, actualizado_en', { count: 'exact' })
          .eq('activo', true)

        if (busqueda.trim()) {
          const filters = buildSmartFilter(busqueda)
          if (filters) {
            // Cada grupo de variantes se aplica como un .or() — encadenarlos = AND entre términos
            for (const orClause of filters) {
              query = query.or(orClause)
            }
          }
        }

        if (categoria) {
          const isGroup = CATEGORY_GROUPS.includes(categoria.toUpperCase().trim())
          if (isGroup) query = query.ilike('categoria', `${categoria}%`)
          else query = query.eq('categoria', categoria)
        }

        query = query.order('nombre', { ascending: true }).range(page * pageSize, (page + 1) * pageSize - 1)

        const { data, error, count } = await query
        if (error) throw error
        const productos = data ?? []

        // Stock bajo (solo supervisor, sin filtros, primera página)
        if (esSupervisor && !busqueda && !categoria && page === 0) {
          const bajos = productos.filter(p => p.stock_actual <= 0 || (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo))
          if (bajos.length > 0) notifyStockBajo(bajos, 'supervisor')
        }

        return { productos, totalCount: count ?? productos.length }
      }

      // Vendedor: RPC segura (excluye costo_usd, SECURITY DEFINER)
      const isGroup = categoria ? CATEGORY_GROUPS.includes(categoria.toUpperCase().trim()) : false
      const { data, error } = await supabase.rpc('obtener_productos_vendedor', {
        p_busqueda: busqueda.trim(),
        p_categoria: categoria || '',
        p_categoria_grupo: isGroup,
        p_limit: pageSize,
        p_offset: page * pageSize,
      })
      if (error) throw error
      const rows = data ?? []
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0
      const productos = rows.map(({ total_count, ...rest }) => rest)
      return { productos, totalCount }
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 3,
    gcTime: 1000 * 60 * 10,
  })
}

// ─── Agrupación de categorías ────────────────────────────────────────────────
// Prefijos que se consolidan en una sola categoría padre
const CATEGORY_GROUPS = [
  'CONEXIONES',
  'ELECTRICIDAD',
  'LAMINAS',
  'PERFILES',
  'TUBOS ESTRUCTURALES',
  'TUBOS GALVANIZADO',
  'TUBOS PULIDO',
  'TUBOS PVC',
  'TUBOS',
  'VIGAS',
]

// Dada una categoría raw de la DB, retorna el grupo padre
function getCategoryGroup(cat) {
  if (!cat) return cat
  const upper = cat.toUpperCase().trim()
  for (const prefix of CATEGORY_GROUPS) {
    if (upper.startsWith(prefix) && upper !== prefix) return prefix
  }
  return cat
}

// ─── Categorías únicas (para el filtro) ──────────────────────────────────────
export function useCategorias() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, 'categorias'],
    queryFn: async () => {
      if (esSupervisor) {
        const { data, error } = await supabase
          .from('productos')
          .select('categoria')
          .eq('activo', true)
          .not('categoria', 'is', null)
          .order('categoria', { ascending: true })
        if (error) throw error
        const rawCats = (data ?? []).map(r => r.categoria).filter(Boolean)
        const grouped = [...new Set(rawCats.map(getCategoryGroup))].sort()
        return grouped
      }

      // Vendedor: RPC segura (SECURITY DEFINER)
      const { data, error } = await supabase.rpc('obtener_categorias_vendedor')
      if (error) throw error
      const rawCats = (data ?? []).map(r => r.categoria).filter(Boolean)
      const grouped = [...new Set(rawCats.map(getCategoryGroup))].sort()
      return grouped
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 10,
  })
}

// Exportar para uso en useInventario
export { getCategoryGroup }

// ─── Mutation: crear producto (solo supervisor) ───────────────────────────────
// Usa RPC que registra stock inicial en kardex automáticamente
export function useCrearProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (campos) => {
      const { data, error } = await supabase.rpc('crear_producto_con_kardex', {
        p_codigo:       campos.codigo?.trim()      || null,
        p_nombre:       campos.nombre.trim(),
        p_descripcion:  campos.descripcion?.trim() || null,
        p_categoria:    campos.categoria?.trim()   || null,
        p_unidad:       campos.unidad?.trim()      || 'und',
        p_precio_usd:   Number(campos.precio_usd)  || 0,
        p_costo_usd:    campos.costo_usd ? Number(campos.costo_usd) : null,
        p_stock_actual: Number(campos.stock_actual) || 0,
        p_stock_minimo: Number(campos.stock_minimo) || 0,
        p_precio_2:     campos.precio_2 ? Number(campos.precio_2) : null,
        p_precio_3:     campos.precio_3 ? Number(campos.precio_3) : null,
      })

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505')
          throw new Error('Ya existe un producto con ese código')
        throw error
      }
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      showToast('Producto creado', 'success')
    },
  })
}

// ─── Mutation: actualizar producto (solo supervisor) ──────────────────────────
// Usa RPC que registra cambios de stock en kardex automáticamente
export function useActualizarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const { data, error } = await supabase.rpc('actualizar_producto_con_kardex', {
        p_id:           id,
        p_codigo:       campos.codigo?.trim()      || null,
        p_nombre:       campos.nombre.trim(),
        p_descripcion:  campos.descripcion?.trim() || null,
        p_categoria:    campos.categoria?.trim()   || null,
        p_unidad:       campos.unidad?.trim()      || 'und',
        p_precio_usd:   Number(campos.precio_usd)  || 0,
        p_costo_usd:    campos.costo_usd ? Number(campos.costo_usd) : null,
        p_stock_actual: Number(campos.stock_actual) || 0,
        p_stock_minimo: Number(campos.stock_minimo) || 0,
        p_precio_2:     campos.precio_2 ? Number(campos.precio_2) : null,
        p_precio_3:     campos.precio_3 ? Number(campos.precio_3) : null,
      })

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505')
          throw new Error('Ya existe un producto con ese código')
        throw error
      }
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      showToast('Producto actualizado', 'success')
      if (data?.stock_actual <= 0 || (data?.stock_minimo > 0 && data?.stock_actual <= data?.stock_minimo)) {
        notifyStockBajo([data], 'supervisor')
      }
    },
  })
}

// ─── Mutation: borrar producto (hard delete con kardex) ────────────────────────
// Usa RPC que registra egreso del stock restante antes de borrar
export function useBorrarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('borrar_producto_con_kardex', {
        p_producto_id: id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      showToast('Producto eliminado y registrado en kardex', 'success')
    },
    onError: (error) => {
      showToast(error.message || 'Error al borrar producto', 'error')
    },
  })
}

// ─── Mutation: desactivar producto (soft delete) ──────────────────────────────
export function useDesactivarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('productos')
        .update({ activo: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: INVENTARIO_KEY }),
  })
}
