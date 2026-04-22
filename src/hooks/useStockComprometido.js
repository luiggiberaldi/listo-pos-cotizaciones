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
      // Fetch comprometido y despachos activos en paralelo
      const [comprometidoRes, despachosRes] = await Promise.all([
        supabase.rpc('obtener_stock_comprometido'),
        supabase.from('notas_despacho').select('cotizacion_id').neq('estado', 'anulada'),
      ])
      if (comprometidoRes.error) throw comprometidoRes.error

      const mapa = {}
      for (const row of (comprometidoRes.data ?? [])) {
        mapa[row.producto_id] = Number(row.total_comprometido)
      }

      // Restar las cantidades que ya pasaron a despacho activo
      const cotizacionIds = (despachosRes.data ?? []).map(d => d.cotizacion_id)
      if (cotizacionIds.length > 0) {
        const { data: itemsConDespacho } = await supabase
          .from('cotizacion_items')
          .select('producto_id, cantidad')
          .in('cotizacion_id', cotizacionIds)
          .not('producto_id', 'is', null)

        for (const item of (itemsConDespacho ?? [])) {
          if (mapa[item.producto_id]) {
            mapa[item.producto_id] -= Number(item.cantidad)
            if (mapa[item.producto_id] <= 0) delete mapa[item.producto_id]
          }
        }
      }

      return mapa
    },
    enabled: !!perfil,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  })
}

// Detalle por producto (quién tiene cuánto en qué cotización)
export function useStockComprometidoDetalle(productoId) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...STOCK_COMPROMETIDO_KEY, 'detalle', productoId],
    queryFn: async () => {
      const [detalleRes, despachosRes] = await Promise.all([
        supabase.rpc('obtener_stock_comprometido_detalle', { p_producto_id: productoId }),
        supabase.from('notas_despacho').select('cotizacion_id').neq('estado', 'anulada'),
      ])
      if (detalleRes.error) throw detalleRes.error

      const cotizacionIdsConDespacho = new Set((despachosRes.data ?? []).map(d => d.cotizacion_id))
      // Excluir filas de cotizaciones que ya tienen despacho activo
      return (detalleRes.data ?? []).filter(row => !cotizacionIdsConDespacho.has(row.cotizacion_id))
    },
    enabled: !!perfil && !!productoId,
    staleTime: 1000 * 15,
  })
}
