// src/hooks/useComisiones.js
// Queries y mutations para el sistema de comisiones
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { showToast } from '../components/ui/Toast'
import { broadcastEntidad } from '../services/supabase/realtimeBus'
import { countUniqueDispatches } from '../utils/comisionUtils'

export const COMISIONES_KEY = ['comisiones']

const PAGINA_COMISIONES = 1000 // tope del servidor por página
const MAX_PAGINAS_COMISIONES = 50

/**
 * Pide TODAS las páginas de la lista de comisiones al servidor (el servidor entrega
 * máximo 1.000 por página y antes solo se pedía la primera: los períodos largos
 * salían incompletos sin avisar).
 */
export async function fetchComisionesTodas({ desde = '', hasta = '', vendedorId = '', estado = '', vista = '' } = {}) {
  const headers = await getAuthHeaders()
  const filas = []
  let ultima = null
  for (let page = 1; page <= MAX_PAGINAS_COMISIONES; page++) {
    const params = new URLSearchParams()
    if (vendedorId) params.set('vendedorId', vendedorId)
    if (estado) params.set('estado', estado)
    if (desde) params.set('desde', desde)
    if (hasta) params.set('hasta', hasta)
    if (vista) params.set('vista', vista)
    params.set('page', String(page))
    params.set('pageSize', String(PAGINA_COMISIONES))
    const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
    ultima = JSON.parse(text)
    filas.push(...(ultima?.data ?? []))
    // El servidor informa el total real de filas (antes de quitar las de $0).
    // Un servidor viejo no lo informa: entonces se comporta como antes (una página).
    const totalFilas = Number.isFinite(ultima?.totalFilas) ? ultima.totalFilas : null
    const leidas = Number.isFinite(ultima?.filasLeidas) ? ultima.filasLeidas : null
    const hayMas = totalFilas != null ? page * PAGINA_COMISIONES < totalFilas : (leidas != null && leidas >= PAGINA_COMISIONES)
    if (!hayMas) {
      return { ...(ultima ?? {}), data: filas, total: filas.length, page: 1, pageSize: filas.length, totalPages: 1 }
    }
  }
  throw new Error('La lista de comisiones es demasiado grande. Elige un período más corto.')
}

// Misma regla que el resumen del servidor: comisiones > $0, despachos distintos.
export function resumirComisiones(lista) {
  const visibles = (lista?.data ?? []).filter(row => Number(row.totalcomision || 0) > 0)
  const totalAcumulado = Math.round(visibles.reduce((s, row) => s + Number(row.totalcomision || 0), 0) * 100) / 100
  const totalDespachos = countUniqueDispatches(visibles)
  return {
    totalAcumulado,
    totalDespachos,
    // Alias temporal para consumidores antiguos; la UI muestra despachos.
    totalRegistros: totalDespachos,
    totalFilas: visibles.length,
  }
}

function mapearComision(c) {
  if (c.comisiones && c.monto !== undefined) {
    // Si es un objeto de tipo evento de liberación
    return c
  }
  return {
    ...c,
    id: c.id,
    despachoid: c.despachoid,
    vendedorid: c.vendedorid,
    cotizacionid: c.cotizacionid,
    cuentaid: c.cuentaid,
    totalcomision: Number(c.totalcomision || 0),
    comisioncabilla: Number(c.comisioncabilla || 0),
    comisionotros: Number(c.comisionotros || 0),
    totalcomision_bruta: c.totalcomision_bruta == null ? null : Number(c.totalcomision_bruta),
    comision_cxc_excluida: Number(c.comision_cxc_excluida || 0),
    comision_otras_exclusiones: Number(c.comision_otras_exclusiones || 0),
    fraccion_no_cxc: Number(c.fraccion_no_cxc ?? 1),
    fraccion_comision_aplicada: Number(c.fraccion_comision_aplicada ?? 1),
    fraccion_productos_aplicada: Number(c.fraccion_productos_aplicada ?? 1),
    productos_exclusion_aplicada: c.productos_exclusion_aplicada === true,
    comision_no_cxc_aplicada: c.comision_no_cxc_aplicada !== false,
    excluida_por_pago: !!c.excluida_por_pago,
    excluida_por_productos: !!c.excluida_por_productos,
    politica_comision: c.politica_comision || 'fecha_despacho_no_cxc',
    fuente_calculo: c.fuente_calculo || null,
    sourceLegacy: c.sourceLegacy === true,
    pctcabilla: Number(c.pctcabilla || 0),
    pctotros: Number(c.pctotros || 0),
    estado: 'generada',
    creadoen: c.creadoen,
    vendedor: c.vendedor,
    despacho: c.despacho,
    cotizacion: c.cotizacion,
  }
}

// Consulta compartida "todas las comisiones del filtro": la usan la tabla, el menú de
// vendedores y el resumen. Con los mismos filtros comparten una sola descarga.
function consultaComisionesTodas(perfil, { estado = '', vendedorId = '', desde = '', hasta = '', vista = '' }) {
  const esAdmin = perfil?.rol === 'administracion'
  return {
    queryKey: [...COMISIONES_KEY, 'lista', 'todas', perfil?.id, estado, vendedorId, esAdmin, desde, hasta, vista],
    queryFn: async () => {
      if (!perfil?.id) throw new Error('Perfil de operador no disponible para cargar lista de comisiones')
      const res = await fetchComisionesTodas({ desde, hasta, vendedorId, estado, vista })
      return { ...res, data: (res.data ?? []).map(mapearComision) }
    },
  }
}

/**
 * Hook para obtener la lista de comisiones.
 * `todas: true` trae todas las páginas (para reportes y totales); si no, una página.
 */
export function useComisiones({
  estado = '',
  vendedorId = '',
  desde = '',
  hasta = '',
  page = 1,
  pageSize = 100,
  vista = '',
  todas = false,
} = {}) {
  const perfil = useAuthStore(s => s.perfil)
  const esAdmin = perfil?.rol === 'administracion'

  const opciones = todas
    ? consultaComisionesTodas(perfil, { estado, vendedorId, desde, hasta, vista })
    : {
        queryKey: [...COMISIONES_KEY, 'lista', perfil?.id, estado, vendedorId, esAdmin, desde, hasta, page, pageSize, vista],
        queryFn: async () => {
          if (!perfil?.id) {
            throw new Error('Perfil de operador no disponible para cargar lista de comisiones')
          }
          try {
            const params = new URLSearchParams()
            if (vendedorId) params.set('vendedorId', vendedorId)
            if (estado) params.set('estado', estado)
            if (desde) params.set('desde', desde)
            if (hasta) params.set('hasta', hasta)
            if (vista) params.set('vista', vista)
            params.set('page', page.toString())
            params.set('pageSize', pageSize.toString())

            const headers = await getAuthHeaders()
            const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
            const text = await res.text()
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${text}`)
            }
            const data = JSON.parse(text)
            return {
              ...(data ?? { total: 0, page, pageSize, totalPages: 0 }),
              data: (data?.data ?? []).map(mapearComision),
            }
          } catch (e) {
            console.error('Error useComisiones:', e.message)
            throw e
          }
        },
      }

  return useQuery({
    ...opciones,
    enabled: !!perfil?.id,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

/**
 * Resumen de comisiones (KPIs de arriba). Se calcula con la lista COMPLETA (todas las
 * páginas), con la misma regla que usaba el servidor: suma de las comisiones mayores a /usr/bin/bash
 * y cantidad de despachos distintos. Antes el servidor sumaba solo las primeras 1.000 filas.
 * Comparte la descarga con useComisiones({ todas: true }) cuando los filtros coinciden.
 */
export function useComisionesResumen({ vendedorId = '', desde = '', hasta = '', estado = '' } = {}) {
  const perfil = useAuthStore(s => s.perfil)

  return useQuery({
    ...consultaComisionesTodas(perfil, { estado, vendedorId, desde, hasta }),
    select: resumirComisiones,
    enabled: !!perfil?.id,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

/**
 * Reporte Detallado de Ventas y Comisiones (RPC)
 */
export function useReporteVentasComisiones({ desde, hasta, vendedorId } = {}) {
  const perfil = useAuthStore(s => s.perfil)

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'detalle_ventas', perfil?.id, desde, hasta, vendedorId],
    queryFn: async () => {
      if (!perfil?.id) return []

      const p_fecha_inicio = desde ? `${desde}T00:00:00-04:00` : null
      const p_fecha_fin = hasta ? `${hasta}T23:59:59-04:00` : null
      const vId = vendedorId || null

      const { data, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio,
        p_fecha_fin,
        p_vendedor_id: vId
      })

      if (error) {
        console.error('Error RPC Reporte:', error)
        throw error
      }
      return data ?? []
    },
    enabled: !!perfil?.id && !!vendedorId,
  })
}
