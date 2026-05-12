// src/hooks/useComisiones.js
// Queries y mutations para el sistema de comisiones
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { showToast } from '../components/ui/Toast'

export const COMISIONES_KEY = ['comisiones']

/**
 * Hook para obtener la lista de comisiones (Paginada)
 */
export function useComisiones({ 
  estado = '', 
  vendedorId = '', 
  desde = '', 
  hasta = '',
  page = 1,
  pageSize = 100
} = {}) {
  const perfil = useAuthStore(s => s.perfil)
  const esAdmin = perfil?.rol === 'administracion'

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'lista', perfil?.id, estado, vendedorId, esAdmin, desde, hasta, page, pageSize],
    queryFn: async () => {
      if (!perfil?.id) {
        throw new Error('Perfil de operador no disponible para cargar lista de comisiones')
      }

      try {
        const params = new URLSearchParams()
        
        // Normalización de parámetros
        const vId = vendedorId || null
        if (vId) params.set('vendedorId', vId)
        if (estado) params.set('estado', estado)
        if (desde) params.set('desde', desde)
        if (hasta) params.set('hasta', hasta)
        
        // Paginación
        params.set('page', page.toString())
        params.set('pageSize', pageSize.toString())

        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), {
          headers
        })
        
        const text = await res.text()
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text}`)
        }
        
        const data = JSON.parse(text)
        
        // La API ahora devuelve { data: [], total: 0, ... }
        return data ?? { data: [], total: 0, page, pageSize, totalPages: 0 }
      } catch (e) {
        console.error('Error useComisiones:', e.message)
        throw e
      }
    },
    enabled: !!perfil?.id,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

/**
 * Hook para el resumen de comisiones (KPIs superiores - Exacto vía RPC)
 */
export function useComisionesResumen({ vendedorId = '', desde = '', hasta = '', estado = '' } = {}) {
  const perfil = useAuthStore(s => s.perfil)

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'resumen', perfil?.id, vendedorId, desde, hasta, estado],
    queryFn: async () => {
      if (!perfil?.id) {
        throw new Error('Perfil de operador no disponible para cargar resumen')
      }

      try {
        const params = new URLSearchParams()
        if (vendedorId) params.set('vendedorId', vendedorId)
        if (desde) params.set('desde', desde)
        if (hasta) params.set('hasta', hasta)
        if (estado) params.set('estado', estado)

        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/resumen?${params}`), {
          headers
        })

        const text = await res.text()
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text}`)
        }
        
        return JSON.parse(text)
      } catch (e) {
        console.error('Error useComisionesResumen:', e.message)
        throw e
      }
    },
    enabled: !!perfil?.id,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

/**
 * Mutación para pagar comisiones (Atómica vía RPC)
 */
export function useMarcarComisionPagada() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (comisionId) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/comisiones/pagar'), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comisionId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || result.message || 'Error al procesar pago')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
      showToast('Comisión procesada correctamente', 'success')
    },
  })
}

/**
 * Reporte Detallado de Ventas y Comisiones (RPC)
 */
export function useReporteVentasComisiones({ desde, hasta, vendedorId } = {}) {
  const perfil = useAuthStore(s => s.perfil)

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'detalle_ventas', perfil?.id, desde, hasta, vendedorId],
    queryFn: async () => {
      if (!perfil?.id) return []

      const p_fecha_inicio = desde ? `${desde}T00:00:00` : null
      const p_fecha_fin = hasta ? `${hasta}T23:59:59` : null
      const vId = vendedorId || null

      const { data, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio,
        p_fecha_fin,
        p_vendedor_id: vId
      })

      if (error) {
        console.error('Error RPC Reporte:', error)
        throw error
      }
      return data ?? []
    },
    enabled: !!perfil?.id && !!vendedorId,
  })
}
