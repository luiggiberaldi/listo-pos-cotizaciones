// src/hooks/useReporteVendedores.js
// Hook de datos para el Reporte Detallado de Vendedores — solo supervisores/jefes
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { getComisionPctForItem } from '../utils/comisionUtils'

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
          .lte('creado_en', `${to}T23:59:59${tzStr}`)
          .limit(5000), // tope de seguridad — sin él Supabase corta en 1000 sin avisar
        supabase
          .from('cotizaciones')
          .select('id, vendedor_id, estado')
          .gte('creado_en', `${prevFrom}T00:00:00${tzStr}`)
          .lte('creado_en', `${prevTo}T23:59:59${tzStr}`)
          .limit(5000),
      ])
      // Reporte financiero: un error debe verse, nunca renderizar con ceros
      if (cotActualRes.error) throw cotActualRes.error
      if (cotPrevRes.error) throw cotPrevRes.error
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

      const fetchConfiguracion = async () => {
        const { data } = await supabase
          .from('configuracion_negocio')
          .select('*')
          .eq('id', 1)
          .maybeSingle()
        return data ?? {
          comision_pct_cabilla: 0,
          comision_pct_otros: 0,
          comision_pct_externos: 3,
          comision_categoria_cabilla: 'Cabilla'
        }
      }

      const [comisionesRaw, prevComisionesRaw, config] = await Promise.all([
        fetchComisiones(from, to),
        fetchComisiones(prevFrom, prevTo),
        fetchConfiguracion(),
      ])

      // ── 4. Items de cotizaciones → para Top Productos por vendedor ────────
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
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
            .select('despacho_id, producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, origen, es_prestamo')
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

      // ── 4.5. Unificación e Identificación de Préstamos/Donaciones en Items ──
      const itemsFinales = []
      despachos.forEach(d => {
        const dispatchItems = ndItems.filter(it => it.despacho_id === d.despacho_id)
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
          const cotItems = items.filter(it => it.cotizacion_id === d.cotizacion_id)
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

      // Fetch product categories
      const allProductIds = [
        ...new Set([
          ...itemsFinales.map(i => i.producto_id)
        ].filter(Boolean))
      ]
      const productCategories = {}
      if (allProductIds.length > 0) {
        // Lotes de 50 en paralelo (antes: await secuencial por lote)
        const batches = []
        for (let i = 0; i < allProductIds.length; i += 50) batches.push(allProductIds.slice(i, i + 50))
        const results = await Promise.all(batches.map(batch =>
          supabase
            .from('productos')
            .select('id, categoria')
            .in('id', batch)
        ))
        for (const { data, error } of results) {
          if (error) throw error
          ;(data ?? []).forEach(p => {
            productCategories[p.id] = p.categoria || ''
          })
        }
      }

      // ── 5. Construir mapa por vendedor ────────────────────────────────────
      const ventaNeta = (d) => Number(d.venta_neta_usd || 0)

      const { data: vData, error: vError } = await supabase
        .from('usuarios')
        .select('id, nombre, color, activo, rol, markup_pct, comision_pct, comision_pct_cabilla, es_externo')
      if (vError) throw vError

      let vendedoresInfo = {}
      ;(vData ?? []).forEach(v => { vendedoresInfo[v.id] = v })

      const calcularComisionDespachoJS = (d, comList) => {
        let esDonacion = false
        const fp = Array.isArray(d.forma_pago) ? d.forma_pago : []
        if (fp.some(f => f.metodo === 'Donación') || d.forma_pago === 'Donación') {
          esDonacion = true
        }

        if (esDonacion) {
          return {
            totalcomision: 0,
            comisioncabilla: 0,
            comisionotros: 0,
            pctcabilla: 0,
            pctotros: 0,
            estado: 'pagada'
          }
        }

        const existing = comList.find(c => c.despachoid === d.despacho_id)
        if (existing) {
          return {
            totalcomision: Number(existing.totalcomision || 0),
            comisioncabilla: Number(existing.comisioncabilla || 0),
            comisionotros: Number(existing.comisionotros || 0),
            pctcabilla: Number(existing.pctcabilla || 0),
            pctotros: Number(existing.pctotros || 0),
            estado: existing.estado || 'pendiente'
          }
        }

        if (d.estado !== 'entregada' && d.estado !== 'despachada') {
          return null
        }

        const seller = vendedoresInfo[d.asesor_id || d.vendedor_id]
        if (!seller) return null
        const rol = seller.rol

        if (rol === 'vendedor_sin_comision' && !seller.es_externo) {
          return null
        }
        if (['jefe', 'logistica', 'administracion', 'desarrollador'].includes(rol)) {
          return null
        }

        const dispatchItems = ndItems.filter(it => it.despacho_id === d.despacho_id)
        let comisionCabilla = 0
        let comisionOtros = 0

        const processItem = (it, totalNeto) => {
          const nameLower = (it.nombre_snap || '').toLowerCase().trim()
          if (nameLower.startsWith('corte')) return

          const pct = getComisionPctForItem(
            {
              nombre_snap: it.nombre_snap,
              producto_id: it.producto_id,
              codigo_snap: it.codigo_snap,
              origen: it.origen,
              categoria: productCategories[it.producto_id] || ''
            },
            config,
            seller
          )

          const comLinea = Math.round((totalNeto * pct / 100) * 100) / 100

          // Determine if it belongs to cabilla or others
          const catCabillaStr = (config.comision_categoria_cabilla || 'Cabilla').toLowerCase().trim()
          const prodCat = (productCategories[it.producto_id] || '').toLowerCase().trim()
          const es_externo = !!seller.es_externo
          const esCementoVendedorExterno = es_externo && (prodCat === 'cemento' || nameLower.includes('cemento'))
          const esCabilla = prodCat === catCabillaStr

          if (esCabilla || esCementoVendedorExterno) {
            comisionCabilla += comLinea
          } else {
            comisionOtros += comLinea
          }
        }

        if (dispatchItems.length > 0) {
          dispatchItems.forEach(it => {
            processItem(it, Number(it.total_linea_usd || 0))
          })
        } else {
          const cotItems = items.filter(it => it.cotizacion_id === d.cotizacion_id)
          cotItems.forEach(it => {
            const desc = despachoDescuentos.find(dd => dd.despacho_id === d.despacho_id && dd.cotizacion_item_id === it.id)
            const descMonto = desc ? Number(desc.monto_usd || 0) : 0
            const totalNeto = Math.max(Number(it.total_linea_usd || 0) - descMonto, 0)
            processItem(it, totalNeto)
          })
        }

        const totalComision = comisionCabilla + comisionOtros
        const pctCabilla = seller.es_externo
          ? Number(config.comision_ext_pct_cabilla ?? 2)
          : (seller.comision_pct_cabilla != null ? Number(seller.comision_pct_cabilla) : Number(config.comision_pct_cabilla ?? 2))
        const pctOtros = seller.es_externo
          ? Number(config.comision_ext_pct_otros ?? 3)
          : (seller.comision_pct != null ? Number(seller.comision_pct) : Number(config.comision_pct_otros ?? 3))

        return {
          totalcomision: totalComision,
          comisioncabilla: comisionCabilla,
          comisionotros: comisionOtros,
          pctcabilla: pctCabilla,
          pctotros: pctOtros,
          estado: 'pendiente'
        }
      }

      // ── Split por cliente ajeno (sábados): un despacho puede tener 2 filas de
      // comisión (vendedor que vendió + dueño del cliente). Usamos las filas
      // reales del Worker una por beneficiario; solo estimamos cuando el despacho
      // no tiene filas guardadas.
      const construirComisionesDeDespachos = (listaDespachos, comisionesList) => {
        const out = []
        listaDespachos.forEach(d => {
          const filas = (comisionesList || []).filter(c => c.despachoid === d.despacho_id)
          if (filas.length > 0) {
            filas.forEach(c => {
              const seller = vendedoresInfo[c.vendedorid]
                || vendedoresInfo[d.asesor_id || d.vendedor_id]
              out.push({
                totalcomision: Number(c.totalcomision || 0),
                comisioncabilla: Number(c.comisioncabilla || 0),
                comisionotros: Number(c.comisionotros || 0),
                pctcabilla: Number(c.pctcabilla || 0),
                pctotros: Number(c.pctotros || 0),
                estado: c.estado || 'pendiente',
                // v3: filas split llegan como 'designado' (0.5% al designado del día) o 'cliente_ajeno_dueno' (1.5% al dueño)
                es_split: typeof c.tipo === 'string' && (c.tipo.startsWith('cliente_ajeno') || c.tipo === 'designado'),
                vendedorid: c.vendedorid || d.asesor_id || d.vendedor_id,
                despachoid: d.despacho_id,
                vendedor: seller
              })
            })
            return
          }
          const calculated = calcularComisionDespachoJS(d, comisionesList)
          if (calculated) {
            const seller = vendedoresInfo[d.asesor_id || d.vendedor_id]
            out.push({
              ...calculated,
              es_split: false,
              vendedorid: d.asesor_id || d.vendedor_id,
              despachoid: d.despacho_id,
              vendedor: seller
            })
          }
        })
        return out
      }

      const comisiones = construirComisionesDeDespachos(despachos, comisionesRaw)
      const prevComisiones = construirComisionesDeDespachos(prevDespachos, prevComisionesRaw)

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
            comisionTotal: 0, comisionPagada: 0, comisionPendiente: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            comisionSplit: 0,
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
       const despachosMapeados = despachos.map(d => {
         const dispatchItems = itemsFinales.filter(it => it.despacho_id === d.despacho_id)
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
        if (c.estado === 'pagada') {
          v.comisionPagada += monto
        } else if (c.estado === 'cta_cobrar') {
          v.comisionPendiente += monto
        } else {
          v.comisionPendiente += monto
        }

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
          // Administración y logística tampoco aparecen en el desglose de vendedores
          if (v.rol === 'administracion' || v.rol === 'logistica') return false
          // Jefes y supervisores tampoco aparecen en este reporte
          if (v.rol === 'jefe' || v.rol === 'supervisor') return false
          
          // Incluir vendedores sin comisión (como "EMPRESA" para ventas y préstamos)
          return true
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
