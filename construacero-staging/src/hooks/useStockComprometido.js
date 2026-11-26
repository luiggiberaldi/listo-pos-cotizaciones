// src/hooks/useStockComprometido.js
// Hook para consultar stock comprometido en despachos aprobados (regla 222:
// despachada = comprometido, entregada/pendiente/anulada = no).
// Reactivado con el plan de bloqueo de stock al aprobar (2026-09-06).
import { useQuery } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'

export const STOCK_COMPROMETIDO_KEY = ['stock_comprometido']

// Totales por producto: { [producto_id]: total_comprometido }
export function useStockComprometido() {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: STOCK_COMPROMETIDO_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obtener_stock_comprometido')
      if (error) {
        // Fail-safe: ante error, sin comprometido (no bloquea la UI)
        console.warn('[STOCK_COMPROMETIDO] error:', error.message)
        return {}
      }
      return Object.fromEntries((data ?? []).map(c => [c.producto_id, Number(c.total_comprometido)]))
    },
    enabled: !!perfil,
    staleTime: 60_000, // 1 min: comprometido cambia con cada aprobación/entrega
  })
}

// Detalle por producto: filas de despachos aprobados que comprometen stock
export function useStockComprometidoDetalle(productoId) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...STOCK_COMPROMETIDO_KEY, 'detalle', productoId],
    queryFn: async () => {
      if (!productoId) return []
      const { data, error } = await supabase.rpc('obtener_stock_comprometido_detalle', { p_producto_id: productoId })
      if (error) {
        console.warn('[STOCK_COMPROMETIDO_DETALLE] error:', error.message)
        return []
      }
      return data ?? []
    },
    enabled: !!perfil && !!productoId,
    staleTime: 60_000,
  })
}

// ── OP-2026-087: unidades en despachos "por aprobar" (pendientes) ──
// NO restan del stock disponible: es un aviso para que nadie venda a ciegas.
// Usan el mismo prefijo de clave que el comprometido, así se refrescan juntos.
export const STOCK_POR_APROBAR_KEY = [...STOCK_COMPROMETIDO_KEY, 'por_aprobar']

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
      return Object.fromEntries((data ?? []).map(c => [c.producto_id, Number(c.total_por_aprobar)]))
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
