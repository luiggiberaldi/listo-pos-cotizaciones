// src/hooks/useMovimientosInventario.js
// Queries y mutations para movimientos de inventario (ingreso/egreso por lotes)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { showToast } from '../components/ui/Toast'

const MOVIMIENTOS_KEY = ['inventario_movimientos']

// ─── Listar movimientos (paginado) ──────────────────────────────────────────
export function useMovimientosInventario({ page = 0, pageSize = 30, tipo = '' } = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...MOVIMIENTOS_KEY, page, pageSize, tipo],
    queryFn: async () => {
      let query = supabase
        .from('inventario_movimientos')
        .select('*', { count: 'exact' })
        .order('creado_en', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (tipo) query = query.eq('tipo', tipo)

      const { data, error, count } = await query
      if (error) throw error
      return { movimientos: data ?? [], total: count ?? 0 }
    },
    enabled: perfil?.rol === 'supervisor',
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
  })
}

// ─── Aplicar movimiento por lotes (atómico vía RPC) ─────────────────────────
export function useAplicarMovimientoLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tipo, motivo, items }) => {
      const { data, error } = await supabase.rpc('aplicar_movimiento_lote', {
        p_tipo: tipo,
        p_motivo: motivo,
        p_items: items,
      })
      if (error) throw error
      return data // lote_id
    },
    onSuccess: (_loteId, variables) => {
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      const n = variables.items.length
      const label = variables.tipo === 'ingreso' ? 'ingresados' : 'retirados'
      showToast(`${n} producto${n > 1 ? 's' : ''} ${label} exitosamente`, 'success')
    },
    onError: (error) => {
      showToast(error.message || 'Error al aplicar movimiento', 'error')
    },
  })
}
