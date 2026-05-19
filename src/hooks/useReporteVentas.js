// src/hooks/useReporteVentas.js
// Hook principal para datos del reporte de ventas
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_KEY = ['reporte-ventas']

/**
 * Obtiene datos de ventas (despachos aprobados y entregados) en un rango de fechas,
 * con desglose por vendedor, cliente, producto y categoría.
 */
export function useReporteVentas({ from, to, prevFrom, prevTo }) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...REPORTE_KEY, from, to, prevFrom, prevTo, esPrivilegiado, perfil?.id],
    queryFn: async () => {
      // ── 1. Despachos entregados y en entrega (vía RPC) ──
      const fetchDespachos = async (f, t) => {
        const { data, error } = await supabase.rpc('obtener_reporte_ventas_operaciones', {
          p_fecha_inicio: f,
          p_fecha_fin: t,
          p_vendedor_id: esPrivilegiado ? null : perfil?.id
        })
        if (error) throw error
        return data ?? []
      }

      // Queries al Worker para comisiones (v2) — evita RLS directo y usa nombres v2
      const fetchComisionesWorker = async (f, t) => {
        const params = new URLSearchParams()
        params.set('desde', f)
        params.set('hasta', t)
        params.set('pageSize', '1000')
        if (!esPrivilegiado && perfil?.id) params.set('vendedorId', perfil.id)
        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
        if (!res.ok) return []
        const json = await res.json()
        return json?.data ?? []
      }

      const [despachos, prevDespachos, comisiones, prevComisiones] = await Promise.all([
        fetchDespachos(from, to),
        fetchDespachos(prevFrom, prevTo),
        fetchComisionesWorker(from, to),
        fetchComisionesWorker(prevFrom, prevTo),
      ])

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
      const ventaNeta = (d) => Number(d.venta_neta_usd || 0)
      const totalVentas = despachos.reduce((s, d) => s + ventaNeta(d), 0)
      const totalFlete = despachos.reduce((s, d) => s + Number(d.flete_usd || 0), 0)
      const totalDescuentos = despachos.reduce((s, d) => s + Number(d.descuento_usd || 0), 0)
      const numDespachos = despachos.length
      const ticketPromedio = numDespachos > 0 ? totalVentas / numDespachos : 0
      const totalComisiones = comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const comisionesPagadas = comisiones.filter(c => c.estado === 'pagada').reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const comisionesPendientes = comisiones.filter(c => c.estado === 'pendiente').reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const comisionCabilla2 = comisiones.filter(c => Math.round(Number(c.pctcabilla || 0)) === 2).reduce((s, c) => s + Number(c.comisioncabilla || 0), 0)
      const comisionCabilla3 = comisiones.filter(c => Math.round(Number(c.pctcabilla || 0)) === 3).reduce((s, c) => s + Number(c.comisioncabilla || 0), 0)
      const comisionOtros = comisiones.reduce((s, c) => s + Number(c.comisionotros || 0), 0)

      // KPIs anteriores (para comparativo)
      const prevTotalVentas = prevDespachos.reduce((s, d) => s + Number(d.venta_neta_usd || 0), 0)
      const prevNumDespachos = prevDespachos.length
      const prevTicketPromedio = prevNumDespachos > 0 ? prevTotalVentas / prevNumDespachos : 0
      const prevTotalComisiones = prevComisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)

      // Por vendedor
      const vendedorMap = {}
      despachos.forEach(d => {
        const vid = d.asesor_id || 'unassigned'
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            id: vid,
            nombre: d.asesor_nombre ?? 'Sin nombre',
            color: d.asesor_color ?? '#64748b',
            despachos: 0,
            totalUsd: 0,
            comision: 0,
          }
        }
        vendedorMap[vid].despachos++
        vendedorMap[vid].totalUsd += ventaNeta(d)
      })
      comisiones.forEach(c => {
        const vid = c.vendedorid || c.vendedor_id || 'unassigned'
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            id: vid,
            nombre: c.vendedor?.nombre || c.vendedornombre || 'Sin nombre',
            color: c.vendedor?.color || c.vendedorcolor || '#64748b',
            despachos: 0,
            totalUsd: 0,
            comision: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            comisionOtros: 0,
          }
        }
        vendedorMap[vid].comision += Number(c.totalcomision || 0)
        const pctCab = Math.round(Number(c.pctcabilla || 0))
        const montoCab = Number(c.comisioncabilla || 0)
        if (pctCab === 2) {
          vendedorMap[vid].comisionCabilla2 = (vendedorMap[vid].comisionCabilla2 || 0) + montoCab
        } else if (pctCab === 3) {
          vendedorMap[vid].comisionCabilla3 = (vendedorMap[vid].comisionCabilla3 || 0) + montoCab
        }
        const montoOtros = Number(c.comisionotros || 0)
        vendedorMap[vid].comisionOtros = (vendedorMap[vid].comisionOtros || 0) + montoOtros
      })
      if (comisiones.length > 0) {
        console.log('[DEBUG] First comision from worker:', comisiones[0])
      }
      const porVendedor = Object.values(vendedorMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Por cliente
      const clienteMap = {}
      despachos.forEach(d => {
        const cnombre = d.cliente_nombre || 'Sin cliente'
        if (!clienteMap[cnombre]) {
          clienteMap[cnombre] = {
            id: cnombre,
            nombre: cnombre,
            despachos: 0,
            totalUsd: 0,
            vendedor: d.asesor_nombre || '—',
          }
        }
        clienteMap[cnombre].despachos++
        clienteMap[cnombre].totalUsd += ventaNeta(d)
      })
      const porCliente = Object.values(clienteMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 10)
      console.log('[DEBUG] Top Clientes generated:', porCliente)

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
          if (data) data.forEach(p => { cats[p.id] = p.categoria || 'PRODUCTOS EXTERIOR' })
        }
        items.forEach(it => {
          const cat = cats[it.producto_id] || 'PRODUCTOS EXTERIOR'
          if (!categoriaMap[cat]) categoriaMap[cat] = { categoria: cat, unidades: 0, totalUsd: 0 }
          categoriaMap[cat].unidades += Number(it.cantidad || 0)
          categoriaMap[cat].totalUsd += Number(it.total_linea_usd || 0)
        })
      }
      const porCategoria = Object.values(categoriaMap).sort((a, b) => b.totalUsd - a.totalUsd)

      // Forma de pago
      const formaPagoMap = {}
      despachos.forEach(d => {
        const formas = Array.isArray(d.forma_pago) ? d.forma_pago : []
        if (formas.length === 0) {
          const fallback = 'Pendiente'
          if (!formaPagoMap[fallback]) formaPagoMap[fallback] = { formaPago: fallback, count: 0, totalUsd: 0 }
          formaPagoMap[fallback].count++
          formaPagoMap[fallback].totalUsd += ventaNeta(d)
        } else {
          formas.forEach(f => {
            const nombre = f.metodo || 'Sin especificar'
            const monto = Number(f.monto) || 0
            if (!formaPagoMap[nombre]) formaPagoMap[nombre] = { formaPago: nombre, count: 0, totalUsd: 0 }
            formaPagoMap[nombre].count++
            formaPagoMap[nombre].totalUsd += monto
          })
        }
      })
      const porFormaPago = Object.values(formaPagoMap).sort((a, b) => b.totalUsd - a.totalUsd)

      return {
        kpis: {
          totalVentas, totalFlete, totalDescuentos, numDespachos, ticketPromedio, totalComisiones,
          comisionesPagadas, comisionesPendientes, comisionCabilla2, comisionCabilla3, comisionOtros,
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
