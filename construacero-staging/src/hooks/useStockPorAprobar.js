// src/hooks/useStockPorAprobar.js
// OP-2026-087 / OP-2026-095 Fase 1: unidades en despachos "por aprobar" (estado pendiente).
// NO restan del stock disponible: es solo un aviso para que nadie venda a ciegas.
import { useQuery } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'

export const STOCK_POR_APROBAR_KEY = ['stock_por_aprobar']

export function normalizarMapaPorAprobar(rows) {
  return Object.fromEntries(
    (rows ?? [])
      .filter(r => r && r.producto_id && Number(r.total_por_aprobar) > 0)
      .map(r => [r.producto_id, Number(r.total_por_aprobar)]),
  )
}

// Totales por producto: { [producto_id]: total_por_aprobar }
export function useStockPorAprobar() {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: STOCK_POR_APROBAR_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obtener_stock_por_aprobar')
      if (error) {
        console.warn('[STOCK_POR_APROBAR] error:', error.message)
        return {}
      }
      return normalizarMapaPorAprobar(data)
    },
    enabled: !!perfil,
    staleTime: 30_000,
  })
}

// Detalle por producto: quién tiene despachos por aprobar y cuántas unidades
export function useStockPorAprobarDetalle(productoId) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...STOCK_POR_APROBAR_KEY, 'detalle', productoId],
    queryFn: async () => {
      if (!productoId) return []
      const { data, error } = await supabase.rpc('obtener_stock_por_aprobar_detalle', { p_producto_id: productoId })
      if (error) {
        console.warn('[STOCK_POR_APROBAR_DETALLE] error:', error.message)
        return []
      }
      return data ?? []
    },
    enabled: !!perfil && !!productoId,
    staleTime: 30_000,
  })
}
