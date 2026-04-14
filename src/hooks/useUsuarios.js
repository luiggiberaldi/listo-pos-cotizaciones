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
        .select('id, nombre, rol, activo, creado_en')
        .order('nombre')
      if (error) throw error
      return data ?? []
    },
    enabled: perfil?.rol === 'supervisor',
  })
}

// ─── Crear usuario (vía Worker backend) ─────────────────────────────────────
export function useCrearUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, password, nombre, rol }) => {
      await adminAPI.createUser({ email, password, nombre, rol })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Actualizar nombre, rol y opcionalmente PIN ───────────────────────────────
export function useActualizarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, rol, pin }) => {
      await adminAPI.updateUser(id, { nombre, rol, pin })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
