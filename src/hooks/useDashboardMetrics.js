// El inicio no descarga tablas globales ni comparte métricas entre operadores.
import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { getOperatorSession, subscribeOperatorSession } from '../services/operatorSession'
import { canOpenDashboard, dashboardIdentityMatches } from '../utils/dashboardAccess'

export const DASHBOARD_KEY = ['dashboard_metrics']

export function useDashboardMetrics(periodo = 'mes') {
  const perfil = useAuthStore(state => state.perfil)
  const accountId = useAuthStore(state => state.user?.id)
  const offline = useAuthStore(state => state.offline)
  const session = useSyncExternalStore(subscribeOperatorSession, getOperatorSession, () => null)
  const identity = { accountId, operatorId: perfil?.id, rol: perfil?.rol, sessionId: session?.id }
  const allowed = canOpenDashboard(perfil) && session?.accountId === accountId
    && session?.operatorId === perfil.id && !offline && !perfil?._offline
  const query = useQuery({
    queryKey: [...DASHBOARD_KEY, 'inicio-v1', accountId, perfil?.id, perfil?.rol, session?.id, periodo],
    queryFn: async ({ signal }) => {
      const headers = await getAuthHeaders()
      if (getOperatorSession()?.id !== identity.sessionId) throw new Error('El operador cambió. Vuelve a consultar el inicio.')
      const response = await fetch(apiUrl(`/api/dashboard/inicio?periodo=${encodeURIComponent(periodo)}`), {
        headers, signal, cache: 'no-store',
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'No se pudo cargar el resumen autorizado.')
      }
      const result = await response.json()
      if (getOperatorSession()?.id !== identity.sessionId || !dashboardIdentityMatches(result, identity)) {
        throw new Error('La respuesta no corresponde al operador activo. Vuelve a introducir tu PIN.')
      }
      return result
    },
    enabled: Boolean(allowed),
    meta: { sensitive: true },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 60000,
    placeholderData: undefined,
  })
  // También rechazar datos ya cacheados: enabled=false NO impide leer el caché.
  const data = allowed && !query.isError && dashboardIdentityMatches(query.data, identity) ? query.data : undefined
  return { ...query, data, accessReady: Boolean(allowed), isLoading: Boolean(allowed && query.isLoading) }
}
