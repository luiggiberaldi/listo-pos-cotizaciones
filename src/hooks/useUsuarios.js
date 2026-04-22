// src/hooks/useUsuarios.js
// Gestión de usuarios (solo supervisor)
// Las operaciones admin se hacen vía Worker backend (no se expone service key)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { adminAPI } from '../services/supabase/adminClient'
import useAuthStore from '../store/useAuthStore'

const KEY = ['usuarios']

// ─── Lista de usuarios ────────────────────────────────────────────────────────
export function useUsuarios() {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, rol, activo, creado_en, color')
        .order('nombre')
      if (error) throw error
      // Ocultar cuenta "Super Admin" de todo el sistema
      return (data ?? []).filter(u => u.nombre !== 'Super Admin')
    },
    enabled: perfil?.rol === 'supervisor',
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Crear usuario (vía Worker backend) ─────────────────────────────────────
export function useCrearUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nombre, pin, rol, color }) => {
      await adminAPI.createUser({ nombre, pin, rol, color })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Actualizar nombre, rol y opcionalmente PIN ───────────────────────────────
export function useActualizarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, rol, pin, color }) => {
      await adminAPI.updateUser(id, { nombre, rol, pin: pin || undefined, color })
      return { color }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: KEY })
      // Only invalidate dependent caches when color changed (vendedor badge color)
      if (result?.color !== undefined) {
        qc.invalidateQueries({ queryKey: ['cotizaciones'] })
        qc.invalidateQueries({ queryKey: ['clientes'] })
        qc.invalidateQueries({ queryKey: ['despachos'] })
      }
    },
  })
}

// ─── Eliminar usuario (vía Worker backend) ──────────────────────────────────
export function useEliminarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      await adminAPI.deleteUser(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useCambiarActivoUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, activo }) => {
      const { error } = await supabase
        .from('usuarios')
        .update({ activo })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
