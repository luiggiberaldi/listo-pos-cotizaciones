// src/hooks/useBuzon.js
import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'
import { showToast } from '../components/ui/Toast'

const KEY_MIS_MENSAJES = ['buzon', 'mis-mensajes']
const KEY_TODOS = ['buzon', 'todos']

/**
 * Hook para obtener los mensajes del operador actual
 */
export function useMisBuzon() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  
  return useQuery({
    queryKey: KEY_MIS_MENSAJES,
    queryFn: async () => {
      if (!perfil?.id) return []
      const { data, error } = await supabase
        .from('buzon_sugerencias')
        .select(`
          id,
          tipo,
          mensaje,
          estado,
          nota_interna,
          creado_en,
          actualizado_en,
          usuario:usuario_id (nombre, color)
        `)
        .eq('usuario_id', perfil.id)
        .order('creado_en', { ascending: false })

      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil?.id,
    staleTime: 1000 * 30, // 30s
  })
}

/**
 * Hook para enviar una nueva sugerencia, queja o error técnico
 */
export function useEnviarSugerencia() {
  const qc = useQueryClient()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))

  return useMutation({
    mutationFn: async ({ tipo, mensaje }) => {
      if (!perfil?.id) throw new Error('Usuario no autenticado')
      
      const { data, error } = await supabase
        .from('buzon_sugerencias')
        .insert({
          usuario_id: perfil.id,
          tipo,
          mensaje,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      showToast.success('Mensaje enviado. ¡Muchas gracias por tu feedback!')
      qc.invalidateQueries({ queryKey: KEY_MIS_MENSAJES })
      qc.invalidateQueries({ queryKey: KEY_TODOS })
    },
    onError: (err) => {
      showToast.error(`Error al enviar mensaje: ${err.message}`)
    }
  })
}

// El navegador del desarrollador no puede leer la tabla de usuarios, así que el nombre de quien escribió
// llegaba vacío ("Usuario desconocido"). Se completa con la lista de operadores del servidor.
async function completarAutores(mensajes) {
  if (!mensajes.some(m => !m.usuario)) return mensajes
  try {
    const res = await authFetch('/api/auth/operators')
    if (!res.ok) return mensajes
    const { operators } = await res.json()
    const porId = new Map((operators || []).map(o => [o.id, { nombre: o.nombre, color: o.color, rol: o.rol }]))
    return mensajes.map(m => (m.usuario ? m : { ...m, usuario: porId.get(m.usuario_id) ?? null }))
  } catch {
    return mensajes
  }
}

/**
 * Hook para el panel de desarrollador: obtener todos los mensajes de la cuenta
 */
export function useBuzonAdmin() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const isDev = perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: KEY_TODOS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buzon_sugerencias')
        .select(`
          id,
          usuario_id,
          tipo,
          mensaje,
          estado,
          nota_interna,
          creado_en,
          actualizado_en,
          usuario:usuario_id (nombre, color, rol)
        `)
        .order('creado_en', { ascending: false })

      if (error) throw error
      return await completarAutores(data ?? [])
    },
    enabled: isDev,
    staleTime: 1000 * 15, // 15s
    // Revisa cada minuto si llegó algo nuevo (aviso de la campanita y número del menú)
    refetchInterval: isDev ? 60 * 1000 : false,
    refetchIntervalInBackground: true,
  })
}

/**
 * Hook para actualizar el estado o la nota interna de un mensaje (Desarrollador)
 */
export function useMarcarBuzon() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, estado, notaInterna }) => {
      const updates = {}
      if (estado !== undefined) updates.estado = estado
      if (notaInterna !== undefined) updates.nota_interna = notaInterna

      const { data, error } = await supabase
        .from('buzon_sugerencias')
        .update(updates)
        .eq('id', id)
        .select()

      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('No tienes permisos para actualizar este mensaje o no existe')
      }
      return data[0]
    },
    onSuccess: () => {
      showToast.success('Mensaje actualizado')
      qc.invalidateQueries({ queryKey: KEY_MIS_MENSAJES })
      qc.invalidateQueries({ queryKey: KEY_TODOS })
    },
    onError: (err) => {
      showToast.error(`Error al actualizar mensaje: ${err.message}`)
    }
  })
}

/**
 * Hook para eliminar un mensaje del buzón (Desarrollador)
 */
export function useEliminarBuzon() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { data, error } = await supabase
        .from('buzon_sugerencias')
        .delete()
        .eq('id', id)
        .select()

      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('No tienes permisos para eliminar este mensaje o ya fue eliminado (verifica si aplicaste las políticas SQL)')
      }
      return data[0]
    },
    onSuccess: () => {
      showToast.success('Mensaje eliminado')
      qc.invalidateQueries({ queryKey: KEY_MIS_MENSAJES })
      qc.invalidateQueries({ queryKey: KEY_TODOS })
    },
    onError: (err) => {
      showToast.error(`Error al eliminar mensaje: ${err.message}`)
    }
  })
}

