// src/hooks/useInventario.js
// Queries y mutations para productos
// — Vendedor usa RPCs SECURITY DEFINER (sin costo_usd)
// — Supervisor usa la tabla productos directa (con costo_usd)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { sanitizePostgrestSearch } from '../utils/format'
import { notifyStockBajo } from '../services/notificationService'
import { showToast } from '../components/ui/Toast'

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
          .select('id, codigo, nombre, descripcion, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, activo, imagen_url, creado_en, actualizado_en', { count: 'exact' })
          .eq('activo', true)

        if (busqueda.trim()) {
          const safe = sanitizePostgrestSearch(busqueda)
          if (safe) query = query.or(`nombre.ilike.%${safe}%,codigo.ilike.%${safe}%`)
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
        if (!busqueda && !categoria && page === 0) {
          const bajos = productos.filter(p => p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo)
          if (bajos.length > 0) notifyStockBajo(bajos)
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
export function useCrearProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (campos) => {
      const { data, error } = await supabase
        .from('productos')
        .insert({
          codigo:       campos.codigo?.trim()      || null,
          nombre:       campos.nombre.trim(),
          descripcion:  campos.descripcion?.trim() || null,
          categoria:    campos.categoria?.trim()   || null,
          unidad:       campos.unidad?.trim()      || 'und',
          precio_usd:   Number(campos.precio_usd)  || 0,
          costo_usd:    campos.costo_usd ? Number(campos.costo_usd) : null,
          stock_actual: Number(campos.stock_actual) || 0,
          stock_minimo: Number(campos.stock_minimo) || 0,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') throw new Error('Ya existe un producto con ese código')
        throw error
      }
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      showToast('Producto creado', 'success')
    },
  })
}

// ─── Mutation: actualizar producto (solo supervisor) ──────────────────────────
export function useActualizarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const { data, error } = await supabase
        .from('productos')
        .update({
          codigo:       campos.codigo?.trim()      || null,
          nombre:       campos.nombre.trim(),
          descripcion:  campos.descripcion?.trim() || null,
          categoria:    campos.categoria?.trim()   || null,
          unidad:       campos.unidad?.trim()      || 'und',
          precio_usd:   Number(campos.precio_usd)  || 0,
          costo_usd:    campos.costo_usd ? Number(campos.costo_usd) : null,
          stock_actual: Number(campos.stock_actual) || 0,
          stock_minimo: Number(campos.stock_minimo) || 0,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') throw new Error('Ya existe un producto con ese código')
        throw error
      }
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      showToast('Producto actualizado', 'success')
      if (data.stock_minimo > 0 && data.stock_actual <= data.stock_minimo) {
        notifyStockBajo([data])
      }
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
