// src/hooks/useReporteDespachos.js
// Hook para datos del reporte de despachos y cobranza
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_DESPACHOS_KEY = ['reporte-despachos']

export function useReporteDespachos({ from, to }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...REPORTE_DESPACHOS_KEY, from, to, esSupervisor, perfil?.id],
    queryFn: async () => {
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      let q = supabase
        .from('notas_despacho')
        .select(`
          id, numero, cotizacion_id, total_usd, forma_pago, estado,
          creado_en, despachada_en, entregada_en,
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color),
          cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre)
        `)
        .gte('creado_en', `${from}T00:00:00${tzStr}`)
        .lte('creado_en', `${to}T23:59:59${tzStr}`)
        .order('creado_en', { ascending: false })

      if (!esSupervisor) q = q.eq('vendedor_id', perfil.id)

      const { data: despachos, error } = await q
      if (error) throw error
      const lista = despachos || []

      // Por estado
      const estadosList = ['pendiente', 'despachada', 'entregada', 'anulada']
      const porEstado = estadosList.map(e => ({
        estado: e,
        count: lista.filter(d => d.estado === e).length,
        totalUsd: lista.filter(d => d.estado === e).reduce((s, d) => s + Number(d.total_usd || 0), 0),
      }))

      // KPIs
      const totalDespachos = lista.filter(d => d.estado !== 'anulada').length
      const entregados = lista.filter(d => d.estado === 'entregada')
      const pendientes = lista.filter(d => d.estado === 'pendiente' || d.estado === 'despachada')
      const montoEntregado = entregados.reduce((s, d) => s + Number(d.total_usd || 0), 0)
      const montoPendiente = pendientes.reduce((s, d) => s + Number(d.total_usd || 0), 0)

      // Por forma de pago
      const fpMap = {}
      lista.filter(d => d.estado !== 'anulada').forEach(d => {
        const fp = d.forma_pago || 'Sin especificar'
        if (!fpMap[fp]) fpMap[fp] = { formaPago: fp, count: 0, totalUsd: 0 }
        fpMap[fp].count++
        fpMap[fp].totalUsd += Number(d.total_usd || 0)
      })
      const porFormaPago = Object.values(fpMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Aging de pendientes
      const ahora = Date.now()
      const agingData = [
        { rango: '0-7 días', min: 0, max: 7, count: 0, totalUsd: 0 },
        { rango: '8-15 días', min: 8, max: 15, count: 0, totalUsd: 0 },
        { rango: '16-30 días', min: 16, max: 30, count: 0, totalUsd: 0 },
        { rango: '30+ días', min: 31, max: 9999, count: 0, totalUsd: 0 },
      ]
      pendientes.forEach(d => {
        const dias = Math.floor((ahora - new Date(d.creado_en).getTime()) / (1000 * 60 * 60 * 24))
        const bucket = agingData.find(a => dias >= a.min && dias <= a.max)
        if (bucket) {
          bucket.count++
          bucket.totalUsd += Number(d.total_usd || 0)
        }
      })

      // Por vendedor
      const vendedorMap = {}
      lista.filter(d => d.estado !== 'anulada').forEach(d => {
        const vid = d.vendedor?.id
        if (!vid) return
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            nombre: d.vendedor.nombre,
            color: d.vendedor.color,
            despachos: 0,
            entregados: 0,
            pendientes: 0,
            totalUsd: 0,
            montoPendiente: 0,
          }
        }
        const v = vendedorMap[vid]
        v.despachos++
        v.totalUsd += Number(d.total_usd || 0)
        if (d.estado === 'entregada') v.entregados++
        if (d.estado === 'pendiente' || d.estado === 'despachada') {
          v.pendientes++
          v.montoPendiente += Number(d.total_usd || 0)
        }
      })
      const porVendedor = Object.values(vendedorMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Top 10 clientes con monto pendiente
      const clienteMap = {}
      pendientes.forEach(d => {
        const cid = d.cliente?.id
        if (!cid) return
        if (!clienteMap[cid]) {
          clienteMap[cid] = { nombre: d.cliente.nombre, count: 0, totalUsd: 0 }
        }
        clienteMap[cid].count++
        clienteMap[cid].totalUsd += Number(d.total_usd || 0)
      })
      const topClientesPendientes = Object.values(clienteMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 10)

      return {
        kpis: {
          totalDespachos,
          numEntregados: entregados.length,
          numPendientes: pendientes.length,
          montoEntregado,
          montoPendiente,
        },
        porEstado,
        porFormaPago,
        aging: agingData,
        porVendedor,
        topClientesPendientes,
      }
    },
    enabled: !!perfil && !!from && !!to,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
