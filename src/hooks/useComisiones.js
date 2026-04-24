// src/hooks/useComisiones.js
// Queries y mutations para el sistema de comisiones
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { showToast } from '../components/ui/Toast'

export const COMISIONES_KEY = ['comisiones']

// ─── Lista de comisiones ────────────────────────────────────────────────────
export function useComisiones({ estado = '', vendedorId = '' } = {}) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = perfil?.rol === 'supervisor' || perfil?.rol === 'administracion'

  return useQuery({
    queryKey: [...COMISIONES_KEY, estado, vendedorId, esPrivilegiado, perfil?.id],
    queryFn: async () => {
      let query = supabase
        .from('comisiones')
        .select(`
          id, despacho_id, vendedor_id, cotizacion_id,
          monto_cabilla, monto_otros,
          pct_cabilla, pct_otros,
          comision_cabilla, comision_otros, total_comision,
          detalle_extras,
          estado, pagada_en, pagada_por,
          creado_en,
          vendedor:usuarios!comisiones_vendedor_id_fkey(id, nombre, color),
          despacho:notas_despacho!comisiones_despacho_id_fkey(id, numero),
          cotizacion:cotizaciones!comisiones_cotizacion_id_fkey(id, numero)
        `)
        .order('creado_en', { ascending: false })
        .limit(500)

      if (estado) query = query.eq('estado', estado)
      if (!esPrivilegiado) query = query.eq('vendedor_id', perfil.id)
      else if (vendedorId) query = query.eq('vendedor_id', vendedorId)

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Resumen de comisiones ──────────────────────────────────────────────────
export function useComisionesResumen() {
  const { perfil } = useAuthStore()
  const esPrivilegiado = perfil?.rol === 'supervisor' || perfil?.rol === 'administracion'

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'resumen', esPrivilegiado, perfil?.id],
    queryFn: async () => {
      let query = supabase
        .from('comisiones')
        .select('total_comision, estado')
        .limit(1000)

      // Vendedores solo ven sus propias comisiones
      if (!esPrivilegiado) query = query.eq('vendedor_id', perfil.id)

      const { data, error } = await query
      if (error) throw error

      const items = data ?? []
      const pendiente = items
        .filter(c => c.estado === 'pendiente')
        .reduce((s, c) => s + Number(c.total_comision || 0), 0)
      const pagado = items
        .filter(c => c.estado === 'pagada')
        .reduce((s, c) => s + Number(c.total_comision || 0), 0)

      return {
        pendiente,
        pagado,
        total: pendiente + pagado,
        countPendiente: items.filter(c => c.estado === 'pendiente').length,
        countPagado: items.filter(c => c.estado === 'pagada').length,
      }
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Marcar comisión como pagada (via Worker API) ──────────────────────────
export function useMarcarComisionPagada() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (comisionId) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/comisiones/pagar'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comisionId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al marcar comisión como pagada')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
      showToast('Comisión marcada como pagada', 'success')
    },
  })
}
