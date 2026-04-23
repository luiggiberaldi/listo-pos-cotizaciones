// src/hooks/useDespachos.js
// Queries y mutations para notas de despacho
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'
import { REPORTE_KEY } from './useReporteVentas'
import { CXC_KEY } from './useCuentasCobrar'
import { notifyDespachoCreado, notifyStockBajo } from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'

export const DESPACHOS_KEY = ['despachos']

// ─── Lista de despachos ─────────────────────────────────────────────────────
export function useDespachos({ estado = '' } = {}) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...DESPACHOS_KEY, estado, esSupervisor, perfil?.id],
    queryFn: async () => {
      let query = supabase
        .from('notas_despacho')
        .select(`
          id, numero, cotizacion_id, estado,
          total_usd, notas, forma_pago,
          creado_en, despachada_en, entregada_en,
          cliente_id, vendedor_id, transportista_id,
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color, telefono),
          transportista:transportistas!notas_despacho_transportista_id_fkey(id, nombre, rif, telefono),
          cotizacion:cotizaciones!notas_despacho_cotizacion_id_fkey(id, numero, version)
        `)
        .order('creado_en', { ascending: false })
        .limit(200)

      if (estado) query = query.eq('estado', estado)

      // Vendedores solo ven sus propios despachos
      if (!esSupervisor) query = query.eq('vendedor_id', perfil.id)

      const { data, error } = await query
      if (error) throw error
      if (!data?.length) return []

      // Fetch clientes via Worker API (service key, bypasses RLS)
      const clienteIds = [...new Set(data.map(r => r.cliente_id).filter(Boolean))]
      if (clienteIds.length) {
        const session = (await supabase.auth.getSession()).data.session
        try {
          const res = await fetch(apiUrl('/api/clientes/lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ ids: clienteIds }),
          })
          if (res.ok) {
            const clientesData = await res.json()
            const clientesMap = Object.fromEntries((clientesData ?? []).map(c => [c.id, c]))
            return data.map(r => ({ ...r, cliente: clientesMap[r.cliente_id] ?? null }))
          }
        } catch { /* fallback: return without client data */ }
      }
      return data
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Crear nota de despacho (via Worker API) ───────────────────────────────
export function useCrearDespacho() {
  const qc = useQueryClient()
  const rol = useAuthStore.getState().perfil?.rol

  return useMutation({
    mutationFn: async ({ cotizacionId, notas = null, formaPago = null, numeroCotizacion, clienteNombre }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/despachos/crear'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cotizacionId, notas: notas || null, formaPago: formaPago || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear despacho')

      const despachoId = result.id

      // Registrar egresos en el kardex (inventario_movimientos)
      if (despachoId) {
        try {
          const itemsRes = await supabase
            .from('cotizacion_items')
            .select('producto_id, cantidad, nombre_snap')
            .eq('cotizacion_id', cotizacionId)
            .not('producto_id', 'is', null)

          const items = itemsRes.data ?? []
          if (items.length > 0) {
            const productoIds = items.map(i => i.producto_id)
            const { data: productos } = await supabase
              .from('productos')
              .select('id, stock_actual, stock_minimo, nombre, unidad')
              .in('id', productoIds)

            const stockMap = {}
            for (const p of (productos ?? [])) stockMap[p.id] = Number(p.stock_actual)

            const perfil = useAuthStore.getState().perfil
            const loteId = crypto.randomUUID()

            const kardexEntries = items.map(item => ({
              lote_id: loteId,
              tipo: 'egreso',
              motivo: `Nota de despacho #${numeroCotizacion}`,
              motivo_tipo: 'otro',
              producto_id: item.producto_id,
              producto_nombre: item.nombre_snap,
              cantidad: Number(item.cantidad),
              stock_anterior: (stockMap[item.producto_id] ?? 0) + Number(item.cantidad),
              stock_nuevo: stockMap[item.producto_id] ?? 0,
              usuario_id: perfil?.id,
              usuario_nombre: perfil?.nombre ?? 'Supervisor',
              usuario_color: perfil?.color ?? null,
            }))

            const { error: kardexError } = await supabase
              .from('inventario_movimientos')
              .insert(kardexEntries)

            if (kardexError) {
              console.error('[Kardex] Error registrando egresos de despacho:', kardexError)
            }

            // Notificar productos que quedaron en stock bajo
            const bajos = (productos ?? []).filter(p =>
              p.stock_actual <= 0 || (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo)
            )
            if (bajos.length > 0) notifyStockBajo(bajos, rol)
          }
        } catch (kardexErr) {
          console.error('[Kardex] Error inesperado:', kardexErr)
        }
      }

      return { id: despachoId, numeroCotizacion, clienteNombre }
    },
    onSuccess: ({ numeroCotizacion, clienteNombre }) => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      qc.invalidateQueries({ queryKey: CXC_KEY })
      showToast('Nota de despacho creada', 'success')
      notifyDespachoCreado(numeroCotizacion ?? '—', clienteNombre ?? 'cliente', rol)
      sendPushNotification({
        title: '🚚 Orden de Despacho Creada',
        message: `Despacho para cotización #${numeroCotizacion ?? '—'} — ${clienteNombre ?? 'cliente'}`,
        tag: `despacho-${numeroCotizacion}`,
        url: '/despachos',
        targetRole: 'supervisor',
      })
    },
  })
}

// ─── Actualizar estado de despacho (via Worker API) ────────────────────────
const ESTADO_LABELS = { pendiente: 'Pendiente', despachada: 'Despachada', entregada: 'Entregada', anulada: 'Anulada' }

export function useActualizarEstadoDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, nuevoEstado }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/despachos/estado'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ despachoId, nuevoEstado }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al cambiar estado del despacho')
      return { nuevoEstado }
    },
    // Optimistic update: reflect state change immediately in UI
    onMutate: async ({ despachoId, nuevoEstado }) => {
      await qc.cancelQueries({ queryKey: DESPACHOS_KEY })
      const previousQueries = qc.getQueriesData({ queryKey: DESPACHOS_KEY })
      qc.setQueriesData({ queryKey: DESPACHOS_KEY }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map(d => d.id === despachoId ? {
          ...d,
          estado: nuevoEstado,
          ...(nuevoEstado === 'despachada' ? { despachada_en: new Date().toISOString() } : {}),
          ...(nuevoEstado === 'entregada' ? { entregada_en: new Date().toISOString() } : {}),
        } : d)
      })
      return { previousQueries }
    },
    onError: (error, _vars, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([key, data]) => qc.setQueryData(key, data))
      }
      showToast(error.message || 'Error al cambiar estado del despacho', 'error')
    },
    onSuccess: ({ nuevoEstado }) => {
      showToast(`Despacho marcado como ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}`, 'success')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      qc.invalidateQueries({ queryKey: REPORTE_KEY })
    },
  })
}

// ─── Reciclar despacho anulado → cotización borrador (via Worker API) ────────
export function useReciclarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (despachoId) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/despachos/reciclar'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ despachoId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reciclar despacho')
      return result.id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
    },
  })
}
