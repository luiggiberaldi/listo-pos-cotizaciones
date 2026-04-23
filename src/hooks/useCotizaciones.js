// src/hooks/useCotizaciones.js
// Queries y mutations para cotizaciones + items
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { apiUrl } from '../services/apiBase'
import { calcTotales } from '../utils/calcTotales'
import { round2 } from '../utils/dinero'
import {
  notifyCotizacionEnviada,
  notifyCotizacionAceptada,
  notifyCotizacionAnulada,
} from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'

export const COTIZACIONES_KEY = ['cotizaciones']

// ─── Lista de cotizaciones ────────────────────────────────────────────────────
export function useCotizaciones({ estado = '', clienteId = '' } = {}) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...COTIZACIONES_KEY, estado, clienteId, esSupervisor],
    queryFn: async () => {
      if (esSupervisor) {
        // Supervisor: tabla directa con joins por FK
        let query = supabase
          .from('cotizaciones')
          .select(`
            id, numero, version, estado,
            subtotal_usd, descuento_global_pct, descuento_usd,
            costo_envio_usd, total_usd,
            tasa_bcv_snapshot, total_bs_snapshot,
            valida_hasta, creado_en, enviada_en,
            notas_cliente,
            cliente_id, vendedor_id,
            cliente:clientes!cotizaciones_cliente_id_fkey(id, nombre, rif_cedula, telefono, tipo_cliente, direccion),
            vendedor:usuarios!cotizaciones_vendedor_id_fkey(id, nombre, color, telefono),
            despacho:notas_despacho!notas_despacho_cotizacion_id_fkey(id, estado)
          `)
          .order('creado_en', { ascending: false })
          .limit(200)

        if (estado) query = query.eq('estado', estado)
        if (clienteId) query = query.eq('cliente_id', clienteId)

        const { data, error } = await query
        if (error) throw error
        return data ?? []
      }

      // Vendedor: filtrar explícitamente por su propio vendedor_id
      let query = supabase
        .from('v_cotizaciones_vendedor')
        .select('id, numero, version, cliente_id, vendedor_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, valida_hasta, notas_cliente, creado_en, enviada_en')
        .eq('vendedor_id', perfil.id)
        .order('creado_en', { ascending: false })
        .limit(200)

      if (estado) query = query.eq('estado', estado)
      if (clienteId) query = query.eq('cliente_id', clienteId)

      const { data: rows, error } = await query
      if (error) throw error
      if (!rows?.length) return []

      // Fetch related clients and vendors in batch
      const clienteIds  = [...new Set(rows.map(r => r.cliente_id).filter(Boolean))]
      const vendedorIds = [...new Set(rows.map(r => r.vendedor_id).filter(Boolean))]

      const [clientesRes, vendedoresRes] = await Promise.all([
        clienteIds.length
          ? supabase.from('clientes').select('id, nombre, rif_cedula, telefono, tipo_cliente').in('id', clienteIds)
          : { data: [] },
        vendedorIds.length
          ? supabase.from('usuarios').select('id, nombre, color').in('id', vendedorIds)
          : { data: [] },
      ])

      const clientesMap  = Object.fromEntries((clientesRes.error ? [] : clientesRes.data ?? []).map(c => [c.id, c]))
      const vendedoresMap = Object.fromEntries((vendedoresRes.error ? [] : vendedoresRes.data ?? []).map(v => [v.id, v]))

      return rows.map(r => ({
        ...r,
        cliente:  clientesMap[r.cliente_id]  ?? null,
        vendedor: vendedoresMap[r.vendedor_id] ?? null,
      }))
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Cotización individual con items ─────────────────────────────────────────
export function useCotizacion(id) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...COTIZACIONES_KEY, id],
    queryFn: async () => {
      const tabla = esSupervisor ? 'cotizaciones' : 'v_cotizaciones_vendedor'

      // Supervisor: join directo; Vendedor: fetch plano + lookup aparte
      const selectFields = esSupervisor
        ? 'id, numero, version, cotizacion_raiz_id, cliente_id, vendedor_id, transportista_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, valida_hasta, notas_cliente, creado_en, actualizado_en, enviada_en, exportada_en, cliente:clientes!cotizaciones_cliente_id_fkey(id, nombre, rif_cedula, telefono, tipo_cliente, direccion), vendedor:usuarios!cotizaciones_vendedor_id_fkey(id, nombre, color, telefono)'
        : 'id, numero, version, cotizacion_raiz_id, cliente_id, vendedor_id, transportista_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, valida_hasta, notas_cliente, creado_en, actualizado_en, enviada_en, exportada_en'

      const [cotRes, itemsRes] = await Promise.all([
        supabase
          .from(tabla)
          .select(selectFields)
          .eq('id', id)
          .single(),
        supabase
          .from('cotizacion_items')
          .select('producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden')
          .eq('cotizacion_id', id)
          .order('orden'),
      ])
      if (cotRes.error) throw cotRes.error
      if (itemsRes.error) throw itemsRes.error

      let cot = cotRes.data

      // Para vendedores (vista), hacer lookup de cliente y vendedor aparte
      if (!esSupervisor) {
        const [cliRes, vendRes] = await Promise.all([
          cot.cliente_id
            ? supabase.from('clientes').select('id, nombre, rif_cedula, telefono, tipo_cliente, direccion').eq('id', cot.cliente_id).single()
            : { data: null },
          cot.vendedor_id
            ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', cot.vendedor_id).single()
            : { data: null },
        ])
        cot = { ...cot, cliente: cliRes.data ?? null, vendedor: vendRes.data ?? null }
      }

      return { ...cot, items: itemsRes.data ?? [] }
    },
    enabled: !!id && !!perfil,
  })
}

// ─── Guardar borrador (crear o actualizar) ────────────────────────────────────
// Si cotizacionId es null → crea nueva. Si tiene ID → actualiza.
export function useGuardarBorrador() {
  const qc = useQueryClient()
  const { perfil } = useAuthStore()

  return useMutation({
    mutationFn: async ({ cotizacionId = null, campos, items }) => {
      // Calcular totales
      const { subtotal, descuentoUsd, ivaUsd, totalUsd } = calcTotales(
        items, campos.descuentoGlobalPct, campos.costoEnvioUsd, campos.ivaPct
      )

      const headerData = {
        cliente_id:           campos.clienteId,
        transportista_id:     campos.transportistaId || null,
        vendedor_id:          campos.vendedorId || perfil.id,
        valida_hasta:         campos.validaHasta    || null,
        notas_cliente:        campos.notasCliente?.trim()  || null,
        notas_internas:       campos.notasInternas?.trim() || null,
        descuento_global_pct: round2(Number(campos.descuentoGlobalPct) || 0),
        costo_envio_usd:      round2(Number(campos.costoEnvioUsd)      || 0),
        subtotal_usd:         subtotal,
        descuento_usd:        descuentoUsd,
        total_usd:            totalUsd,
      }

      const itemRows = items.map((it, idx) => ({
        producto_id:     it.productoId || null,
        codigo_snap:     it.codigoSnap || null,
        nombre_snap:     it.nombreSnap,
        unidad_snap:     it.unidadSnap  || 'und',
        cantidad:        it.cantidad,
        precio_unit_usd: it.precioUnitUsd,
        descuento_pct:   it.descuentoPct,
        total_linea_usd: round2(it.cantidad * it.precioUnitUsd * (1 - it.descuentoPct / 100)),
        orden:           idx,
      }))

      // Route through worker API (bypasses RLS for cross-vendor clients)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(apiUrl('/api/cotizaciones/guardar'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ cotizacionId, headerData, items: itemRows }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al guardar cotización')
      }

      const { id } = await res.json()
      return id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: COTIZACIONES_KEY }),
  })
}

// ─── Enviar cotización (via Worker API) ──────────────────────────────────────
export function useEnviarCotizacion() {
  const qc = useQueryClient()
  const rol = useAuthStore.getState().perfil?.rol

  return useMutation({
    mutationFn: async ({ cotizacionId, tasaBcv }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/cotizaciones/enviar'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cotizacionId, tasaBcv: Number(tasaBcv) }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al enviar cotización')

      // Obtener número, cliente, vendedor y total para notificación
      const { data: cot } = await supabase
        .from('cotizaciones')
        .select('numero, version, total_usd, cliente:clientes!cotizaciones_cliente_id_fkey(nombre), vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombre)')
        .eq('id', cotizacionId)
        .single()
      const numero        = cot?.numero ? String(cot.numero).padStart(5, '0') : '—'
      const clienteNombre = cot?.cliente?.nombre ?? 'cliente'
      const vendedorNombre = cot?.vendedor?.nombre ?? 'vendedor'
      const totalUsd      = Number(cot?.total_usd || 0).toFixed(2)
      return { numero, clienteNombre, vendedorNombre, totalUsd }
    },
    onSuccess: ({ numero, clienteNombre, vendedorNombre, totalUsd }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      showToast(`Cotización #${numero} enviada`, 'success')
      notifyCotizacionEnviada(numero, clienteNombre, vendedorNombre, totalUsd, rol)
      sendPushNotification({
        title: '🔔 Cotización pendiente de aprobación',
        message: `${vendedorNombre} envió COT-${numero} para ${clienteNombre} — $${totalUsd}. Requiere tu revisión.`,
        tag: `cotizacion-enviada-${numero}`,
        url: '/cotizaciones?estado=enviada',
        targetRole: 'supervisor',
      })
    },
  })
}

// ─── Anular cotización ────────────────────────────────────────────────────────
export function useAnularCotizacion() {
  const qc = useQueryClient()
  const rol = useAuthStore.getState().perfil?.rol

  return useMutation({
    mutationFn: async ({ id, numero }) => {
      const { error } = await supabase
        .from('cotizaciones')
        .update({ estado: 'anulada' })
        .eq('id', id)
      if (error) throw error
      return { numero }
    },
    onSuccess: ({ numero }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      showToast(`Cotización #${numero} anulada`, 'warning')
      notifyCotizacionAnulada(numero, rol)
    },
  })
}

// ─── Actualizar estado (supervisor) ──────────────────────────────────────────
export function useActualizarEstado() {
  const qc = useQueryClient()
  const rol = useAuthStore.getState().perfil?.rol

  return useMutation({
    mutationFn: async ({ id, estado, numero, clienteNombre, totalUsd, vendedorId }) => {
      const { error } = await supabase
        .from('cotizaciones')
        .update({ estado })
        .eq('id', id)
      if (error) throw error
      return { estado, numero, clienteNombre, totalUsd, vendedorId }
    },
    onSuccess: ({ estado, numero, clienteNombre, totalUsd, vendedorId }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      if (estado === 'aceptada') {
        showToast(`Cotización #${numero} aceptada`, 'success')
        notifyCotizacionAceptada(numero, clienteNombre ?? 'cliente', totalUsd ?? 0, rol)
        sendPushNotification({
          title: '✅ Cotización Aceptada',
          message: `Cotización #${numero} — ${clienteNombre ?? 'cliente'} — $${Number(totalUsd).toFixed(2)}`,
          tag: `cotizacion-aceptada-${numero}`,
          url: '/cotizaciones',
          targetUserId: vendedorId,
        })
      }
    },
  })
}

// ─── Crear nueva versión de cotización enviada (via Worker API) ────────────────
// 1. Crea un borrador nuevo con version = anterior + 1
// 2. Copia todos los items de la versión anterior
// 3. Devuelve el ID del nuevo borrador
export function useCrearVersion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (cotizacionId) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/cotizaciones/crear-version'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cotizacionId }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear versión')

      return result.id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: COTIZACIONES_KEY }),
  })
}

// ─── Reciclar cotización (supervisor: rechazada/anulada/vencida → borrador) ──
export function useReciclarCotizacion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ cotizacionId, vendedorDestinoId }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/cotizaciones/reciclar'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cotizacionId, vendedorDestinoId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al reciclar cotización')
      }
      return await res.json()
    },
    onSuccess: ({ numero, vendedorDestino }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      const numPad = String(numero).padStart(5, '0')
      showToast(`Cotización reciclada → COT-${numPad} asignada a ${vendedorDestino}`, 'success')
    },
  })
}
