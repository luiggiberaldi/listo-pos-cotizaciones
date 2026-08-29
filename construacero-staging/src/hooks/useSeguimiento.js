// src/hooks/useSeguimiento.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { authFetch } from '../services/authFetch'
import useAuthStore from '../store/useAuthStore'
import { notifySeguimientoCreado } from '../services/notificationService'

export const SEGUIMIENTO_KEY = ['seguimiento']

export function useSeguimiento({ clienteId, cotizacionId, despachoId } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))

  return useQuery({
    queryKey: [...SEGUIMIENTO_KEY, perfil?.id || '', clienteId || '', cotizacionId || '', despachoId || ''],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (clienteId) params.set('cliente_id', clienteId)
      if (cotizacionId) params.set('cotizacion_id', cotizacionId)
      if (despachoId) params.set('despacho_id', despachoId)

      const res = await authFetch(`/api/seguimiento?${params}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Error al cargar el seguimiento operativo')
      }
      return await res.json()
    },
    enabled: !!perfil && (!!clienteId || !!cotizacionId || !!despachoId || ['supervisor', 'administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)),
    staleTime: 1000 * 15, // 15 segundos
  })
}

export function useCrearSeguimiento() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      const res = await authFetch('/api/seguimiento/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear entrada en seguimiento')
      return result
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: SEGUIMIENTO_KEY })
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['despachos'] })

      if (data) {
        try {
          const perfil = useAuthStore.getState().perfil
          notifySeguimientoCreado(data, perfil?.nombre || 'Operador', perfil?.rol)
        } catch (err) {
          console.error('Error al disparar notificación de seguimiento:', err)
        }
      }
    }
  })
}

export function useActualizarSeguimiento() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      const res = await authFetch('/api/seguimiento/actualizar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al actualizar entrada en seguimiento')
      return result
    },
    onMutate: async (newPayload) => {
      // Cancelar refetches salientes
      await qc.cancelQueries({ queryKey: SEGUIMIENTO_KEY })

      // Guardar el estado anterior de todas las consultas coincidentes para hacer rollback
      const queryCache = qc.getQueryCache()
      const matchingQueries = queryCache.findAll({ queryKey: SEGUIMIENTO_KEY })
      const previousData = matchingQueries.map(query => [query.queryKey, query.state.data])

      // Actualizar la cache de manera optimista
      qc.setQueriesData({ queryKey: SEGUIMIENTO_KEY }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map(item => {
          if (item.id === newPayload.id) {
            const updated = { ...item, ...newPayload }
            if (newPayload.prioridad === 'resuelta') {
              updated.tipo = 'resolucion'
            }
            return updated
          }
          return item
        })
      })

      return { previousData }
    },
    onError: (err, newPayload, context) => {
      // Si falla, revertimos al estado anterior de cada consulta
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          qc.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SEGUIMIENTO_KEY })
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['despachos'] })
    }
  })
}

export function useBorrarSeguimiento() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const res = await authFetch('/api/seguimiento/borrar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al borrar entrada de seguimiento')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SEGUIMIENTO_KEY })
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['despachos'] })
    }
  })
}
