// src/hooks/useStockComprometido.js
// Stock comprometido por despachos aprobados (estado despachada).
// No se calcula sobre cotizaciones: el compromiso nace al aprobar el despacho
// y desaparece al pasar a entregada o anulada.
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const STOCK_COMPROMETIDO_KEY = ['stock_comprometido']

export function useStockComprometido() {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: STOCK_COMPROMETIDO_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obtener_stock_comprometido')
      if (error) throw error

      return Object.fromEntries(
        (data ?? []).map(row => [row.producto_id, Number(row.total_comprometido || 0)])
      )
    },
    enabled: !!perfil,
    staleTime: 1000 * 30,
    refetchOnWindowFocus: true,
  })
}

export function useStockComprometidoDetalle(productoId) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...STOCK_COMPROMETIDO_KEY, 'detalle', productoId],
    queryFn: async () => {
      if (!productoId) return []

      const { data, error } = await supabase.rpc('obtener_stock_comprometido_detalle', {
        p_producto_id: productoId,
      })
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil && !!productoId,
    staleTime: 1000 * 30,
    refetchOnWindowFocus: true,
  })
}
