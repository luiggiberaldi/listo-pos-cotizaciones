// src/hooks/useDashboardMetrics.js
// Métricas de dashboard específicas por rol
import { useQuery } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'

export const DASHBOARD_KEY = ['dashboard_metrics']

export function useDashboardMetrics() {
  const { perfil } = useAuthStore()
  const rol = perfil?.rol

  return useQuery({
    queryKey: [...DASHBOARD_KEY, perfil?.id, rol],
    queryFn: async () => {
      const result = {}

      if (rol === 'vendedor') {
        // Despachos pendientes de aprobación (propios)
        const { count } = await supabase
          .from('notas_despacho')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente')
          .eq('vendedor_id', perfil.id)
        result.despachosPendientes = count ?? 0
      }

      if (rol === 'administracion' || rol === 'jefe' || rol === 'desarrollador') {
        // Queries paralelas para admin
        const hoy = new Date()
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
        const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1 // lunes = 0
        const inicioSemana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diaSemana).toISOString()

        // Rango semana actual: lunes → sábado
        const hoyDia = hoy.getDay() // 0=dom,1=lun,...,6=sab
        const diasDesdelunes = hoyDia === 0 ? 6 : hoyDia - 1
        const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diasDesdelunes)
        const sabado = new Date(lunes); sabado.setDate(lunes.getDate() + 5); sabado.setHours(23,59,59)

        const [pendientes, ventasHoy, ventasSemana, stockBajo, cotizacionesImportantes, comisionesSemana] = await Promise.all([
          // Despachos por aprobar
          supabase
            .from('notas_despacho')
            .select('id, numero, cliente_id, total_usd, creado_en, items_count:notas_despacho_items(count)', { count: 'exact' })
            .eq('estado', 'pendiente')
            .order('creado_en', { ascending: false })
            .limit(5),
          // Ventas del día (despachada + entregada hoy)
          supabase
            .from('notas_despacho')
            .select('total_usd')
            .in('estado', ['despachada', 'entregada'])
            .gte('creado_en', inicioHoy),
          // Ventas de la semana
          supabase
            .from('notas_despacho')
            .select('total_usd')
            .in('estado', ['despachada', 'entregada'])
            .gte('creado_en', inicioSemana),
          // Inventario bajo stock
          supabase
            .from('productos')
            .select('id, nombre, stock_actual, stock_minimo, unidad')
            .gt('stock_minimo', 0)
            .eq('activo', true)
            .order('stock_actual', { ascending: true })
            .limit(50),
          // Cotizaciones importantes enviadas
          supabase
            .from('cotizaciones')
            .select('id, numero, cliente_id, total_usd, creado_en, vendedor_id, items_count:cotizacion_items(count)')
            .eq('estado', 'enviada')
            .order('total_usd', { ascending: false })
            .limit(5),
          // Comisiones de la semana (lunes → sábado) — vía Worker v2
          (async () => {
            const params = new URLSearchParams()
            params.set('desde', lunes.toISOString().split('T')[0])
            params.set('hasta', sabado.toISOString().split('T')[0])
            params.set('pageSize', '200')
            const headers = await getAuthHeaders()
            const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
            if (!res.ok) return { data: [] }
            const json = await res.json()
            return { data: json?.data ?? [] }
          })(),
        ])

        result.despachosPendientes = pendientes.count ?? 0
        result.ventasDia = (ventasHoy.data ?? []).reduce((s, d) => s + Number(d.total_usd || 0), 0)
        result.ventasSemana = (ventasSemana.data ?? []).reduce((s, d) => s + Number(d.total_usd || 0), 0)

        const itemsBajo = (stockBajo.data ?? []).filter(p => p.stock_actual <= p.stock_minimo)
        result.stockBajoCount = itemsBajo.length
        result.stockBajoItems = itemsBajo.slice(0, 5)

        const pendientesList = pendientes.data ?? []
        const cotsImportantesList = cotizacionesImportantes.data ?? []
        
        const allItems = [...pendientesList, ...cotsImportantesList]
        if (allItems.length > 0) {
          const clienteIds = [...new Set(allItems.map(d => d.cliente_id).filter(Boolean))]
          if (clienteIds.length > 0) {
            const session = (await supabase.auth.getSession()).data.session
            const clientes = await fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: clienteIds }),
            }).then(r => r.ok ? r.json() : []).catch(() => [])

            const clienteMap = Object.fromEntries(clientes.map(c => [c.id, c]))
            pendientesList.forEach(d => { d.cliente = clienteMap[d.cliente_id] || null })
            cotsImportantesList.forEach(d => { d.cliente = clienteMap[d.cliente_id] || null })
          }
        }
        result.pendientesList = pendientesList
        result.cotizacionesImportantesList = cotsImportantesList

        // Procesar comisiones semanales agrupadas por vendedor
        const comsSemana = comisionesSemana.data ?? []
        const porVendedor = {}
        let totalSemana = 0
        for (const c of comsSemana) {
          const vid = c.vendedorid
          if (!porVendedor[vid]) {
            porVendedor[vid] = {
              nombre: c.vendedor?.nombre || '—',
              color: c.vendedor?.color || '#1B365D',
              total: 0, pendiente: 0, pagado: 0, count: 0,
            }
          }
          const monto = Number(c.totalcomision || 0)
          porVendedor[vid].total += monto
          porVendedor[vid].count++
          if (c.estado === 'pendiente') porVendedor[vid].pendiente += monto
          else porVendedor[vid].pagado += monto
          totalSemana += monto
        }
        result.comisionesSemana = {
          vendedores: Object.values(porVendedor).sort((a, b) => b.total - a.total),
          total: totalSemana,
          lunes: lunes.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }),
          sabado: sabado.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }),
        }
      }

      if (rol === 'logistica') {
        const hoy = new Date()
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()

        const [despachados, entregasHoy, proximas] = await Promise.all([
          // Entregas pendientes
          supabase
            .from('notas_despacho')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'despachada'),
          // Entregadas hoy
          supabase
            .from('notas_despacho')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'entregada')
            .gte('entregada_en', inicioHoy),
          // Próximas entregas (top 5 despachadas)
          supabase
            .from('notas_despacho')
            .select('id, numero, cliente_id, creado_en, total_usd, items_count:notas_despacho_items(count)')
            .eq('estado', 'despachada')
            .order('creado_en', { ascending: true })
            .limit(5),
        ])

        result.despachosDespachados = despachados.count ?? 0
        result.entregasHoy = entregasHoy.count ?? 0

        // Enriquecer próximas entregas con datos del cliente
        const proximasList = proximas.data ?? []
        if (proximasList.length > 0) {
          const clienteIds = [...new Set(proximasList.map(d => d.cliente_id).filter(Boolean))]
          if (clienteIds.length > 0) {
            const session = (await supabase.auth.getSession()).data.session
            const clientes = await fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: clienteIds }),
            }).then(r => r.ok ? r.json() : []).catch(() => [])

            const clienteMap = Object.fromEntries(clientes.map(c => [c.id, c]))
            proximasList.forEach(d => { d.cliente = clienteMap[d.cliente_id] || null })
          }
        }
        result.proximasEntregas = proximasList
      }

      if (rol === 'supervisor' && rol !== 'jefe' && rol !== 'desarrollador') {
        // Despachos pendientes (todos)
        const { count } = await supabase
          .from('notas_despacho')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente')
        result.despachosPendientes = count ?? 0
      }

      return result
    },
    enabled: !!perfil,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
