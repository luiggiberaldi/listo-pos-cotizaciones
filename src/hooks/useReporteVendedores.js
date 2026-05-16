// src/hooks/useReporteVendedores.js
// Hook de datos para el Reporte Detallado de Vendedores — solo supervisores/jefes
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_VENDEDORES_KEY = ['reporte-vendedores']

/**
 * Retorna datos agregados por vendedor:
 * - ventas (despachos entregados)
 * - cotizaciones (por estado)
 * - comisiones
 * - top clientes y top productos de cada vendedor
 */
export function useReporteVendedores({ from, to, prevFrom, prevTo }) {
  const { perfil } = useAuthStore()
  const esPrivilegiado =
    perfil?.rol === 'supervisor' ||
    perfil?.rol === 'jefe' ||
    perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...REPORTE_VENDEDORES_KEY, from, to, prevFrom, prevTo, perfil?.id],
    queryFn: async () => {
      // ── Timezone local para filtros correctos ──────────────────────────────
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      // ── 1. Despachos entregados período actual ─────────────────────────────
      const [despachosRes, prevDespachosRes] = await Promise.all([
        supabase
          .from('notas_despacho')
          .select(`
            id, numero, cotizacion_id, total_usd, flete_usd, descuento_total_usd,
            vendedor_id, cliente_id, entregada_en,
            vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color),
            cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre)
          `)
          .eq('estado', 'entregada')
          .gte('entregada_en', `${from}T00:00:00${tzStr}`)
          .lte('entregada_en', `${to}T23:59:59${tzStr}`)
          .order('entregada_en', { ascending: false }),
        supabase
          .from('notas_despacho')
          .select('id, vendedor_id, total_usd, flete_usd, descuento_total_usd')
          .eq('estado', 'entregada')
          .gte('entregada_en', `${prevFrom}T00:00:00${tzStr}`)
          .lte('entregada_en', `${prevTo}T23:59:59${tzStr}`),
      ])

      if (despachosRes.error) throw despachosRes.error
      if (prevDespachosRes.error) throw prevDespachosRes.error

      const despachos = despachosRes.data ?? []
      const prevDespachos = prevDespachosRes.data ?? []

      // ── 2. Cotizaciones del período por vendedor ──────────────────────────
      const [cotActualRes, cotPrevRes] = await Promise.all([
        supabase
          .from('cotizaciones')
          .select('id, vendedor_id, estado, total_usd, creado_en')
          .gte('creado_en', `${from}T00:00:00${tzStr}`)
          .lte('creado_en', `${to}T23:59:59${tzStr}`),
        supabase
          .from('cotizaciones')
          .select('id, vendedor_id, estado')
          .gte('creado_en', `${prevFrom}T00:00:00${tzStr}`)
          .lte('creado_en', `${prevTo}T23:59:59${tzStr}`),
      ])

      const cotizaciones = cotActualRes.data ?? []
      const prevCotizaciones = cotPrevRes.data ?? []

      // ── 3. Comisiones del período ─────────────────────────────────────────
      const fetchComisiones = async (f, t) => {
        const params = new URLSearchParams()
        params.set('desde', f)
        params.set('hasta', t)
        params.set('pageSize', '1000')
        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
        if (!res.ok) return []
        const json = await res.json()
        return json?.data ?? []
      }

      const [comisiones, prevComisiones] = await Promise.all([
        fetchComisiones(from, to),
        fetchComisiones(prevFrom, prevTo),
      ])

      // ── 4. Items de cotizaciones → para Top Productos por vendedor ─────────
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        for (let i = 0; i < cotIds.length; i += 50) {
          const batch = cotIds.slice(i, i + 50)
          const { data, error } = await supabase
            .from('cotizacion_items')
            .select('producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id')
            .in('cotizacion_id', batch)
          if (!error && data) items = items.concat(data)
        }
      }

      // Map cotizacion_id → vendedor_id para vincular items
      const cotToVendedor = Object.fromEntries(
        despachos.map(d => [d.cotizacion_id, d.vendedor_id]).filter(([k]) => k)
      )

      // ── 5. Construir mapa por vendedor ─────────────────────────────────────
      const ventaNeta = (d) =>
        Number(d.total_usd || 0) - Number(d.flete_usd || 0) - Number(d.descuento_total_usd || 0)

      // Obtener lista única de vendedores que aparecen en despachos/cotizaciones
      const vendedorIds = [...new Set([
        ...despachos.map(d => d.vendedor_id),
        ...cotizaciones.map(c => c.vendedor_id),
      ].filter(Boolean))]

      // Fetch datos de todos los vendedores involucrados
      let vendedoresInfo = {}
      if (vendedorIds.length > 0) {
        const { data: vData } = await supabase
          .from('usuarios')
          .select('id, nombre, color, activo')
          .in('id', vendedorIds)
        ;(vData ?? []).forEach(v => { vendedoresInfo[v.id] = v })
      }

      const vendedorMap = {}

      const getOrCreate = (vid) => {
        if (!vendedorMap[vid]) {
          const info = vendedoresInfo[vid] || {}
          vendedorMap[vid] = {
            id: vid,
            nombre: info.nombre ?? 'Sin nombre',
            color: info.color ?? '#64748b',
            activo: info.activo ?? true,
            // Ventas
            totalUsd: 0,
            prevTotalUsd: 0,
            numDespachos: 0,
            ticketPromedio: 0,
            // Cotizaciones
            cotizaciones: { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, anulada: 0, total: 0 },
            prevCotizaciones: { total: 0, enviada: 0 },
            tasaCierre: 0,
            // Comisiones
            comisionTotal: 0,
            comisionPagada: 0,
            comisionPendiente: 0,
            // Top clientes
            clienteMap: {},
            // Top productos
            productoMap: {},
            // Historial despachos
            historial: [],
          }
        }
        return vendedorMap[vid]
      }

      // Despachos → ventas actuales
      despachos.forEach(d => {
        const v = getOrCreate(d.vendedor_id)
        const neta = ventaNeta(d)
        v.totalUsd += neta
        v.numDespachos++
        v.historial.push({
          id: d.id,
          fecha: d.entregada_en,
          cliente: d.cliente?.nombre ?? '—',
          totalUsd: neta,
        })
        // Top clientes
        const cid = d.cliente_id
        if (cid) {
          if (!v.clienteMap[cid]) v.clienteMap[cid] = { id: cid, nombre: d.cliente?.nombre ?? '—', compras: 0, totalUsd: 0 }
          v.clienteMap[cid].compras++
          v.clienteMap[cid].totalUsd += neta
        }
      })

      // Despachos previos → comparativo
      prevDespachos.forEach(d => {
        const v = getOrCreate(d.vendedor_id)
        v.prevTotalUsd += ventaNeta(d)
      })

      // Cotizaciones actuales → tasa de cierre
      cotizaciones.forEach(c => {
        const v = getOrCreate(c.vendedor_id)
        v.cotizaciones.total++
        if (v.cotizaciones[c.estado] !== undefined) v.cotizaciones[c.estado]++
      })

      // Cotizaciones previas
      prevCotizaciones.forEach(c => {
        const v = getOrCreate(c.vendedor_id)
        v.prevCotizaciones.total++
        if (c.estado === 'enviada') v.prevCotizaciones.enviada++
      })

      // Comisiones actuales
      comisiones.forEach(c => {
        if (!vendedorMap[c.vendedorid]) return
        const v = vendedorMap[c.vendedorid]
        const monto = Number(c.totalcomision || 0)
        v.comisionTotal += monto
        if (c.estado === 'pagada') v.comisionPagada += monto
        else v.comisionPendiente += monto
      })

      // Items de despachos → Top productos por vendedor
      items.forEach(it => {
        const vid = cotToVendedor[it.cotizacion_id]
        if (!vid || !vendedorMap[vid]) return
        const v = vendedorMap[vid]
        const key = it.producto_id || it.nombre_snap
        if (!v.productoMap[key]) {
          v.productoMap[key] = {
            id: it.producto_id,
            nombre: it.nombre_snap,
            codigo: it.codigo_snap,
            unidades: 0,
            totalUsd: 0,
          }
        }
        v.productoMap[key].unidades += Number(it.cantidad || 0)
        v.productoMap[key].totalUsd += Number(it.total_linea_usd || 0)
      })

      // ── 6. Post-proceso: calcular métricas derivadas ─────────────────────
      const porVendedor = Object.values(vendedorMap).map(v => {
        const enviadas = v.cotizaciones.enviada + v.cotizaciones.aceptada + v.cotizaciones.rechazada
        return {
          ...v,
          ticketPromedio: v.numDespachos > 0 ? v.totalUsd / v.numDespachos : 0,
          tasaCierre: enviadas > 0
            ? Math.round((v.cotizaciones.aceptada / enviadas) * 100)
            : 0,
          topClientes: Object.values(v.clienteMap)
            .sort((a, b) => b.totalUsd - a.totalUsd)
            .slice(0, 5),
          topProductos: Object.values(v.productoMap)
            .sort((a, b) => b.totalUsd - a.totalUsd)
            .slice(0, 5),
          historial: v.historial
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            .slice(0, 20),
          variacionUsd: v.prevTotalUsd > 0
            ? ((v.totalUsd - v.prevTotalUsd) / v.prevTotalUsd) * 100
            : null,
          // Limpiar mapas internos
          clienteMap: undefined,
          productoMap: undefined,
        }
      }).sort((a, b) => b.totalUsd - a.totalUsd)

      // ── 7. KPIs globales del período ──────────────────────────────────────
      const totalVentasGlobal = porVendedor.reduce((s, v) => s + v.totalUsd, 0)
      const totalDespachosGlobal = porVendedor.reduce((s, v) => s + v.numDespachos, 0)
      const totalComisionGlobal = comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const prevTotalGlobal = prevDespachos.reduce((s, d) => s + ventaNeta(d), 0)

      return {
        porVendedor,
        kpis: {
          totalVentas: totalVentasGlobal,
          totalDespachos: totalDespachosGlobal,
          totalComision: totalComisionGlobal,
          prevTotalVentas: prevTotalGlobal,
          ticketPromedioGlobal: totalDespachosGlobal > 0 ? totalVentasGlobal / totalDespachosGlobal : 0,
          variacionGlobal: prevTotalGlobal > 0
            ? ((totalVentasGlobal - prevTotalGlobal) / prevTotalGlobal) * 100
            : null,
          numVendedores: porVendedor.length,
        },
        periodo: { from, to, prevFrom, prevTo },
      }
    },
    enabled: !!perfil && esPrivilegiado && !!from && !!to,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
