// src/hooks/useLogs.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminAPI } from '../services/supabase/adminClient'

/**
 * Hook para obtener logs paginados con filtros
 */
export function useLogs({ page = 1, limit = 50, nivel, origen, categoria, desde, hasta } = {}) {
  return useQuery({
    queryKey: ['system-logs', page, limit, nivel, origen, categoria, desde, hasta],
    queryFn: () => adminAPI.getLogs({ page, limit, nivel, origen, categoria, desde, hasta }),
    staleTime: 30_000,    // 30s cache
    gcTime: 2 * 60_000,   // 2 min
  })
}

/**
 * Hook para estadísticas de logs
 */
export function useLogStats() {
  return useQuery({
    queryKey: ['system-logs-stats'],
    queryFn: () => adminAPI.getLogStats(),
    staleTime: 60_000,    // 1 min cache
    gcTime: 5 * 60_000,
  })
}

/**
 * Hook mutation para análisis AI
 */
export function useLogAnalysis() {
  return useMutation({
    mutationFn: (tipo) => adminAPI.analyzeLogs(tipo),
  })
}

/**
 * Hook mutation para purgar logs antiguos
 */
export function useLogPurge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dias = 0) => adminAPI.purgeLogs(dias),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-logs'] })
      qc.invalidateQueries({ queryKey: ['system-logs-stats'] })
    },
  })
}
