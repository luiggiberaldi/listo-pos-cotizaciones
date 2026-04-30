// src/hooks/useVentaRapida.js
// Mutation para crear venta rápida (cotización + despacho atómico)
import { useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { DESPACHOS_KEY } from './useDespachos'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'
import { CXC_KEY } from './useCuentasCobrar'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'
import { notifyClienteAjeno } from '../services/notificationService'

export function useVentaRapida() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol

  return useMutation({
    mutationFn: async ({
      clienteId, clienteNombre, transportistaId, fleteUsd,
      formaPago, formaPagoCliente, referenciaPago,
      notas, notasCliente, items, costoEnvioUsd, tasaBcv,
    }) => {
      const headers = await getAuthHeaders()

      const res = await fetch(apiUrl('/api/ventas-rapidas/crear'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clienteId, transportistaId: transportistaId || null,
          fleteUsd: Number(fleteUsd) || 0,
          formaPago, formaPagoCliente: formaPagoCliente || null,
          referenciaPago: referenciaPago || null,
          notas: notas || null, notasCliente: notasCliente || null,
          items, descuentoGlobalPct: 0,
          costoEnvioUsd: Number(costoEnvioUsd) || 0,
          tasaBcv,
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear venta rápida')

      // Verificar si el cliente es ajeno
      let esClienteAjeno = false
      let clienteVendedorNombre = null
      if (clienteId) {
        try {
          const session = (await supabase.auth.getSession()).data.session
          const cRes = await fetch(apiUrl('/api/clientes/lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ ids: [clienteId] }),
          })
          if (cRes.ok) {
            const cData = await cRes.json()
            const clienteVendedorId = cData?.[0]?.vendedor_id
            clienteVendedorNombre = cData?.[0]?.vendedor?.nombre || null
            esClienteAjeno = clienteVendedorId && perfil?.id && clienteVendedorId !== perfil.id
          }
        } catch { /* ignore */ }
      }

      return { ...result, clienteNombre, esClienteAjeno, clienteVendedorNombre }
    },
    onSuccess: ({ numero, clienteNombre, esClienteAjeno, clienteVendedorNombre }) => {
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      qc.invalidateQueries({ queryKey: CXC_KEY })
      showToast(`Venta rápida #${numero ?? '—'} creada`, 'success')
      sendPushNotification({
        title: 'Venta Rápida Creada',
        message: `Despacho #${numero ?? '—'} — ${clienteNombre ?? 'cliente'}`,
        tag: `venta-rapida-${numero}`,
        url: '/despachos',
        targetRole: 'supervisor',
      })
      if (esClienteAjeno) {
        const vendedorNombre = perfil?.nombre || 'vendedor'
        notifyClienteAjeno({ tipo: 'venta_rapida', numero: String(numero).padStart(5, '0'), vendedorNombre, clienteNombre, vendedorDueño: clienteVendedorNombre || 'otro vendedor', currentRole: rol })
        sendPushNotification({
          title: 'Venta rápida con cliente ajeno',
          message: `${vendedorNombre} vendió a "${clienteNombre}" (de ${clienteVendedorNombre || 'otro vendedor'}) — VR-${numero}`,
          tag: `cliente-ajeno-vr-${numero}`,
          url: '/despachos',
          targetRole: 'supervisor',
        })
      }
    },
    onError: (err) => {
      showToast(err.message || 'Error al crear venta rápida', 'error')
    },
  })
}
