// src/hooks/useConfigNegocio.js
// Configuración del negocio para header del PDF y ajustes globales
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'

const KEY = ['config_negocio']

export function useConfigNegocio() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion_negocio')
        .select('*')
        .eq('id', 1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') return {}
        throw error
      }
      return data ?? {}
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Guardar configuración (upsert sobre id = 1) ──────────────────────────────
export function useActualizarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const { error } = await supabase
        .from('configuracion_negocio')
        .upsert({ id: 1, ...campos }, { onConflict: 'id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
