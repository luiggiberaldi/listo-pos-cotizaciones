// src/hooks/useTransportistas.js
// Queries y mutations para transportistas
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

const KEY = ['transportistas']

// ─── Lista (todos o solo activos) ────────────────────────────────────────────
export function useTransportistas({ soloActivos = true } = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KEY, soloActivos],
    queryFn: async () => {
      let q = supabase
        .from('transportistas')
        .select('id, nombre, rif, telefono, color, zona_cobertura, vehiculo, placa_chuto, placa_batea, activo')
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

// ─── Crear ────────────────────────────────────────────────────────────────────
export function useCrearTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const { error } = await supabase.from('transportistas').insert({
        nombre:         campos.nombre.trim(),
        rif:            campos.rif?.trim()           || null,
        telefono:       campos.telefono?.trim()       || null,
        color:          campos.color?.trim()           || null,
        zona_cobertura: campos.zona_cobertura?.trim() || null,
        vehiculo:       campos.vehiculo?.trim()       || null,
        placa_chuto:    campos.placa_chuto?.trim()    || null,
        placa_batea:    campos.placa_batea?.trim()    || null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Actualizar ───────────────────────────────────────────────────────────────
export function useActualizarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const { error } = await supabase.from('transportistas').update({
        nombre:         campos.nombre.trim(),
        rif:            campos.rif?.trim()           || null,
        telefono:       campos.telefono?.trim()       || null,
        color:          campos.color?.trim()           || null,
        zona_cobertura: campos.zona_cobertura?.trim() || null,
        vehiculo:       campos.vehiculo?.trim()       || null,
        placa_chuto:    campos.placa_chuto?.trim()    || null,
        placa_batea:    campos.placa_batea?.trim()    || null,
      }).eq('id', id)
      if (error) throw error
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
