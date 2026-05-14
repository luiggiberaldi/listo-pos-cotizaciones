// src/hooks/useReporteLiquidacion.js
// Hook para el reporte de Liquidación: ventas entregadas + comisiones por asesor
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'

export function useReporteLiquidacion({ fechaInicio, fechaFin, vendedorId } = {}) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: ['reporte-liquidacion', fechaInicio, fechaFin, vendedorId, perfil?.id],
    queryFn: async () => {
      // Calcular offset de zona horaria local
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      // ── 1. Despachos entregados en el período ──────────────────────────────
      let despachoQuery = supabase
        .from('notas_despacho')
        .select(`
          id, numero, cotizacion_id, total_usd, flete_usd, descuento_total_usd, forma_pago,
          vendedor_id, cliente_id, entregada_en,
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color),
          cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre)
        `)
        .eq('estado', 'entregada')
        .gte('entregada_en', `${fechaInicio}T00:00:00${tzStr}`)
        .lte('entregada_en', `${fechaFin}T23:59:59${tzStr}`)
        .order('entregada_en', { ascending: false })

      if (vendedorId) despachoQuery = despachoQuery.eq('vendedor_id', vendedorId)

      const { data: despachos = [], error: errDespachos } = await despachoQuery
      if (errDespachos) throw errDespachos

      // ── 2. Comisiones en el período — vía Worker v2 ────────────────────────
      const comisionParams = new URLSearchParams()
      comisionParams.set('desde', fechaInicio)
      comisionParams.set('hasta', fechaFin)
      comisionParams.set('pageSize', '1000')
      if (vendedorId) comisionParams.set('vendedorId', vendedorId)
      const comHeaders = await getAuthHeaders()
      const comRes = await fetch(apiUrl(`/api/comisiones/lista?${comisionParams}`), { headers: comHeaders })
      const comJson = comRes.ok ? await comRes.json() : { data: [] }
      const comisiones = comJson?.data ?? []

      // ── 3. Items de cotizaciones para detalle por artículo ─────────────────
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        for (let i = 0; i < cotIds.length; i += 50) {
          const batch = cotIds.slice(i, i + 50)
          const { data, error } = await supabase
            .from('cotizacion_items')
            .select('producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id, comision_pct')
            .in('cotizacion_id', batch)
          if (error) throw error
          items = items.concat(data ?? [])
        }
      }

      // ── 4. Mapear comisiones por cotizacion_id para consulta rápida ─────────
      const comisionPorCot = {}
      comisiones.forEach(c => {
        comisionPorCot[c.cotizacionid] = c
      })

      // ── 5. Construir registros enriquecidos con items y comisión ─────────────
      const ventaNeta = (d) =>
        Number(d.total_usd || 0) - Number(d.flete_usd || 0) - Number(d.descuento_total_usd || 0)

      const registros = despachos.map(d => {
        const comision = comisionPorCot[d.cotizacion_id] || null
        const itemsDespachado = items.filter(it => it.cotizacion_id === d.cotizacion_id)
        return {
          ...d,
          ventaNeta: ventaNeta(d),
          comision,
          items: itemsDespachado,
        }
      })

      // ── 6. Agrupar por asesor ────────────────────────────────────────────────
      const asesorMap = {}
      registros.forEach(r => {
        const nombre = r.vendedor?.nombre ?? 'Sin asesor'
        const color  = r.vendedor?.color  ?? '#64748b'
        if (!asesorMap[nombre]) {
          asesorMap[nombre] = {
            asesor: nombre,
            color,
            vendedor_id: r.vendedor_id,
            ventas: [],
            totalVentas: 0,
            totalComisiones: 0,
            totalPagado: 0,
            totalPendiente: 0,
          }
        }
        const grupo = asesorMap[nombre]
        grupo.ventas.push(r)
        grupo.totalVentas += r.ventaNeta
        if (r.comision) {
          const monto = Number(r.comision.totalcomision || 0)
          grupo.totalComisiones += monto
          if (r.comision.estado === 'pagada')    grupo.totalPagado    += monto
          else                                   grupo.totalPendiente += monto
        }
      })

      const porAsesor = Object.values(asesorMap).sort((a, b) => b.totalVentas - a.totalVentas)
      const asesores  = porAsesor.map(g => g.asesor)

      // ── 7. KPIs globales ─────────────────────────────────────────────────────
      const totalVentas      = registros.reduce((s, r) => s + r.ventaNeta, 0)
      const totalComisiones  = comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const totalPagado      = comisiones.filter(c => c.estado === 'pagada').reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const totalPendiente   = comisiones.filter(c => c.estado === 'pendiente').reduce((s, c) => s + Number(c.totalcomision || 0), 0)

      return {
        kpis: { totalVentas, totalComisiones, totalPagado, totalPendiente },
        porAsesor,
        asesores,
        registros,
      }
    },
    enabled: !!perfil && !!fechaInicio && !!fechaFin,
    staleTime: 1000 * 60 * 5,
    gcTime:    1000 * 60 * 15,
  })
}
