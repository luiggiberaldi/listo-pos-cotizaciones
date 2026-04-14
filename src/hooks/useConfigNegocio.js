// src/hooks/useConfigNegocio.js
// Configuración del negocio para header del PDF y ajustes globales
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'

export function useConfigNegocio() {
  return useQuery({
    queryKey: ['config_negocio'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion_negocio')
        .select('*')
        .eq('id', 1)
        .single()

      if (error) {
        // Si no existe la fila, devolver config vacía (no fallar)
        if (error.code === 'PGRST116') return {}
        throw error
      }
      return data ?? {}
    },
    staleTime: 5 * 60 * 1000, // 5 min — cambia poco
  })
}
