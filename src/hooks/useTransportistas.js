// src/hooks/useTransportistas.js
// Queries y mutations para transportistas
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { apiUrl } from '../services/apiBase'

const KEY = ['transportistas']

// ─── Lista (todos o solo activos) ────────────────────────────────────────────
export function useTransportistas({ soloActivos = true } = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KEY, soloActivos],
    queryFn: async () => {
      let q = supabase
        .from('transportistas')
        .select('id, nombre, rif, telefono, color, vehiculo, placa_chuto, placa_batea, activo')
        .order('nombre')
      if (soloActivos) q = q.eq('activo', true)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30, // transportistas rarely change
  })
}

// ─── Crear (via Worker API — bypass RLS) ─────────────────────────────────────
export function useCrearTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/transportistas/crear'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(campos),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Actualizar (via Worker API — bypass RLS) ───────────────────────────────
export function useActualizarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/transportistas/actualizar'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id, campos }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Desactivar (soft delete) ─────────────────────────────────────────────────
export function useDesactivarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('transportistas').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
