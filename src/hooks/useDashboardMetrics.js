// src/hooks/useDashboardMetrics.js
// Métricas de dashboard específicas por rol
import { useQuery } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'

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

      if (rol === 'administracion') {
        // Queries paralelas para admin
        const hoy = new Date()
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
        const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1 // lunes = 0
        const inicioSemana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diaSemana).toISOString()

        const [pendientes, ventasHoy, ventasSemana, stockBajo] = await Promise.all([
          // Despachos por aprobar
          supabase
            .from('notas_despacho')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'pendiente'),
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
            .filter('stock_actual', 'lt', 'stock_minimo')
            .order('stock_actual', { ascending: true })
            .limit(10),
        ])

        result.despachosPendientes = pendientes.count ?? 0
        result.ventasDia = (ventasHoy.data ?? []).reduce((s, d) => s + Number(d.total_usd || 0), 0)
        result.ventasSemana = (ventasSemana.data ?? []).reduce((s, d) => s + Number(d.total_usd || 0), 0)

        const itemsBajo = stockBajo.data ?? []
        result.stockBajoCount = itemsBajo.length
        result.stockBajoItems = itemsBajo.slice(0, 5)
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
            .select('id, numero, cliente_id, creado_en, total_usd')
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

      if (rol === 'supervisor') {
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
