// src/hooks/useMovimientosInventario.js
// Queries y mutations para movimientos de inventario (ingreso/egreso por lotes)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { showToast } from '../components/ui/Toast'
import { notifyStockBajo } from '../services/notificationService'
import { formatCorrelativo } from '../utils/motivosTipo'

export const MOVIMIENTOS_KEY = ['inventario_movimientos']
const KARDEX_KEY = ['kardex']

// ─── Listar movimientos (paginado + filtros) ────────────────────────────────
export function useMovimientosInventario({
  page = 0, pageSize = 30, tipo = '',
  busqueda = '', fechaDesde = '', fechaHasta = '',
} = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...MOVIMIENTOS_KEY, page, pageSize, tipo, busqueda, fechaDesde, fechaHasta],
    queryFn: async () => {
      let query = supabase
        .from('inventario_movimientos')
        .select('*', { count: 'exact' })
        .order('creado_en', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (tipo) query = query.eq('tipo', tipo)
      if (busqueda.trim()) {
        query = query.or(`producto_nombre.ilike.%${busqueda.trim()}%,motivo.ilike.%${busqueda.trim()}%,usuario_nombre.ilike.%${busqueda.trim()}%`)
      }
      if (fechaDesde) query = query.gte('creado_en', fechaDesde + 'T00:00:00')
      if (fechaHasta) query = query.lte('creado_en', fechaHasta + 'T23:59:59')

      const { data, error, count } = await query
      if (error) throw error
      return { movimientos: data ?? [], total: count ?? 0 }
    },
    enabled: perfil?.rol === 'supervisor',
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
  })
}

// ─── Kardex: movimientos de un producto específico ──────────────────────────
export function useKardex(productoId) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KARDEX_KEY, productoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventario_movimientos')
        .select('*')
        .eq('producto_id', productoId)
        .order('creado_en', { ascending: true })

      if (error) throw error
      return data ?? []
    },
    enabled: !!productoId && perfil?.rol === 'supervisor',
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Aplicar movimiento por lotes (atómico vía RPC) ─────────────────────────
export function useAplicarMovimientoLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tipo, motivo, motivo_tipo = 'otro', items }) => {
      const { data, error } = await supabase.rpc('aplicar_movimiento_lote', {
        p_tipo: tipo,
        p_motivo: motivo,
        p_motivo_tipo: motivo_tipo,
        p_items: items,
      })
      if (error) throw error
      return data // { lote_id, numero }
    },
    onSuccess: async (data, variables) => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      qc.invalidateQueries({ queryKey: KARDEX_KEY })
      const n = variables.items.length
      const label = variables.tipo === 'ingreso' ? 'ingresados' : 'retirados'
      const corr = data?.numero ? formatCorrelativo(data.numero) : ''
      showToast(`${corr ? corr + ' — ' : ''}${n} producto${n > 1 ? 's' : ''} ${label} exitosamente`, 'success')

      // Verificar stock bajo después del movimiento
      try {
        const ids = variables.items.map(i => i.producto_id)
        const { data: productos } = await supabase
          .from('productos')
          .select('id, nombre, stock_actual, stock_minimo, unidad')
          .in('id', ids)
        if (productos) {
          const bajos = productos.filter(p =>
            p.stock_actual <= 0 || (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo)
          )
          if (bajos.length > 0) notifyStockBajo(bajos)
        }
      } catch (_) {}
    },
    onError: (error) => {
      showToast(error.message || 'Error al aplicar movimiento', 'error')
    },
  })
}
