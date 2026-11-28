// src/hooks/useAuditoria.js
// Auditoría 2.0 (OP-2026-110): todas las lecturas pasan por /api/admin/audit/*
// para aplicar la separación real de roles en el servidor (supervisor sin precios/dinero).
import { useQuery } from '@tanstack/react-query'
import { authFetch } from '../services/authFetch'
import useAuthStore from '../store/useAuthStore'

const KEY = ['auditoria']
const ROLES_LECTURA = ['supervisor', 'jefe', 'administracion', 'desarrollador']
const ROLES_FINANZAS = ['jefe', 'administracion', 'desarrollador']

export function useAuditoria({ pagina = 0, porPagina = 50, usuarioId = '', categoria = '' } = {}) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...KEY, 'bitacora', pagina, porPagina, usuarioId, categoria],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(pagina + 1),
        limit: String(porPagina),
      })
      if (usuarioId) params.set('usuario_id', usuarioId)
      if (categoria) params.set('categoria', categoria.toUpperCase())
      const res = await authFetch(`/api/admin/audit?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar la auditoría')
      const data = await res.json()
      return { registros: data?.registros ?? [], total: data?.total ?? 0 }
    },
    enabled: ROLES_LECTURA.includes(perfil?.rol),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
  })
}

export function useAuditoriaStats() {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KEY, 'stats'],
    queryFn: async () => {
      const res = await authFetch('/api/admin/audit/stats')
      if (!res.ok) throw new Error('Error al cargar estadísticas de auditoría')
      return res.json()
    },
    enabled: ROLES_LECTURA.includes(perfil?.rol),
    staleTime: 1000 * 60 * 2,
  })
}

export function useAuditoriaCambios({ pagina = 0, porPagina = 50, tabla = '', origen = '', registroId = '' } = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KEY, 'cambios', pagina, porPagina, tabla, origen, registroId],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(pagina + 1),
        limit: String(porPagina),
      })
      if (tabla) params.set('tabla', tabla)
      if (origen) params.set('origen', origen)
      if (registroId) params.set('registro_id', registroId)
      const res = await authFetch(`/api/admin/audit/cambios?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar cambios de auditoría')
      return res.json()
    },
    enabled: ROLES_LECTURA.includes(perfil?.rol),
    staleTime: 1000 * 60,
  })
}

export function useAuditoriaPeticiones({ pagina = 0, porPagina = 50, resultado = '' } = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KEY, 'peticiones', pagina, porPagina, resultado],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(pagina + 1),
        limit: String(porPagina),
      })
      if (resultado) params.set('resultado', resultado)
      const res = await authFetch(`/api/admin/audit/peticiones?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar registro del portero')
      return res.json()
    },
    enabled: ROLES_FINANZAS.includes(perfil?.rol),
    staleTime: 1000 * 60,
  })
}

export function useAuditoriaHistoria({ tabla = '', id = '', enabled = false } = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KEY, 'historia', tabla, id],
    queryFn: async () => {
      const params = new URLSearchParams({ id })
      if (tabla) params.set('tabla', tabla)
      const res = await authFetch(`/api/admin/audit/historia?${params.toString()}`)
      if (!res.ok) throw new Error('Error al cargar historia del registro')
      return res.json()
    },
    enabled: Boolean(enabled && id && ROLES_LECTURA.includes(perfil?.rol)),
    staleTime: 1000 * 30,
  })
}
