// src/hooks/useTransportistas.js
// Queries y mutations para transportistas
import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { showToast } from '../components/ui/Toast'
import {
  isMissingTransportistaColumnError,
  normalizeTransportistaSchema,
  TRANSPORTISTA_SELECT_ALL,
  TRANSPORTISTA_SELECT_BASE,
  TRANSPORTISTA_SELECT_LEGACY,
} from '../utils/transportistaSchema'

const KEY = ['transportistas']

// ─── Lista (todos o solo activos) ────────────────────────────────────────────
export function useTransportistas({ soloActivos = true, paginado = false, page = 1, pageSize = 12, search = '', tipo = 'todos' } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: [...KEY, soloActivos, paginado, page, pageSize, search, tipo],
    queryFn: async () => {
      const planes = [
        {
          // Es la consulta normal: evita 400 por columnas opcionales ausentes
          // y devuelve cualquier campo nuevo sin cambiar el select cada vez.
          select: TRANSPORTISTA_SELECT_ALL,
          columnasBusqueda: ['nombre', 'rif', 'placa_chuto', 'placa_batea', 'vehiculo', 'zona_cobertura', 'capacidad'],
          soportaClasificacion: true,
        },
        {
          select: TRANSPORTISTA_SELECT_BASE,
          columnasBusqueda: ['nombre', 'rif', 'placa_chuto', 'placa_batea', 'vehiculo', 'zona_cobertura', 'capacidad'],
          soportaClasificacion: true,
        },
        {
          select: TRANSPORTISTA_SELECT_LEGACY,
          columnasBusqueda: ['nombre', 'rif', 'zona_cobertura'],
          soportaClasificacion: false,
        },
      ]

      const ejecutarConsulta = async (plan) => {
        let q = supabase
          .from('transportistas')
          .select(plan.select, paginado ? { count: 'exact' } : undefined)
          .order('nombre')
        if (soloActivos) q = q.eq('activo', true)
        // Si la base aún no tiene es_local, nunca debemos mostrar registros
        // generales como locales. En modo legacy solo el filtro "generales"
        // es seguro; para "locales" devolvemos una lista vacía.
        if (plan.soportaClasificacion && tipo === 'locales') q = q.eq('es_local', true)
        if (plan.soportaClasificacion && tipo === 'generales') q = q.eq('es_local', false)
        const term = String(search || '').trim().replace(/[(),]/g, ' ')
        if (term) {
          const pattern = `%${term}%`
          q = q.or(plan.columnasBusqueda.map(columna => `${columna}.ilike.${pattern}`).join(','))
        }
        if (paginado) {
          const from = Math.max(0, (page - 1) * pageSize)
          q = q.range(from, from + pageSize - 1)
        }
        return q
      }

      let result = null
      let esquemaCompatibilidad = false
      for (const plan of planes) {
        result = await ejecutarConsulta(plan)
        if (!result.error) {
          esquemaCompatibilidad = plan !== planes[0]
          if (!plan.soportaClasificacion && tipo === 'locales') {
            return paginado ? { items: [], total: 0, esquemaCompatibilidad: true } : []
          }
          break
        }
        if (!isMissingTransportistaColumnError(result.error)) break
      }
      const { data, count, error } = result
      if (error) throw error
      const items = (data ?? []).map(normalizeTransportistaSchema)
      return paginado
        ? { items, total: count ?? 0, esquemaCompatibilidad }
        : items
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30, // transportistas rarely change
  })
}

// ─── Crear (via Worker API — bypass RLS) ───────────────────────────────────────────────
export function useCrearTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const headers = await getAuthHeaders()
      if (!headers.Authorization?.includes('Bearer ')) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/transportistas/crear'), {
        method: 'POST',
        headers,
        body: JSON.stringify(campos),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: async (nuevo) => {
      const tReal = nuevo.transportista || nuevo
      if (!tReal?.id) return

      // Cancelar cualquier refetch para que no nos pise el update optimístico
      await qc.cancelQueries({ queryKey: KEY })

      // Inyectar en TODAS las variantes de la query ['transportistas'] (activos y todos)
      qc.setQueriesData({ queryKey: KEY, exact: false }, (viejos) => {
        const arr = Array.isArray(viejos) ? viejos : []
        if (arr.some(t => t.id === tReal.id)) return arr
        return [tReal, ...arr].sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''))
      })

      showToast.success('Transportista creado')

      // Invalidación muy diferida para entornos con alta latencia (Vercel)
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
  })
}

// ─── Actualizar (via Worker API — bypass RLS) ───────────────────────────────────────────
export function useActualizarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const headers = await getAuthHeaders()
      if (!headers.Authorization?.includes('Bearer ')) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/transportistas/actualizar'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, ...campos }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: async (nuevo) => {
      const tReal = nuevo.transportista || nuevo
      if (!tReal?.id) return

      await qc.cancelQueries({ queryKey: KEY })

      qc.setQueriesData({ queryKey: KEY, exact: false }, (viejos) => {
        const arr = Array.isArray(viejos) ? viejos : []
        return arr.map(t => t.id === tReal.id ? tReal : t)
      })

      showToast.success('Transportista actualizado')
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
  })
}


// ─── Reporte de transportistas locales (admin/desarrollador/logística/jefe) ──────────
const REPORTE_TRANSP_KEY = ['reporte-transportistas']

export function useReporteTransportistas({ desde = null, hasta = null } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = ['administracion', 'desarrollador', 'logistica', 'jefe'].includes(perfil?.rol)
  return useQuery({
    // Incluir fechas en queryKey para invalidar correctamente al cambiar el rango
    queryKey: [...REPORTE_TRANSP_KEY, desde, hasta],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const params = new URLSearchParams()
      if (desde) params.set('desde', desde)
      if (hasta) params.set('hasta', hasta)
      const qs = params.toString() ? `?${params}` : ''
      const res = await fetch(apiUrl(`/api/transportistas/reporte${qs}`), { headers })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Error ${res.status}`)
      }
      const data = await res.json()
      return data.items ?? []
    },
    enabled: !!perfil && puede,
    staleTime: 1000 * 60 * 2,
  })
}

export function useDetalleTransportista(transportistaId) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = ['administracion', 'desarrollador', 'logistica', 'jefe'].includes(perfil?.rol)
  return useQuery({
    queryKey: [...REPORTE_TRANSP_KEY, 'detalle', transportistaId],
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/transportistas/detalle?id=${transportistaId}`), { headers })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      return res.json()
    },
    enabled: !!perfil && puede && !!transportistaId,
    staleTime: 1000 * 30,
  })
}

export function usePagarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ transportistaId, monto, referencia, nota, despachoIds, idempotencyKey }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/transportistas/pagar'), {
        method: 'POST', headers,
        body: JSON.stringify({ transportistaId, monto, referencia, nota, despachoIds, idempotencyKey: idempotencyKey || crypto.randomUUID() }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      showToast.success('Pago registrado al transportista')
      qc.invalidateQueries({ queryKey: REPORTE_TRANSP_KEY, exact: false })
    },
  })
}

// ─── Revertir pago a transportista (solo admin/desarrollador) ───────────────────
export function useRevertirPagoTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pagoId) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/transportistas/revertir-pago'), {
        method: 'POST', headers,
        body: JSON.stringify({ pagoId }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      showToast.success('Pago revertido correctamente')
      qc.invalidateQueries({ queryKey: REPORTE_TRANSP_KEY, exact: false })
    },
    onError: (err) => {
      showToast.error(err.message || 'Error al revertir el pago')
    },
  })
}

// ─── Desactivar transportista (via Worker API) ─────────────────────────────────
export function useDesactivarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/transportistas/desactivar'), {
        method: 'POST', headers,
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: async (_, id) => {
      await qc.cancelQueries({ queryKey: KEY })

      qc.setQueriesData({ queryKey: KEY, exact: false }, (viejos) => {
        const arr = Array.isArray(viejos) ? viejos : []
        return arr.filter(t => t.id !== id)
      })

      showToast.success('Transportista eliminado')
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
  })
}

export function useTransportistasCounts({ soloActivos = true } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: [...KEY, 'counts', soloActivos],
    queryFn: async () => {
      const filters = [null, true, false]
      const results = await Promise.all(filters.map(esLocal => {
        let q = supabase.from('transportistas').select('id', { count: 'exact', head: true })
        if (soloActivos) q = q.eq('activo', true)
        if (esLocal !== null) q = q.eq('es_local', esLocal)
        return q
      }))
      const failed = results.find(result => result.error)
      if (failed?.error) {
        // Durante una migración parcial es_local puede no existir todavía.
        // El conteo general sigue siendo útil y evita romper toda la vista.
        if (isMissingTransportistaColumnError(failed.error)) {
          const legacy = await supabase
            .from('transportistas')
            .select('id', { count: 'exact', head: true })
            .eq('activo', true)
          if (!legacy.error) {
            return { todos: legacy.count ?? 0, locales: 0, generales: legacy.count ?? 0, esquemaCompatibilidad: true }
          }
        }
        throw failed.error
      }
      return { todos: results[0].count ?? 0, locales: results[1].count ?? 0, generales: results[2].count ?? 0, esquemaCompatibilidad: false }
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
  })
}
