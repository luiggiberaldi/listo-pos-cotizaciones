// src/hooks/useReporteInventario.js
// Hook para datos del reporte de inventario valorizado
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'

export const REPORTE_INVENTARIO_KEY = ['reporte-inventario']

// Roles con acceso a datos de costo (no incluye supervisor)
const ROLES_VER_COSTO = ['administracion', 'jefe', 'desarrollador']

// ── Transformación pura — separada del fetching ───────────────────────────────
function transformarReporte(raw, esPrivilegiado) {
  const { productos, stockComprometido, movimientos } = raw

  // Map: producto_id → última fecha de movimiento (90 días)
  const ultimoMov = {}
  ;(movimientos || []).forEach(m => {
    if (!ultimoMov[m.producto_id]) ultimoMov[m.producto_id] = m.creado_en
  })

  const items = (productos || []).map(p => {
    const comprometido = stockComprometido[p.id] || 0
    const disponible   = Math.max(0, Number(p.stock_actual) - comprometido)
    const valorVenta   = Number(p.stock_actual) * Number(p.precio_usd)
    const valorCosto   = esPrivilegiado ? Number(p.stock_actual) * Number(p.costo_usd || 0) : null
    const ultimaActividad = ultimoMov[p.id] || null
    const diasSinMov = ultimaActividad
      ? Math.floor((Date.now() - new Date(ultimaActividad).getTime()) / (1000 * 60 * 60 * 24))
      : 999
    const bajStock = Number(p.stock_actual) === 0 ||
      (Number(p.stock_actual) <= Number(p.stock_minimo || 0) && Number(p.stock_minimo) > 0)

    return { ...p, comprometido, disponible, valorVenta, valorCosto, ultimaActividad, diasSinMov, bajStock }
  })

  // KPIs
  const totalProductos    = items.length
  const totalValorVenta   = items.reduce((s, i) => s + i.valorVenta, 0)
  const totalValorCosto   = esPrivilegiado ? items.reduce((s, i) => s + (i.valorCosto || 0), 0) : null
  const productosBajoStock  = items.filter(i => i.bajStock)
  const productosSinMov30   = items.filter(i => i.diasSinMov >= 30  && Number(i.stock_actual) > 0)
  const productosSinMov60   = items.filter(i => i.diasSinMov >= 60  && Number(i.stock_actual) > 0)
  const productosSinMov90   = items.filter(i => i.diasSinMov >= 90  && Number(i.stock_actual) > 0)

  // Por categoría
  const catMap = {}
  items.forEach(i => {
    const cat = i.categoria || 'Sin categoría'
    if (!catMap[cat]) catMap[cat] = { categoria: cat, count: 0, stockTotal: 0, valorVenta: 0, valorCosto: 0 }
    catMap[cat].count++
    catMap[cat].stockTotal += Number(i.stock_actual)
    catMap[cat].valorVenta += i.valorVenta
    if (esPrivilegiado) catMap[cat].valorCosto += (i.valorCosto || 0)
  })
  const porCategoria = Object.values(catMap).sort((a, b) => b.valorVenta - a.valorVenta)

  return {
    kpis: {
      totalProductos,
      totalValorVenta,
      totalValorCosto,
      numBajoStock: productosBajoStock.length,
      numSinMov30:  productosSinMov30.length,
      numSinMov90:  productosSinMov90.length,
      esPrivilegiado,
    },
    items,
    productosBajoStock,
    productosSinMov30,
    productosSinMov60,
    productosSinMov90,
    porCategoria,
  }
}

// ── Hook principal ────────────────────────────────────────────────────────────
export function useReporteInventario() {
  const { perfil } = useAuthStore()
  const esPrivilegiado = ROLES_VER_COSTO.includes(perfil?.rol)

  return useQuery({
    // Fase 3: queryKey estable con el rol literal
    queryKey: [...REPORTE_INVENTARIO_KEY, perfil?.rol ?? 'anon'],

    queryFn: async () => {
      // Fecha límite para movimientos (90 días)
      const hace90 = new Date()
      hace90.setDate(hace90.getDate() - 90)

      // Fase 2: queries paralelas
      const [prodRes, scRes, movRes] = await Promise.all([
        supabase
          .from('productos')
          .select('id, codigo, nombre, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, activo')
          .eq('activo', true)
          .order('categoria')
          .order('nombre'),

        supabase.rpc('obtener_stock_comprometido').catch(() => ({ data: null })),

        supabase
          .from('inventario_movimientos')
          .select('producto_id, creado_en')
          .gte('creado_en', hace90.toISOString())
          .order('creado_en', { ascending: false }),
      ])

      if (prodRes.error) throw prodRes.error

      // Normalizar stock comprometido a mapa
      const stockComprometido = {}
      ;(scRes.data || []).forEach(r => {
        stockComprometido[r.producto_id] = Number(r.cantidad_comprometida || 0)
      })

      return { productos: prodRes.data, stockComprometido, movimientos: movRes.data }
    },

    // Fase 4: transformación fuera del queryFn via select
    select: (raw) => transformarReporte(raw, esPrivilegiado),

    // Fase 3: enabled defensivo
    enabled: !!perfil?.rol,
    staleTime: 1000 * 60 * 5,
    gcTime:    1000 * 60 * 15,
  })
}
