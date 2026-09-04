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
          vendedor_id, cliente_id, creado_en, despachada_en, entregada_en, entregada_en_ajustada,
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color, rol),
          cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre)
        `)
        .eq('estado', 'entregada')
        .limit(5000)

      if (vendedorId) despachoQuery = despachoQuery.eq('vendedor_id', vendedorId)

      const { data: rawDespachos = [], error: errDespachos } = await despachoQuery
      if (errDespachos) throw errDespachos

      const inicioPeriodo = new Date(`${fechaInicio}T00:00:00${tzStr}`).getTime()
      const finPeriodo = new Date(`${fechaFin}T23:59:59.999${tzStr}`).getTime()
      const despachos = rawDespachos
        .filter(d => {
          const fechaEfectiva = new Date(d.entregada_en_ajustada || d.entregada_en || d.despachada_en || d.creado_en || '').getTime()
          return Number.isFinite(fechaEfectiva) && fechaEfectiva >= inicioPeriodo && fechaEfectiva <= finPeriodo
        })
        .map(d => ({
          ...d,
          entregada_en_original: d.entregada_en,
          entregada_en: d.entregada_en_ajustada || d.entregada_en || d.despachada_en || d.creado_en,
        }))
        .sort((a, b) => new Date(b.entregada_en).getTime() - new Date(a.entregada_en).getTime())
        .filter(d => {
        const rol = d.vendedor?.rol
        return rol !== 'desarrollador' && rol !== 'administracion' && rol !== 'logistica'
      })

      // ── 2. Comisiones en el período — vía Worker v2 ────────────────────────
      const comisionParams = new URLSearchParams()
      comisionParams.set('desde', fechaInicio)
      comisionParams.set('hasta', fechaFin)
      comisionParams.set('pageSize', '1000')
      if (vendedorId) comisionParams.set('vendedorId', vendedorId)
      const comHeaders = await getAuthHeaders()
      const comRes = await fetch(apiUrl(`/api/comisiones/lista?${comisionParams}`), { headers: comHeaders })
      const comJson = comRes.ok ? await comRes.json() : { data: [] }
      const comisiones = (comJson?.data ?? []).filter(c => {
        const rol = c.vendedor?.rol
        return rol !== 'desarrollador' && rol !== 'administracion' && rol !== 'logistica'
      })

      // ── 3. Items de cotizaciones para detalle por artículo ─────────────────
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        // Lotes de 50 en paralelo (antes: await secuencial por lote)
        const batches = []
        for (let i = 0; i < cotIds.length; i += 50) batches.push(cotIds.slice(i, i + 50))
        const results = await Promise.all(batches.map(batch =>
          supabase
            .from('cotizacion_items')
            .select('producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id, comision_pct')
            .in('cotizacion_id', batch)
        ))
        for (const { data, error } of results) {
          if (error) throw error
          items = items.concat(data ?? [])
        }
      }

      // ── 4. Mapear comisiones por cotizacion_id para consulta rápida ─────────
      // Split por cliente ajeno (sábados): un despacho puede tener 2 filas de
      // comisión (vendedor que vendió + dueño del cliente). Guardamos todas.
      const comisionesPorCot = {}
      comisiones.forEach(c => {
        if (!comisionesPorCot[c.cotizacionid]) comisionesPorCot[c.cotizacionid] = []
        comisionesPorCot[c.cotizacionid].push(c)
      })

      // ── 5. Construir registros enriquecidos con items y comisión ─────────────
      const ventaNeta = (d) =>
        Number(d.total_usd || 0) - Number(d.flete_usd || 0) - Number(d.descuento_total_usd || 0)

      const registros = despachos.map(d => {
        const filas = comisionesPorCot[d.cotizacion_id] || []
        // Compatibilidad: fila del vendedor del despacho (o primera disponible)
        const comision = filas.find(c => c.vendedorid === d.vendedor_id) || filas[0] || null
        const itemsDespachado = items.filter(it => it.cotizacion_id === d.cotizacion_id)
        return {
          ...d,
          ventaNeta: ventaNeta(d),
          comision,
          comisiones: filas,
          items: itemsDespachado,
        }
      })

      // ── 6. Agrupar por asesor ────────────────────────────────────────────────
      const asesorMap = {}
      const getGrupo = (nombre, color, vendedorId) => {
        if (!asesorMap[nombre]) {
          asesorMap[nombre] = {
            asesor: nombre,
            color: color ?? '#64748b',
            vendedor_id: vendedorId ?? null,
            ventas: [],
            totalVentas: 0,
            totalComisiones: 0,
            totalPagado: 0,
            totalPendiente: 0,
          }
        }
        return asesorMap[nombre]
      }

      // Ventas: atribuidas al vendedor del despacho
      registros.forEach(r => {
        const grupo = getGrupo(r.vendedor?.nombre ?? 'Sin asesor', r.vendedor?.color, r.vendedor_id)
        grupo.ventas.push(r)
        grupo.totalVentas += r.ventaNeta
      })

      // Comisiones: atribuidas por fila al beneficiario real (vendedor que vendió
      // o dueño del cliente en el split), nunca todas al vendedor del despacho.
      comisiones.forEach(c => {
        const grupo = getGrupo(c.vendedor?.nombre ?? 'Sin asesor', c.vendedor?.color, c.vendedorid)
        const monto = Number(c.totalcomision || 0)
        grupo.totalComisiones += monto
        if (c.estado === 'pagada') grupo.totalPagado    += monto
        else                       grupo.totalPendiente += monto
      })

      const porAsesor = Object.values(asesorMap).sort((a, b) => b.totalVentas - a.totalVentas)
      const asesores  = porAsesor.map(g => g.asesor)

      // ── 7. KPIs globales ─────────────────────────────────────────────────────
      const totalVentas      = registros.reduce((s, r) => s + r.ventaNeta, 0)
      const totalComisiones  = comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const totalPagado      = comisiones.filter(c => c.estado === 'pagada').reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const totalPendiente   = comisiones.filter(c => c.estado !== 'pagada').reduce((s, c) => s + Number(c.totalcomision || 0), 0)

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
