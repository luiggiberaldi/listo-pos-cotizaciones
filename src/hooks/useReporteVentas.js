// src/hooks/useReporteVentas.js
// Hook principal para datos del reporte de ventas
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_KEY = ['reporte-ventas']

/**
 * Obtiene datos de ventas (despachos entregados) en un rango de fechas,
 * con desglose por vendedor, cliente, producto y categoría.
 */
export function useReporteVentas({ from, to, prevFrom, prevTo }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...REPORTE_KEY, from, to, prevFrom, prevTo, esSupervisor, perfil?.id],
    queryFn: async () => {
      // ── 1. Despachos entregados período actual + anterior en paralelo ──
      // Construir offset de zona horaria local para filtros correctos
      // getTimezoneOffset() devuelve minutos de diferencia UTC-local (positivo = zona negativa)
      // Ej: Venezuela UTC-4 → offset = 240 → tzStr = '-04:00'
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      const buildQuery = (f, t) => {
        let q = supabase
          .from('notas_despacho')
          .select(`
            id, numero, cotizacion_id, total_usd, forma_pago,
            vendedor_id, cliente_id, entregada_en,
            vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color),
            cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre)
          `)
          .eq('estado', 'entregada')
          .gte('entregada_en', `${f}T00:00:00${tzStr}`)
          .lte('entregada_en', `${t}T23:59:59${tzStr}`)
          .order('entregada_en', { ascending: false })
        if (!esSupervisor) q = q.eq('vendedor_id', perfil.id)
        return q
      }

      const [despachosRes, prevDespachosRes, comisionesRes, prevComisionesRes] = await Promise.all([
        buildQuery(from, to),
        buildQuery(prevFrom, prevTo),
        (() => {
          let q = supabase.from('comisiones')
            .select('id, vendedor_id, total_comision, estado, creado_en')
            .gte('creado_en', `${from}T00:00:00${tzStr}`)
            .lte('creado_en', `${to}T23:59:59${tzStr}`)
          if (!esSupervisor) q = q.eq('vendedor_id', perfil.id)
          return q
        })(),
        (() => {
          let q = supabase.from('comisiones')
            .select('id, vendedor_id, total_comision, estado, creado_en')
            .gte('creado_en', `${prevFrom}T00:00:00${tzStr}`)
            .lte('creado_en', `${prevTo}T23:59:59${tzStr}`)
          if (!esSupervisor) q = q.eq('vendedor_id', perfil.id)
          return q
        })(),
      ])

      if (despachosRes.error) throw despachosRes.error
      if (prevDespachosRes.error) throw prevDespachosRes.error
      if (comisionesRes.error) throw comisionesRes.error
      if (prevComisionesRes.error) throw prevComisionesRes.error
      const despachos = despachosRes.data ?? []
      const prevDespachos = prevDespachosRes.data ?? []
      const comisiones = comisionesRes.data ?? []
      const prevComisiones = prevComisionesRes.data ?? []

      // ── 2. Items de las cotizaciones de los despachos ──
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        // Supabase .in() tiene límite, dividir en batches de 50
        for (let i = 0; i < cotIds.length; i += 50) {
          const batch = cotIds.slice(i, i + 50)
          const { data, error } = await supabase
            .from('cotizacion_items')
            .select('producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id')
            .in('cotizacion_id', batch)
          if (error) throw error
          items = items.concat(data ?? [])
        }
      }

      // Map cotizacion_id → despacho para enlazar items con vendedor/cliente
      const cotToDespacho = Object.fromEntries(despachos.map(d => [d.cotizacion_id, d]))

      // ── 3. Agregaciones ──

      // KPIs actuales
      const totalVentas = despachos.reduce((s, d) => s + Number(d.total_usd || 0), 0)
      const numDespachos = despachos.length
      const ticketPromedio = numDespachos > 0 ? totalVentas / numDespachos : 0
      const totalComisiones = comisiones.reduce((s, c) => s + Number(c.total_comision || 0), 0)
      const comisionesPagadas = comisiones.filter(c => c.estado === 'pagada').reduce((s, c) => s + Number(c.total_comision || 0), 0)
      const comisionesPendientes = comisiones.filter(c => c.estado === 'pendiente').reduce((s, c) => s + Number(c.total_comision || 0), 0)

      // KPIs anteriores (para comparativo)
      const prevTotalVentas = prevDespachos.reduce((s, d) => s + Number(d.total_usd || 0), 0)
      const prevNumDespachos = prevDespachos.length
      const prevTicketPromedio = prevNumDespachos > 0 ? prevTotalVentas / prevNumDespachos : 0
      const prevTotalComisiones = prevComisiones.reduce((s, c) => s + Number(c.total_comision || 0), 0)

      // Por vendedor
      const vendedorMap = {}
      despachos.forEach(d => {
        const vid = d.vendedor_id
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            id: vid,
            nombre: d.vendedor?.nombre ?? 'Sin nombre',
            color: d.vendedor?.color ?? '#64748b',
            despachos: 0,
            totalUsd: 0,
            comision: 0,
          }
        }
        vendedorMap[vid].despachos++
        vendedorMap[vid].totalUsd += Number(d.total_usd || 0)
      })
      comisiones.forEach(c => {
        if (vendedorMap[c.vendedor_id]) {
          vendedorMap[c.vendedor_id].comision += Number(c.total_comision || 0)
        }
      })
      const porVendedor = Object.values(vendedorMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Por cliente
      const clienteMap = {}
      despachos.forEach(d => {
        const cid = d.cliente_id
        if (!clienteMap[cid]) {
          clienteMap[cid] = {
            id: cid,
            nombre: d.cliente?.nombre ?? 'Sin nombre',
            despachos: 0,
            totalUsd: 0,
          }
        }
        clienteMap[cid].despachos++
        clienteMap[cid].totalUsd += Number(d.total_usd || 0)
      })
      const porCliente = Object.values(clienteMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 10)

      // Por producto
      const productoMap = {}
      items.forEach(it => {
        const key = it.producto_id || it.nombre_snap
        if (!productoMap[key]) {
          productoMap[key] = {
            id: it.producto_id,
            nombre: it.nombre_snap,
            codigo: it.codigo_snap,
            unidades: 0,
            totalUsd: 0,
          }
        }
        productoMap[key].unidades += Number(it.cantidad || 0)
        productoMap[key].totalUsd += Number(it.total_linea_usd || 0)
      })
      const porProducto = Object.values(productoMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 15)

      // Por categoría (necesitamos los nombres de categoría de los productos)
      const productoIds = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
      let categoriaMap = {}
      if (productoIds.length > 0) {
        const cats = {}
        for (let i = 0; i < productoIds.length; i += 50) {
          const batch = productoIds.slice(i, i + 50)
          const { data } = await supabase.from('productos').select('id, categoria').in('id', batch)
          if (data) data.forEach(p => { cats[p.id] = p.categoria || 'Sin categoría' })
        }
        items.forEach(it => {
          const cat = cats[it.producto_id] || 'Sin categoría'
          if (!categoriaMap[cat]) categoriaMap[cat] = { categoria: cat, unidades: 0, totalUsd: 0 }
          categoriaMap[cat].unidades += Number(it.cantidad || 0)
          categoriaMap[cat].totalUsd += Number(it.total_linea_usd || 0)
        })
      }
      const porCategoria = Object.values(categoriaMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Forma de pago
      const formaPagoMap = {}
      despachos.forEach(d => {
        const fp = d.forma_pago || 'Sin especificar'
        if (!formaPagoMap[fp]) formaPagoMap[fp] = { formaPago: fp, count: 0, totalUsd: 0 }
        formaPagoMap[fp].count++
        formaPagoMap[fp].totalUsd += Number(d.total_usd || 0)
      })
      const porFormaPago = Object.values(formaPagoMap).sort((a, b) => b.totalUsd - a.totalUsd)

      return {
        kpis: {
          totalVentas, numDespachos, ticketPromedio, totalComisiones,
          comisionesPagadas, comisionesPendientes,
          prevTotalVentas, prevNumDespachos, prevTicketPromedio, prevTotalComisiones,
        },
        porVendedor,
        porCliente,
        porProducto,
        porCategoria,
        porFormaPago,
        despachos,
      }
    },
    enabled: !!perfil && !!from && !!to,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
