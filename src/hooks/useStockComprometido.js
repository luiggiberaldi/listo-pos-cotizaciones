// src/hooks/useStockComprometido.js
// Hook para consultar stock comprometido en cotizaciones activas
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const STOCK_COMPROMETIDO_KEY = ['stock_comprometido']

// Totales por producto (para listados e indicadores rápidos)
export function useStockComprometido() {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: STOCK_COMPROMETIDO_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obtener_stock_comprometido')
      if (error) throw error
      // Convertir a mapa: { productoId: totalComprometido }
      const mapa = {}
      for (const row of (data ?? [])) {
        mapa[row.producto_id] = Number(row.total_comprometido)
      }
      return mapa
    },
    enabled: !!perfil,
    staleTime: 1000 * 30, // 30 segundos — se refresca frecuentemente
    gcTime: 1000 * 60 * 5,
  })
}

// Detalle por producto (quién tiene cuánto en qué cotización)
export function useStockComprometidoDetalle(productoId) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...STOCK_COMPROMETIDO_KEY, 'detalle', productoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obtener_stock_comprometido_detalle', {
        p_producto_id: productoId,
      })
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil && !!productoId,
    staleTime: 1000 * 15,
  })
}
