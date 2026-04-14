// src/hooks/useUsuarios.js
// Gestión de usuarios (solo supervisor)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { getAdminClient } from '../services/supabase/adminClient'
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
        .select('id, nombre, email, rol, activo, creado_en')
        .order('nombre')
      if (error) throw error
      return data ?? []
    },
    enabled: perfil?.rol === 'supervisor',
  })
}

// ─── Crear usuario (requiere service key) ─────────────────────────────────────
// 1. Crea el auth user vía admin API
// 2. Inserta en public.usuarios con el mismo id
export function useCrearUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, password, nombre, rol }) => {
      const admin = getAdminClient()
      if (!admin) throw new Error('NO_SERVICE_KEY')

      // Crear en Supabase Auth
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,   // confirmar email automáticamente
      })
      if (authError) {
        if (authError.message.includes('already registered'))
          throw new Error('Ya existe un usuario con ese email')
        throw authError
      }

      // Insertar en public.usuarios
      const { error: dbError } = await supabase.from('usuarios').insert({
        id:     authData.user.id,
        nombre: nombre.trim(),
        email:  email.trim().toLowerCase(),
        rol,
        activo: true,
      })
      if (dbError) {
        // Rollback: eliminar el auth user creado
        await admin.auth.admin.deleteUser(authData.user.id)
        throw dbError
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Actualizar nombre y rol ──────────────────────────────────────────────────
export function useActualizarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, rol }) => {
      const { error } = await supabase
        .from('usuarios')
        .update({ nombre: nombre.trim(), rol })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Cambiar estado activo/inactivo ───────────────────────────────────────────
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
