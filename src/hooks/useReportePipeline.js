// src/hooks/useReportePipeline.js
// Hook para datos del reporte de pipeline de cotizaciones
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_PIPELINE_KEY = ['reporte-pipeline']

export function useReportePipeline({ from, to }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...REPORTE_PIPELINE_KEY, from, to, esSupervisor, perfil?.id],
    queryFn: async () => {
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      // Cotizaciones en el rango (todas, no solo la versión más reciente)
      let q = supabase
        .from('cotizaciones')
        .select(`
          id, numero, version, estado, total_usd, subtotal_usd,
          creado_en, enviada_en, valida_hasta,
          vendedor:usuarios!cotizaciones_vendedor_id_fkey(id, nombre, color),
          cliente:clientes!cotizaciones_cliente_id_fkey(id, nombre)
        `)
        .gte('creado_en', `${from}T00:00:00${tzStr}`)
        .lte('creado_en', `${to}T23:59:59${tzStr}`)
        .order('creado_en', { ascending: false })

      if (!esSupervisor) q = q.eq('vendedor_id', perfil.id)

      const { data: cotizaciones, error } = await q
      if (error) throw error
      const cots = cotizaciones || []

      // Agregar: por estado
      const estados = ['borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'anulada']
      const porEstado = estados.map(e => ({
        estado: e,
        count: cots.filter(c => c.estado === e).length,
        totalUsd: cots.filter(c => c.estado === e).reduce((s, c) => s + Number(c.total_usd || 0), 0),
      }))

      // Tasa de conversión
      const enviadas = cots.filter(c => c.estado === 'enviada').length
      const aceptadas = cots.filter(c => c.estado === 'aceptada').length
      const rechazadas = cots.filter(c => c.estado === 'rechazada').length
      const base = enviadas + aceptadas + rechazadas
      const tasaConversion = base > 0 ? (aceptadas / base) * 100 : 0

      // Valor pipeline pendiente (borrador + enviada)
      const valorPipeline = cots
        .filter(c => c.estado === 'borrador' || c.estado === 'enviada')
        .reduce((s, c) => s + Number(c.total_usd || 0), 0)

      // Aging de cotizaciones enviadas
      const ahora = Date.now()
      const enviadasList = cots.filter(c => c.estado === 'enviada')
      const aging = [
        { rango: '0-7 días', min: 0, max: 7, count: 0, totalUsd: 0 },
        { rango: '8-15 días', min: 8, max: 15, count: 0, totalUsd: 0 },
        { rango: '16-30 días', min: 16, max: 30, count: 0, totalUsd: 0 },
        { rango: '30+ días', min: 31, max: 9999, count: 0, totalUsd: 0 },
      ]
      enviadasList.forEach(c => {
        const dias = Math.floor((ahora - new Date(c.enviada_en || c.creado_en).getTime()) / (1000 * 60 * 60 * 24))
        const bucket = aging.find(a => dias >= a.min && dias <= a.max)
        if (bucket) {
          bucket.count++
          bucket.totalUsd += Number(c.total_usd || 0)
        }
      })

      // Por vendedor
      const vendedorMap = {}
      cots.forEach(c => {
        const vid = c.vendedor?.id
        if (!vid) return
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            nombre: c.vendedor.nombre,
            color: c.vendedor.color,
            borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, vencida: 0, anulada: 0,
            totalUsd: 0,
          }
        }
        vendedorMap[vid][c.estado]++
        vendedorMap[vid].totalUsd += Number(c.total_usd || 0)
      })
      const porVendedor = Object.values(vendedorMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Top 10 cotizaciones enviadas más antiguas sin respuesta
      const topPendientes = enviadasList
        .sort((a, b) => new Date(a.enviada_en || a.creado_en) - new Date(b.enviada_en || b.creado_en))
        .slice(0, 10)
        .map(c => ({
          numero: c.numero,
          version: c.version,
          cliente: c.cliente?.nombre || '—',
          vendedor: c.vendedor?.nombre || '—',
          vendedorColor: c.vendedor?.color,
          totalUsd: Number(c.total_usd || 0),
          enviada: c.enviada_en || c.creado_en,
          dias: Math.floor((ahora - new Date(c.enviada_en || c.creado_en).getTime()) / (1000 * 60 * 60 * 24)),
        }))

      return {
        kpis: {
          totalCotizaciones: cots.length,
          valorPipeline,
          tasaConversion,
          enviadasPendientes: enviadasList.length,
        },
        porEstado,
        aging,
        porVendedor,
        topPendientes,
      }
    },
    enabled: !!perfil && !!from && !!to,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
