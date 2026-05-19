// src/hooks/useReporteVendedores.js
// Hook de datos para el Reporte Detallado de Vendedores — solo supervisores/jefes
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_VENDEDORES_KEY = ['reporte-vendedores']

/**
 * Retorna datos agregados por vendedor:
 * - ventas (despachos aprobados/despachados + entregados)
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
      // ── Timezone local para filtros correctos ────────────────────────────
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      // ── 1. Despachos: aprobados (despachada) + entregados ────────────────
      // Se reemplaza la query directa con .eq('estado','entregada')
      // por la RPC obtener_reporte_ventas_operaciones que ya maneja:
      //   - ambos estados: 'despachada' y 'entregada'
      //   - forma_pago normalizada a JSONB array
      //   - timezone America/Caracas para fechas
      //   - SECURITY DEFINER con validación de rol
      const fetchDespachos = async (f, t) => {
        const { data, error } = await supabase.rpc('obtener_reporte_ventas_operaciones', {
          p_fecha_inicio: f,
          p_fecha_fin: t,
          p_vendedor_id: null, // null = todos los vendedores (privilegiado)
        })
        if (error) throw error
        return data ?? []
      }

      const [despachos, prevDespachos] = await Promise.all([
        fetchDespachos(from, to),
        fetchDespachos(prevFrom, prevTo),
      ])

      // ── 2. Cotizaciones del período por vendedor ─────────────────────────
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

      // ── 3. Comisiones del período ────────────────────────────────────────
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

      // ── 4. Items de cotizaciones → para Top Productos por vendedor ────────
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        for (let i = 0; i < cotIds.length; i += 50) {
          const batch = cotIds.slice(i, i + 50)
          const { data, error } = await supabase
            .from('cotizacion_items')
            .select('producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id')
            .in('cotizacion_id', batch)
          if (!error && data) {
            const filtrados = data.filter(it =>
              !it.nombre_snap || !it.nombre_snap.toLowerCase().trimStart().startsWith('corte')
            )
            items = items.concat(filtrados)
          }
        }
      }

      // Map cotizacion_id → asesor_id para vincular items con vendedor
      const cotToVendedor = Object.fromEntries(
        despachos.map(d => [d.cotizacion_id, d.asesor_id]).filter(([k]) => k)
      )

      // ── 5. Construir mapa por vendedor ────────────────────────────────────
      const ventaNeta = (d) => Number(d.venta_neta_usd || 0)

      const vendedorIds = [...new Set([
        ...despachos.map(d => d.asesor_id),
        ...prevDespachos.map(d => d.asesor_id),
        ...cotizaciones.map(c => c.vendedor_id),
        ...prevCotizaciones.map(c => c.vendedor_id),
        ...comisiones.map(c => c.vendedorid),
        ...prevComisiones.map(c => c.vendedorid),
      ].filter(Boolean))]

      let vendedoresInfo = {}
      if (vendedorIds.length > 0) {
        const { data: vData } = await supabase
          .from('usuarios')
          .select('id, nombre, color, activo, rol')
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
            rol: info.rol ?? 'vendedor',
            totalUsd: 0, prevTotalUsd: 0, numDespachos: 0, ticketPromedio: 0,
            cotizaciones: { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, anulada: 0, total: 0 },
            prevCotizaciones: { total: 0, enviada: 0 },
            tasaCierre: 0,
            comisionTotal: 0, comisionPagada: 0, comisionPendiente: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            clienteMap: {},
            productoMap: {},
            historial: [],
          }
        }
        return vendedorMap[vid]
      }

      // Despachos actuales → ventas
      despachos.forEach(d => {
        const v = getOrCreate(d.asesor_id)
        const neta = ventaNeta(d)
        v.totalUsd += neta
        v.numDespachos++
        v.historial.push({
          id: d.despacho_id,
          numero: d.despacho_numero,
          fecha: d.fecha,
          cliente: d.cliente_nombre ?? '—',
          estado: d.estado,
          formaPago: Array.isArray(d.forma_pago) ? d.forma_pago : [],
          totalUsd: neta,
        })
        const cid = d.cliente_nombre
        if (cid) {
          if (!v.clienteMap[cid]) v.clienteMap[cid] = { id: cid, nombre: cid, compras: 0, totalUsd: 0 }
          v.clienteMap[cid].compras++
          v.clienteMap[cid].totalUsd += neta
        }
      })

      // Despachos previos → comparativo
      prevDespachos.forEach(d => {
        const v = getOrCreate(d.asesor_id)
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
        const v = getOrCreate(c.vendedorid)
        const monto = Number(c.totalcomision || 0)
        v.comisionTotal += monto
        if (c.estado === 'pagada') {
          v.comisionPagada += monto
        } else if (c.estado === 'cta_cobrar') {
          v.comisionPendiente += monto
        } else {
          v.comisionPendiente += monto
        }

        // Acumular comisiones de cabillas al 2% y 3%
        const pctCab = Math.round(Number(c.pctcabilla || 0))
        const montoCab = Number(c.comisioncabilla || 0)
        if (pctCab === 2) {
          v.comisionCabilla2 += montoCab
        } else if (pctCab === 3) {
          v.comisionCabilla3 += montoCab
        }
        
        v.comisionOtros = (v.comisionOtros || 0) + Number(c.comisionotros || 0)
      })

      // Items → Top productos por vendedor
      items.forEach(it => {
        const vid = cotToVendedor[it.cotizacion_id]
        if (!vid || !vendedorMap[vid]) return
        const v = vendedorMap[vid]
        const key = it.producto_id || it.nombre_snap
        if (!v.productoMap[key]) {
          v.productoMap[key] = { id: it.producto_id, nombre: it.nombre_snap, codigo: it.codigo_snap, unidades: 0, totalUsd: 0 }
        }
        v.productoMap[key].unidades += Number(it.cantidad || 0)
        v.productoMap[key].totalUsd += Number(it.total_linea_usd || 0)
      })

      // ── 6. Post-proceso: métricas derivadas ──────────────────────────────
      const porVendedor = Object.values(vendedorMap)
        .filter(v => v.rol !== 'vendedor_sin_comision')
        .map(v => {
          const enviadas = v.cotizaciones.enviada + v.cotizaciones.aceptada + v.cotizaciones.rechazada
          return {
            ...v,
            ticketPromedio: v.numDespachos > 0 ? v.totalUsd / v.numDespachos : 0,
            tasaCierre: enviadas > 0 ? Math.round((v.cotizaciones.aceptada / enviadas) * 100) : 0,
            topClientes: Object.values(v.clienteMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 5),
            topProductos: Object.values(v.productoMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 5),
            historial: v.historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 20),
            variacionUsd: v.prevTotalUsd > 0 ? ((v.totalUsd - v.prevTotalUsd) / v.prevTotalUsd) * 100 : null,
            clienteMap: undefined,
            productoMap: undefined,
          }
        }).sort((a, b) => b.totalUsd - a.totalUsd)

      // ── 7. KPIs globales del período ──────────────────────────────────────
      const totalVentasGlobal = porVendedor.reduce((s, v) => s + v.totalUsd, 0)
      const totalDespachosGlobal = porVendedor.reduce((s, v) => s + v.numDespachos, 0)
      const totalComisionGlobal = comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const totalComisionCabilla2Global = porVendedor.reduce((s, v) => s + (v.comisionCabilla2 || 0), 0)
      const totalComisionCabilla3Global = porVendedor.reduce((s, v) => s + (v.comisionCabilla3 || 0), 0)
      const totalComisionOtrosGlobal = porVendedor.reduce((s, v) => s + (v.comisionOtros || 0), 0)
      const prevTotalGlobal = prevDespachos.reduce((s, d) => s + ventaNeta(d), 0)

      return {
        porVendedor,
        kpis: {
          totalVentas: totalVentasGlobal,
          totalDespachos: totalDespachosGlobal,
          totalComision: totalComisionGlobal,
          totalComisionCabilla2: totalComisionCabilla2Global,
          totalComisionCabilla3: totalComisionCabilla3Global,
          totalComisionOtros: totalComisionOtrosGlobal,
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
