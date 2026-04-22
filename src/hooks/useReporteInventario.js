// src/hooks/useReporteInventario.js
// Hook para datos del reporte de inventario valorizado
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_INVENTARIO_KEY = ['reporte-inventario']

export function useReporteInventario() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return useQuery({
    queryKey: [...REPORTE_INVENTARIO_KEY, esSupervisor],
    queryFn: async () => {
      // 1. Todos los productos activos
      const { data: productos, error: errProd } = await supabase
        .from('productos')
        .select('id, codigo, nombre, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, activo')
        .eq('activo', true)
        .order('categoria')
        .order('nombre')

      if (errProd) throw errProd

      // 2. Stock comprometido (cotizaciones enviadas/aceptadas)
      let stockComprometido = {}
      try {
        const { data: sc } = await supabase.rpc('obtener_stock_comprometido')
        if (sc) sc.forEach(r => { stockComprometido[r.producto_id] = Number(r.cantidad_comprometida || 0) })
      } catch (_) {}

      // 3. Movimientos últimos 90 días para detectar productos sin rotación
      const hace90 = new Date()
      hace90.setDate(hace90.getDate() - 90)
      const { data: movimientos } = await supabase
        .from('inventario_movimientos')
        .select('producto_id, creado_en')
        .gte('creado_en', hace90.toISOString())
        .order('creado_en', { ascending: false })

      // Map: producto_id → última fecha de movimiento
      const ultimoMov = {}
      ;(movimientos || []).forEach(m => {
        if (!ultimoMov[m.producto_id]) ultimoMov[m.producto_id] = m.creado_en
      })

      // 4. Agregaciones
      const items = (productos || []).map(p => {
        const comprometido = stockComprometido[p.id] || 0
        const disponible = Math.max(0, Number(p.stock_actual) - comprometido)
        const valorVenta = Number(p.stock_actual) * Number(p.precio_usd)
        const valorCosto = esSupervisor ? Number(p.stock_actual) * Number(p.costo_usd || 0) : null
        const ultimaActividad = ultimoMov[p.id] || null
        const diasSinMov = ultimaActividad
          ? Math.floor((Date.now() - new Date(ultimaActividad).getTime()) / (1000 * 60 * 60 * 24))
          : 999
        const bajStock = Number(p.stock_actual) === 0 || (Number(p.stock_actual) <= Number(p.stock_minimo || 0) && Number(p.stock_minimo) > 0)

        return {
          ...p,
          comprometido,
          disponible,
          valorVenta,
          valorCosto,
          ultimaActividad,
          diasSinMov,
          bajStock,
        }
      })

      // KPIs
      const totalProductos = items.length
      const totalValorVenta = items.reduce((s, i) => s + i.valorVenta, 0)
      const totalValorCosto = esSupervisor ? items.reduce((s, i) => s + (i.valorCosto || 0), 0) : null
      const productosBajoStock = items.filter(i => i.bajStock)
      const productosSinMov30 = items.filter(i => i.diasSinMov >= 30 && Number(i.stock_actual) > 0)
      const productosSinMov60 = items.filter(i => i.diasSinMov >= 60 && Number(i.stock_actual) > 0)
      const productosSinMov90 = items.filter(i => i.diasSinMov >= 90 && Number(i.stock_actual) > 0)

      // Por categoría
      const catMap = {}
      items.forEach(i => {
        const cat = i.categoria || 'Sin categoría'
        if (!catMap[cat]) catMap[cat] = { categoria: cat, count: 0, stockTotal: 0, valorVenta: 0, valorCosto: 0 }
        catMap[cat].count++
        catMap[cat].stockTotal += Number(i.stock_actual)
        catMap[cat].valorVenta += i.valorVenta
        if (esSupervisor) catMap[cat].valorCosto += (i.valorCosto || 0)
      })
      const porCategoria = Object.values(catMap).sort((a, b) => b.valorVenta - a.valorVenta)

      return {
        kpis: {
          totalProductos,
          totalValorVenta,
          totalValorCosto,
          numBajoStock: productosBajoStock.length,
          numSinMov30: productosSinMov30.length,
          numSinMov90: productosSinMov90.length,
          esSupervisor,
        },
        items,
        productosBajoStock,
        productosSinMov30,
        productosSinMov60,
        productosSinMov90,
        porCategoria,
      }
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
