// src/hooks/useDespachoDescuentos.js
// Query y mutation para descuentos por artículo en despachos
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import { DESPACHOS_KEY } from './useDespachos'
import { showToast } from '../components/ui/Toast'

export const DESCUENTOS_KEY = ['despacho-descuentos']

// ─── Obtener descuentos de un despacho ──────────────────────────────────────
export function useDespachoDescuentos(despachoId) {
  return useQuery({
    queryKey: [...DESCUENTOS_KEY, despachoId],
    queryFn: async () => {
      if (!despachoId) return []
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return []

      const res = await fetch(apiUrl(`/api/despachos/${despachoId}/descuentos`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!despachoId,
    staleTime: 30_000,
  })
}

// ─── Guardar descuentos de un despacho ──────────────────────────────────────
export function useGuardarDescuentos() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, descuentos }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No hay sesión activa')

      const res = await fetch(apiUrl('/api/despachos/descuentos'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ despachoId, descuentos }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al guardar descuentos')
      return result
    },
    onSuccess: async (_data, { despachoId }) => {
      await queryClient.cancelQueries({ queryKey: DESCUENTOS_KEY })
      await queryClient.cancelQueries({ queryKey: DESPACHOS_KEY })
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: DESCUENTOS_KEY, exact: false })
        queryClient.invalidateQueries({ queryKey: DESPACHOS_KEY, exact: false })
      }, 2500)
      showToast('Descuentos aplicados correctamente', 'success')
    },
    onError: (err) => {
      showToast(err.message || 'Error al guardar descuentos', 'error')
    },
  })
}
