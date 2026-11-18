// src/hooks/useReporteVendedores.js
// Hook de datos para el Reporte Detallado de Vendedores — solo supervisores/jefes
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { fetchComisionesTodas } from './useComisiones'
import { leerTodasLasPaginas } from '../utils/leerPaginas'
import { agruparPor } from '../utils/agruparPor'
import useAuthStore from '../store/useAuthStore'
import { shouldIncludeReporteVendedor } from '../utils/reporteVendedoresAccess'
import { construirComisionesGuardadas } from '../utils/reporteVendedoresComisiones'

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
    queryKey: [...REPORTE_VENDEDORES_KEY, from, to, prevFrom, prevTo, perfil?.id, perfil?.rol],
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
      // Todas las páginas (la base entrega máximo 1.000 filas por pedido). Orden estable.
      const fetchDespachos = (f, t) => leerTodasLasPaginas((desde, hasta) =>
        supabase.rpc('obtener_reporte_ventas_operaciones', {
          p_fecha_inicio: f,
          p_fecha_fin: t,
          p_vendedor_id: null, // null = todos los vendedores (privilegiado)
        })
          .order('fecha', { ascending: false })
          .order('despacho_id', { ascending: true })
          .range(desde, hasta))

      // Todo lo que no depende de lo demás se pide a la vez (antes: un paso tras otro).
      const arrancar = f => { const pr = Promise.resolve(f()); pr.catch(() => {}); return pr }
      const pDespachos = arrancar(() => Promise.all([
        fetchDespachos(from, to),
        fetchDespachos(prevFrom, prevTo),
      ]))
      const pUsuarios = arrancar(() => supabase
        .from('usuarios')
        .select('id, nombre, color, activo, rol, markup_pct, comision_pct, comision_pct_cabilla, es_externo'))

      // ── 2. Cotizaciones del período por vendedor ─────────────────────────
      // Todas las páginas: .limit(5000) NO alcanzaba, la base igual corta en 1.000.
      // Un error lanza (reporte financiero: nunca renderizar con ceros).
      const pCotizaciones = arrancar(() => Promise.all([
        leerTodasLasPaginas((desde, hasta) => supabase
          .from('cotizaciones')
          .select('id, vendedor_id, estado, total_usd, creado_en')
          .gte('creado_en', `${from}T00:00:00${tzStr}`)
          .lte('creado_en', `${to}T23:59:59${tzStr}`)
          .order('id', { ascending: true })
          .range(desde, hasta)),
        leerTodasLasPaginas((desde, hasta) => supabase
          .from('cotizaciones')
          .select('id, vendedor_id, estado')
          .gte('creado_en', `${prevFrom}T00:00:00${tzStr}`)
          .lte('creado_en', `${prevTo}T23:59:59${tzStr}`)
          .order('id', { ascending: true })
          .range(desde, hasta)),
      ]))

      // ── 3. Comisiones del período ────────────────────────────────────────
      // Comisiones guardadas (todas las páginas). Son la única fuente (OP-2026-032).
      const fetchComisiones = async (f, t) => {
        try {
          const res = await fetchComisionesTodas({ desde: f, hasta: t })
          return res?.data ?? []
        } catch {
          return []
        }
      }

      const pComisiones = arrancar(() => fetchComisiones(from, to))

      const [despachos, prevDespachos] = await pDespachos
      const [cotizaciones, prevCotizaciones] = await pCotizaciones
      const comisionesRaw = await pComisiones

      // Map cotizacion_id → asesor_id para vincular items con vendedor
      const cotToVendedor = Object.fromEntries(
        despachos.map(d => [d.cotizacion_id, d.asesor_id]).filter(([k]) => k)
      )

      // Fetch notas_despacho_items and despacho_descuentos
      const allDispatchIds = [
        ...new Set([
          ...despachos.map(d => d.despacho_id),
          ...prevDespachos.map(d => d.despacho_id)
        ].filter(Boolean))
      ]

      let ndItems = []
      let despachoDescuentos = []

      if (allDispatchIds.length > 0) {
        // Lotes de 50 en paralelo — items y descuentos a la vez
        // (antes: 2 awaits secuenciales por lote)
        const batches = []
        for (let i = 0; i < allDispatchIds.length; i += 50) batches.push(allDispatchIds.slice(i, i + 50))
        const results = await Promise.all(batches.map(batch => Promise.all([
          supabase
            .from('notas_despacho_items')
            .select('despacho_id, producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, origen, es_prestamo, producto:productos(categoria)')
            .in('despacho_id', batch),
          supabase
            .from('despacho_descuentos')
            .select('despacho_id, cotizacion_item_id, monto_usd')
            .in('despacho_id', batch),
        ])))
        for (const [itemsRes, descRes] of results) {
          if (itemsRes.error) throw itemsRes.error
          if (descRes.error) throw descRes.error
          ndItems = ndItems.concat(itemsRes.data ?? [])
          despachoDescuentos = despachoDescuentos.concat(descRes.data ?? [])
        }
      }

      // ── 4. Items de cotizaciones → para Top Productos por vendedor ────────
      // Solo hacen falta para las ventas que no tienen artículos propios (casi ninguna).
      const despachosConItems = new Set(ndItems.map(it => it.despacho_id))
      const cotIds = [...new Set(despachos.filter(d => !despachosConItems.has(d.despacho_id)).map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        // Lotes de 50 en paralelo (antes: await secuencial por lote)
        const batches = []
        for (let i = 0; i < cotIds.length; i += 50) batches.push(cotIds.slice(i, i + 50))
        const results = await Promise.all(batches.map(batch =>
          supabase
            .from('cotizacion_items')
            .select('id, producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id, origen')
            .in('cotizacion_id', batch)
        ))
        for (const { data, error } of results) {
          if (error) throw error
          const filtrados = (data ?? []).filter(it =>
            !it.nombre_snap || !it.nombre_snap.toLowerCase().trimStart().startsWith('corte')
          )
          items = items.concat(filtrados)
        }
      }

      // ── 4.5. Unificación e Identificación de Préstamos/Donaciones en Items ──
      const itemsFinales = []
      const ndItemsPorDespacho = agruparPor(ndItems, 'despacho_id')
      const cotItemsPorCot = agruparPor(items, 'cotizacion_id')
      despachos.forEach(d => {
        const dispatchItems = ndItemsPorDespacho.get(d.despacho_id) || []
        const fp = Array.isArray(d.forma_pago) ? d.forma_pago : []
        const tienePrestamoFp = fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')
        const esDonacion = fp.some(f => f.metodo === 'Donación')

        if (dispatchItems.length > 0) {
          dispatchItems.forEach(it => {
            const esItemPrestamo = !!it.es_prestamo || tienePrestamoFp
            itemsFinales.push({
              ...it,
              cotizacion_id: d.cotizacion_id,
              total_linea_usd: esItemPrestamo ? 0 : Number(it.total_linea_usd || 0),
              es_prestamo: esItemPrestamo,
              es_donacion: esDonacion
            })
          })
        } else {
          const cotItems = cotItemsPorCot.get(d.cotizacion_id) || []
          cotItems.forEach(it => {
            const desc = despachoDescuentos.find(dd => dd.despacho_id === d.despacho_id && dd.cotizacion_item_id === it.id)
            const descMonto = desc ? Number(desc.monto_usd || 0) : 0
            const totalNeto = Math.max(Number(it.total_linea_usd || 0) - descMonto, 0)
            const esItemPrestamo = tienePrestamoFp
            itemsFinales.push({
              ...it,
              total_linea_usd: esItemPrestamo ? 0 : totalNeto,
              es_prestamo: esItemPrestamo,
              es_donacion: esDonacion
            })
          })
        }
      })

      // ── 5. Construir mapa por vendedor ────────────────────────────────────
      const ventaNeta = (d) => Number(d.venta_neta_usd || 0)

      const { data: vData, error: vError } = await pUsuarios
      if (vError) throw vError

      let vendedoresInfo = {}
      ;(vData ?? []).forEach(v => { vendedoresInfo[v.id] = v })

      // OP-2026-032: solo comisiones guardadas (las mismas que se pagan); sin estimaciones.
      const comisiones = construirComisionesGuardadas(despachos, comisionesRaw, vendedoresInfo)

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
            markup_pct: info.markup_pct != null ? Number(info.markup_pct) : null,
            es_externo: !!info.es_externo,
            totalUsd: 0, prevTotalUsd: 0, numDespachos: 0, ticketPromedio: 0,
            cotizaciones: { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0, anulada: 0, total: 0 },
            prevCotizaciones: { total: 0, enviada: 0 },
            tasaCierre: 0,
            comisionTotal: 0, comisionGenerada: 0, comisionSplit: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            clienteMap: {},
            productoMap: {},
            historial: [],
          }
        }
        return vendedorMap[vid]
      }

      // Pre-populamos todos los vendedores activos para que siempre aparezcan en el reporte
      Object.values(vendedoresInfo).forEach(v => {
        const esVendedorActivo = v.activo && (v.rol === 'vendedor' || v.rol === 'vendedor_sin_comision' || !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))
        if (esVendedorActivo) {
          getOrCreate(v.id)
        }
      })

       // Map dispatch prestamo metadata based on itemsFinales
       const itemsFinalesPorDespacho = agruparPor(itemsFinales, 'despacho_id')
       const despachosMapeados = despachos.map(d => {
         const dispatchItems = itemsFinalesPorDespacho.get(d.despacho_id) || []
         const hasPrestamos = dispatchItems.some(it => it.es_prestamo)
         const esPrestamoPuro = hasPrestamos && Number(d.venta_neta_usd || 0) === 0
         const esPrestamoMixto = hasPrestamos && Number(d.venta_neta_usd || 0) > 0
 
         return {
           ...d,
           tiene_prestamos: hasPrestamos,
           es_prestamo_puro: esPrestamoPuro,
           es_prestamo_mixto: esPrestamoMixto
         }
       })
 
       // Despachos actuales → ventas
       despachosMapeados.forEach(d => {
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
           es_prestamo_puro: d.es_prestamo_puro,
           es_prestamo_mixto: d.es_prestamo_mixto
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
        // Todas las comisiones son generadas; no hay ciclo pagada/pendiente
        v.comisionGenerada += monto
        // (antes aquí también se sumaba el split: quedaba al doble; se suma una sola vez abajo)

        // Acumular comisiones de cabillas al 2% y 3%.
        // Las filas split (0.5%/1.5% por cliente ajeno) van aparte: no son 2% ni 3%.
        if (c.es_split) {
          v.comisionSplit = (v.comisionSplit || 0) + monto
        } else {
          const pctCab = Math.round(Number(c.pctcabilla || 0))
          const montoCab = Number(c.comisioncabilla || 0)
          if (pctCab === 2) {
            v.comisionCabilla2 += montoCab
          } else if (pctCab === 3) {
            v.comisionCabilla3 += montoCab
          }
        }
        
        v.comisionOtros = (v.comisionOtros || 0) + Number(c.comisionotros || 0)
      })

      // Items → Top productos por vendedor
      itemsFinales.forEach(it => {
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
        .filter(v => {
          // El desarrollador nunca debe aparecer en ningún reporte
          if (v.rol === 'desarrollador') return false
          return shouldIncludeReporteVendedor(perfil?.rol, v)
        })
        .map(v => {
          const enviadas = v.cotizaciones.enviada + v.cotizaciones.aceptada + v.cotizaciones.rechazada
          return {
            ...v,
            comision: v.comisionTotal, // Fix mismatch where TablaVendedores reads v.comision instead of v.comisionTotal
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
      // Para supervisor, el KPI respeta exactamente las filas visibles y excluye
      // cualquier comisión histórica asociada a EMPRESA. Jefe conserva el total
      // histórico general, incluida esa comisión si existe.
      const totalComisionGlobal = perfil?.rol === 'supervisor'
        ? porVendedor.reduce((s, v) => s + Number(v.comisionTotal || 0), 0)
        : comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
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
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
