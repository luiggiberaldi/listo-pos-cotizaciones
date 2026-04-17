// src/hooks/useDespachos.js
// Queries y mutations para notas de despacho
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { notifyDespachoCreado } from '../services/notificationService'
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
          total_usd, notas,
          creado_en, despachada_en, entregada_en,
          cliente_id, vendedor_id, transportista_id,
          cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre, rif_cedula, telefono, direccion),
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color),
          transportista:transportistas!notas_despacho_transportista_id_fkey(id, nombre, rif, telefono),
          cotizacion:cotizaciones!notas_despacho_cotizacion_id_fkey(id, numero, version)
        `)
        .order('creado_en', { ascending: false })

      if (estado) query = query.eq('estado', estado)

      // Vendedores solo ven sus propios despachos
      if (!esSupervisor) query = query.eq('vendedor_id', perfil.id)

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil,
  })
}

// ─── Crear nota de despacho (RPC) ───────────────────────────────────────────
export function useCrearDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ cotizacionId, notas = null, formaPago = null, numeroCotizacion, clienteNombre }) => {
      const { data, error } = await supabase.rpc('crear_nota_despacho', {
        p_cotizacion_id: cotizacionId,
        p_notas: notas || null,
      })
      if (error) {
        if (error.message.includes('STOCK_INSUFICIENTE'))
          throw new Error(error.message.split('STOCK_INSUFICIENTE: ')[1] || 'Stock insuficiente')
        if (error.message.includes('DESPACHO_EXISTENTE'))
          throw new Error('Ya existe una nota de despacho para esta cotización')
        if (error.message.includes('ESTADO_INVALIDO'))
          throw new Error('La cotización debe estar enviada o aceptada para despachar')
        if (error.message.includes('ACCESO_DENEGADO'))
          throw new Error('Solo supervisores pueden crear notas de despacho')
        throw error
      }
      // Guardar forma de pago si se indicó
      if (formaPago && data) {
        await supabase.from('notas_despacho').update({ forma_pago: formaPago }).eq('id', data)
      }
      return { id: data, numeroCotizacion, clienteNombre }
    },
    onSuccess: ({ numeroCotizacion, clienteNombre }) => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      showToast('Nota de despacho creada', 'success')
      notifyDespachoCreado(numeroCotizacion ?? '—', clienteNombre ?? 'cliente')
      sendPushNotification({
        title: '🚚 Orden de Despacho Creada',
        message: `Despacho para cotización #${numeroCotizacion ?? '—'} — ${clienteNombre ?? 'cliente'}`,
        tag: `despacho-${numeroCotizacion}`,
        url: '/despachos',
      })
    },
  })
}

// ─── Actualizar estado de despacho (RPC) ────────────────────────────────────
export function useActualizarEstadoDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, nuevoEstado }) => {
      const { error } = await supabase.rpc('actualizar_estado_despacho', {
        p_despacho_id: despachoId,
        p_nuevo_estado: nuevoEstado,
      })
      if (error) {
        if (error.message.includes('TRANSICION_INVALIDA'))
          throw new Error('Transición de estado no permitida')
        if (error.message.includes('ACCESO_DENEGADO'))
          throw new Error('Solo supervisores pueden actualizar despachos')
        throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
    },
  })
}

// ─── Reciclar despacho anulado → cotización borrador (RPC) ──────────────────
export function useReciclarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (despachoId) => {
      const { data, error } = await supabase.rpc('reciclar_despacho', {
        p_despacho_id: despachoId,
      })
      if (error) {
        if (error.message.includes('ESTADO_INVALIDO'))
          throw new Error('Solo se pueden reciclar despachos anulados')
        if (error.message.includes('ACCESO_DENEGADO'))
          throw new Error('Solo supervisores pueden reciclar despachos')
        throw error
      }
      return data // UUID de la nueva cotización borrador
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
    },
  })
}
