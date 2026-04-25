// src/hooks/useVentaRapida.js
// Mutation para crear venta rápida (cotización + despacho atómico)
import { useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { DESPACHOS_KEY } from './useDespachos'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'
import { CXC_KEY } from './useCuentasCobrar'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'

export function useVentaRapida() {
  const qc = useQueryClient()
  const rol = useAuthStore.getState().perfil?.rol

  return useMutation({
    mutationFn: async ({
      clienteId, clienteNombre, transportistaId, fleteUsd,
      formaPago, formaPagoCliente, referenciaPago,
      notas, notasCliente, items, costoEnvioUsd, tasaBcv,
    }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/ventas-rapidas/crear'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
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
      return { ...result, clienteNombre }
    },
    onSuccess: ({ numero, clienteNombre }) => {
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
    },
  })
}
