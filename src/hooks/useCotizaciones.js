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
            vendedor:usuarios!cotizaciones_vendedor_id_fkey(id, nombre, color),
            despacho:notas_despacho!notas_despacho_cotizacion_id_fkey(id, estado)
          `)
          .order('creado_en', { ascending: false })

        if (estado) query = query.eq('estado', estado)
        if (clienteId) query = query.eq('cliente_id', clienteId)

        const { data, error } = await query
        if (error) throw error
        return data ?? []
      }

      // Vendedor: filtrar explícitamente por su propio vendedor_id
      let query = supabase
        .from('v_cotizaciones_vendedor')
        .select('*')
        .eq('vendedor_id', perfil.id)
        .order('creado_en', { ascending: false })

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

      const clientesMap  = Object.fromEntries((clientesRes.data ?? []).map(c => [c.id, c]))
      const vendedoresMap = Object.fromEntries((vendedoresRes.data ?? []).map(v => [v.id, v]))

      return rows.map(r => ({
        ...r,
        cliente:  clientesMap[r.cliente_id]  ?? null,
        vendedor: vendedoresMap[r.vendedor_id] ?? null,
      }))
    },
    enabled: !!perfil,
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
      const { data: cot, error: e1 } = await supabase
        .from(tabla)
        .select('*')
        .eq('id', id)
        .single()
      if (e1) throw e1

      const { data: items, error: e2 } = await supabase
        .from('cotizacion_items')
        .select('*')
        .eq('cotizacion_id', id)
        .order('orden')
      if (e2) throw e2

      return { ...cot, items: items ?? [] }
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
        descuento_global_pct: Number(campos.descuentoGlobalPct) || 0,
        costo_envio_usd:      Number(campos.costoEnvioUsd)      || 0,
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

// ─── Enviar cotización (RPC) ──────────────────────────────────────────────────
export function useEnviarCotizacion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ cotizacionId, tasaBcv }) => {
      const { error } = await supabase.rpc('enviar_cotizacion', {
        p_cotizacion_id: cotizacionId,
        p_tasa_bcv:      Number(tasaBcv),
      })
      if (error) {
        if (error.message.includes('SIN_ITEMS'))
          throw new Error('La cotización no tiene productos')
        if (error.message.includes('ESTADO_INVALIDO'))
          throw new Error('Solo se pueden enviar cotizaciones en borrador')
        throw error
      }
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
      showToast(`Cotización #${numero} enviada`, 'success')
      notifyCotizacionEnviada(numero, clienteNombre, vendedorNombre, totalUsd)
      sendPushNotification({
        title: '🔔 Cotización pendiente de aprobación',
        message: `${vendedorNombre} envió COT-${numero} para ${clienteNombre} — $${totalUsd}. Requiere tu revisión.`,
        tag: `cotizacion-enviada-${numero}`,
        url: '/cotizaciones?estado=enviada',
      })
    },
  })
}

// ─── Anular cotización ────────────────────────────────────────────────────────
export function useAnularCotizacion() {
  const qc = useQueryClient()

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
      showToast(`Cotización #${numero} anulada`, 'warning')
      notifyCotizacionAnulada(numero)
    },
  })
}

// ─── Actualizar estado (supervisor) ──────────────────────────────────────────
export function useActualizarEstado() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, estado, numero, clienteNombre, totalUsd }) => {
      const { error } = await supabase
        .from('cotizaciones')
        .update({ estado })
        .eq('id', id)
      if (error) throw error
      return { estado, numero, clienteNombre, totalUsd }
    },
    onSuccess: ({ estado, numero, clienteNombre, totalUsd }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      if (estado === 'aceptada') {
        showToast(`Cotización #${numero} aceptada`, 'success')
        notifyCotizacionAceptada(numero, clienteNombre ?? 'cliente', totalUsd ?? 0)
        sendPushNotification({
          title: '✅ Cotización Aceptada',
          message: `Cotización #${numero} — ${clienteNombre ?? 'cliente'} — $${Number(totalUsd).toFixed(2)}`,
          tag: `cotizacion-aceptada-${numero}`,
          url: '/cotizaciones',
        })
      }
    },
  })
}

// ─── Crear nueva versión de cotización enviada (RPC) ──────────────────────────
// Llama crear_version_cotizacion(p_cotizacion_id) que:
// 1. Crea un borrador nuevo con version = anterior + 1
// 2. Copia todos los items de la versión anterior
// 3. Devuelve el ID del nuevo borrador
export function useCrearVersion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (cotizacionId) => {
      const { data, error } = await supabase.rpc('crear_version_cotizacion', {
        p_cotizacion_id: cotizacionId,
      })
      if (error) {
        if (error.message.includes('ESTADO_INVALIDO'))
          throw new Error('Solo se pueden versionar cotizaciones enviadas')
        throw error
      }
      // data es el UUID del nuevo borrador
      return data
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
