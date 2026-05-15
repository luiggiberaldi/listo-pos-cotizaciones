// src/hooks/useDespachos.js
// Queries y mutations para notas de despacho
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'
import { notifyDespachoCreado, notifyStockBajo, notifyDespachoEnRuta, notifyDespachoEntregado, notifyDespachoCancelado } from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'

export const DESPACHOS_KEY = ['despachos']

// ─── Lista de despachos ─────────────────────────────────────────────────────
export function useDespachos({ estado = '', veTodos: veTodosParam = false } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esLogistica = perfil?.rol === 'logistica'
  const esAdmin = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  // Admin siempre ve todos; logística siempre ve todos; supervisor/dev solo si toggle activo
  const veTodos = esAdmin || esLogistica || ((esSupervisor || esDesarrollador) && veTodosParam)

  return useQuery({
    queryKey: [...DESPACHOS_KEY, estado, veTodos, perfil?.id],
    queryFn: async () => {
      let query = supabase
        .from('notas_despacho')
        .select(`
          id, numero, cotizacion_id, estado,
          total_usd, flete_usd, corte_usd, descuento_total_usd, notas, forma_pago,
          referencia_pago, forma_pago_cliente,
          creado_en, actualizado_en, despachada_en, entregada_en, aprobado_por_nombre,
          cliente_id, cliente_factura_id, vendedor_id, transportista_id,
          items_count:notas_despacho_items(count),
          transportista:transportistas!notas_despacho_transportista_id_fkey(id, nombre, rif, telefono, color, vehiculo, placa_chuto, placa_batea),
          cotizacion:cotizaciones!notas_despacho_cotizacion_id_fkey(id, numero, version)
        `)
        .order('actualizado_en', { ascending: false })
        .limit(200)

      if (estado) query = query.eq('estado', estado)

      // Logística solo ve despachos aprobados (despachada/entregada), NO pendientes
      if (esLogistica && !estado) query = query.in('estado', ['despachada', 'entregada'])

      // Vendedores solo ven sus propios despachos; logística/admin/supervisor ven todos
      if (!veTodos) query = query.eq('vendedor_id', perfil.id)

      const { data, error } = await query
      if (error) throw error
      if (!data?.length) return []

      // Fetch clientes via Worker API (service key, bypasses RLS)
      const clienteIds = [...new Set([
        ...data.map(r => r.cliente_id),
        ...data.map(r => r.cliente_factura_id),
      ].filter(Boolean))]
      // Siempre cargar vendedores por separado (el join puede fallar por RLS)
      const vendedorIds = [...new Set(data.map(r => r.vendedor_id).filter(Boolean))]

      const session = (await supabase.auth.getSession()).data.session

      const [clientesData, vendedoresRes] = await Promise.all([
        clienteIds.length
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: clienteIds }),
            }).then(r => r.ok ? r.json() : [])
          : [],
        vendedorIds.length
          ? supabase.from('usuarios').select('id, nombre, color, telefono').in('id', vendedorIds)
          : { data: [] },
      ])

      const clientesMap = Object.fromEntries((clientesData ?? []).map(c => [c.id, c]))
      const vendedoresMap = Object.fromEntries((vendedoresRes.error ? [] : vendedoresRes.data ?? []).map(v => [v.id, v]))

      return data.map(r => ({
        ...r,
        cliente: clientesMap[r.cliente_id] ?? null,
        cliente_factura: clientesMap[r.cliente_factura_id] ?? null,
        vendedor: vendedoresMap[r.vendedor_id] ?? r.vendedor ?? null,
      }))
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Crear nota de despacho (via Worker API) ───────────────────────────────
export function useCrearDespacho() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ cotizacionId, notas = null, formaPago = null, transportistaId = null, fleteUsd = 0, corteUsd = 0, referenciaPago = null, formaPagoCliente = null, clienteFacturaId = null, numeroCotizacion, clienteNombre }) => {
      const res = await authFetch('/api/despachos/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotizacionId, notas: notas || null, formaPago: formaPago || null, transportistaId: transportistaId || null, fleteUsd: Number(fleteUsd) || 0, corteUsd: Number(corteUsd) || 0, referenciaPago: referenciaPago || null, formaPagoCliente: formaPagoCliente || null, clienteFacturaId: clienteFacturaId || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear despacho')

      const despachoId = result.id

      return { id: despachoId, numeroCotizacion, clienteNombre }
    },
    onSuccess: async ({ id, numeroCotizacion, clienteNombre }) => {
      if (!id) return

      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['comisiones'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] })
      showToast('Nota de despacho creada', 'success')
      notifyDespachoCreado(numeroCotizacion ?? '—', clienteNombre ?? 'cliente', usuarioNombre, rol)
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
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ despachoId, nuevoEstado, numeroCotizacion, clienteNombre, motivoDevolucion = null, motivoAnulacion = null, tasaBcv = null }) => {
      const body = { despachoId, nuevoEstado }
      if (motivoDevolucion) body.motivo_devolucion = motivoDevolucion
      if (motivoAnulacion) body.motivo_anulacion = motivoAnulacion
      if (tasaBcv && Number(tasaBcv) > 0) body.tasaBcv = Number(tasaBcv)

      const res = await authFetch('/api/despachos/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al cambiar estado del despacho')
      return { nuevoEstado, numeroCotizacion, clienteNombre }
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
          ...(nuevoEstado === 'entregada' ? { despachada_en: d.despachada_en || new Date().toISOString(), entregada_en: new Date().toISOString() } : {}),
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
    onSuccess: ({ nuevoEstado, numeroCotizacion, clienteNombre }) => {
      showToast(`Despacho marcado como ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}`, 'success')

      const num = numeroCotizacion ?? '—'
      const cliente = clienteNombre ?? 'cliente'

      if (nuevoEstado === 'despachada') {
        notifyDespachoEnRuta(num, cliente, usuarioNombre, rol)
        sendPushNotification({
          title: '🚚 Despacho en Ruta',
          message: `Despacho #${num} — ${cliente} despachado por ${usuarioNombre}`,
          tag: `despacho-ruta-${num}`,
          url: '/despachos',
          targetRole: 'vendedor',
        })
      } else if (nuevoEstado === 'entregada') {
        notifyDespachoEntregado(num, cliente, usuarioNombre, rol)
        sendPushNotification({
          title: '✅ Despacho Entregado',
          message: `Despacho #${num} — ${cliente} entregado (marcado por ${usuarioNombre})`,
          tag: `despacho-entregado-${num}`,
          url: '/despachos',
          targetRole: 'vendedor',
        })
      } else if (nuevoEstado === 'anulada') {
        notifyDespachoCancelado(num, cliente, usuarioNombre, rol)
        sendPushNotification({
          title: '❌ Despacho Cancelado',
          message: `Despacho #${num} — ${cliente} cancelado por ${usuarioNombre}`,
          tag: `despacho-cancelado-${num}`,
          url: '/despachos',
        })
      }
    },
    onSettled: () => {
      // Pequeño delay para que el Worker haya comprometido el cambio de estado
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
        qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
        qc.invalidateQueries({ queryKey: ['comisiones'], exact: false })
        qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
        qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
        qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
        qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
      }, 400)
    },
  })
}

// ─── Editar despacho pendiente (pago, transportista, notas) ─────────────────
export function useEditarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId }) => {
      const res = await authFetch('/api/despachos/editar-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar despacho')
      return result
    },
    onSuccess: async () => {
      showToast('Despacho actualizado', 'success')
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
    },
    onError: (error) => {
      showToast(error.message || 'Error al editar despacho', 'error')
    },
  })
}

// ─── Editar ítems de despacho a profundidad (administracion) ────────────────
export function useEditarItemsDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, items, pagos }) => {
      const res = await authFetch('/api/despachos/editar-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, items, pagos }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar ítems del despacho')
      return result
    },
    onSuccess: async () => {
      showToast('Ítems del despacho actualizados con éxito', 'success')
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
    },
    onError: (error) => {
      showToast(error.message || 'Error al editar ítems', 'error')
    },
  })
}

// ─── Reciclar despacho anulado → cotización borrador (via Worker API) ────────
export function useReciclarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (despachoId) => {
      const res = await authFetch('/api/despachos/reciclar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reciclar despacho')
      return result.id
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
    },
  })
}
