// src/hooks/useInventario.js
// Queries y mutations para productos
// — Vendedor usa la vista v_productos_vendedor (sin costo_usd)
// — Supervisor usa la tabla productos directa (con costo_usd)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const INVENTARIO_KEY = ['inventario']

// ─── Lista de productos ───────────────────────────────────────────────────────
export function useInventario({ busqueda = '', categoria = '' } = {}) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, busqueda, categoria, esSupervisor],
    queryFn: async () => {
      // Supervisor: tabla directa (con costo_usd)
      // Vendedor: vista sin costo_usd
      const tabla = esSupervisor ? 'productos' : 'v_productos_vendedor'

      const columnas = esSupervisor
        ? 'id, codigo, nombre, descripcion, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, activo, creado_en, actualizado_en'
        : 'id, codigo, nombre, descripcion, categoria, unidad, precio_usd, stock_actual, stock_minimo, activo'

      let query = supabase
        .from(tabla)
        .select(columnas)
        .eq('activo', true)

      // Búsqueda FTS en español
      if (busqueda.trim()) {
        // Intentar FTS primero; si falla, caer en ilike
        const termino = busqueda.trim().split(/\s+/).join(' & ')
        query = query.or(
          `nombre.ilike.%${busqueda.trim()}%,codigo.ilike.%${busqueda.trim()}%`
        )
      }

      // Filtro de categoría
      if (categoria) {
        query = query.eq('categoria', categoria)
      }

      query = query.order('nombre', { ascending: true })

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil,
  })
}

// ─── Categorías únicas (para el filtro) ──────────────────────────────────────
export function useCategorias() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, 'categorias'],
    queryFn: async () => {
      const tabla = esSupervisor ? 'productos' : 'v_productos_vendedor'
      const { data, error } = await supabase
        .from(tabla)
        .select('categoria')
        .eq('activo', true)
        .not('categoria', 'is', null)
        .order('categoria', { ascending: true })

      if (error) throw error
      const unicas = [...new Set((data ?? []).map(r => r.categoria).filter(Boolean))]
      return unicas
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 10,
  })
}

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
    onSuccess: () => qc.invalidateQueries({ queryKey: INVENTARIO_KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: INVENTARIO_KEY }),
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
