// src/hooks/useReportePeriodoCxC.js
// Reporte de Crédito/CxC por período: trae los datos crudos (clientes, movimientos
// del libro de cuentas por cobrar) y los pasa por el módulo puro y probado
// `src/utils/cxcPeriodReport.js` (construirReportePeriodoCxC). Ese módulo produce
// los KPIs de período (saldo inicial, cargos, abonos, cuadre), los movimientos del
// rango y las revisiones de saldo que la pestaña Crédito/CxC de Reportes muestra.
//
// Este hook existe para no tocar `useCuentasCobrar.js` (contingencia del plan de
// promoción del Lote ERP): solo consulta y delega el cálculo en el módulo probado.
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { CXC_KEY } from './useCuentasCobrar'
import { construirReportePeriodoCxC } from '../utils/cxcPeriodReport'
import { leerTodasLasPaginas } from '../utils/leerPaginas'

const SELECT_CLIENTE = `
  id, nombre, rif_cedula, telefono,
  saldo_pendiente,
  vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)
`

const SELECT_MOVIMIENTO = `
  id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd, fecha_vencimiento,
  creado_en, metodo_pago, forma_pago_abono, descripcion, referencia,
  cliente:clientes(nombre),
  despacho:notas_despacho(numero, cotizacion:cotizaciones(numero))
`

export function useReportePeriodoCxC(rango) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = perfil?.rol === 'supervisor' || perfil?.rol === 'jefe' || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...CXC_KEY, 'reporte-periodo', esPrivilegiado, perfil?.id, rango?.from, rango?.to],
    queryFn: async () => {
      // 1) Clientes con deuda actual (saldo_pendiente > 0, activos).
      //    Todas las consultas de este reporte piden TODAS las páginas: la base entrega
      //    máximo 1.000 filas por pedido y antes podía cortar sin avisar.
      const clientes = await leerTodasLasPaginas((desde, hasta) => {
        let query = supabase
          .from('clientes')
          .select(SELECT_CLIENTE)
          .gt('saldo_pendiente', 0)
          .eq('activo', true)
          .order('saldo_pendiente', { ascending: false })
          .order('id', { ascending: true })
        if (!esPrivilegiado) query = query.eq('vendedor_id', perfil.id)
        return query.range(desde, hasta)
      })
      const clienteIds = clientes.map(c => c.id)

      // 2) Clientes con movimiento (cargo o abono) dentro del rango, aunque hoy
      //    deban $0: sin ellos el saldo inicial y la lista de movimientos del
      //    período quedarían incompletos (p. ej. quien pagó toda su deuda).
      let clientesExtraIds = []
      if (rango?.from || rango?.to) {
        const movsEnRango = await leerTodasLasPaginas((desde, hasta) => supabase
          .from('cuentas_por_cobrar')
          .select('id, cliente_id')
          .in('tipo', ['cargo', 'abono'])
          .gte('creado_en', `${rango.from || '2000-01-01'}T00:00:00-04:00`)
          .lte('creado_en', `${rango.to || '2100-01-01'}T23:59:59-04:00`)
          .order('id', { ascending: true })
          .range(desde, hasta))
        const yaIncluidos = new Set(clienteIds)
        clientesExtraIds = [...new Set(movsEnRango.map(r => r.cliente_id))].filter(id => !yaIncluidos.has(id))
      }

      const tandas = ids => Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50))

      // Tandas de 50 a la vez (antes una tras otra).
      const clientesExtra = (await Promise.all(tandas(clientesExtraIds).map(batch =>
        leerTodasLasPaginas((desde, hasta) => {
          let qExtra = supabase.from('clientes').select(SELECT_CLIENTE).in('id', batch)
          if (!esPrivilegiado) qExtra = qExtra.eq('vendedor_id', perfil.id)
          return qExtra.order('id', { ascending: true }).range(desde, hasta)
        })))).flat()

      // 3) Historial COMPLETO de movimientos de esos clientes (sin filtro de fecha:
      //    el saldo inicial del período se calcula con todo lo anterior al rango).
      //    Cada tanda de 50 clientes también se pide completa (puede pasar de 1.000 movimientos).
      const todosIds = [...clienteIds, ...clientesExtra.map(c => c.id)]
      const transacciones = (await Promise.all(tandas(todosIds).map(batch =>
        leerTodasLasPaginas((desde, hasta) => supabase
          .from('cuentas_por_cobrar')
          .select(SELECT_MOVIMIENTO)
          .in('tipo', ['cargo', 'abono'])
          .in('cliente_id', batch)
          .order('creado_en', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, hasta))))).flat()

      // 4) Saldo a favor global (disponible HOY, no al corte) — la pantalla lo
      //    muestra aparte y el módulo puro no lo conoce.
      const clientesSaldoFavor = await leerTodasLasPaginas((desde, hasta) => {
        let querySaldoFavor = supabase
          .from('clientes')
          .select('id, saldo_a_favor')
          .gt('saldo_a_favor', 0)
          .eq('activo', true)
        if (!esPrivilegiado) querySaldoFavor = querySaldoFavor.eq('vendedor_id', perfil.id)
        return querySaldoFavor.order('id', { ascending: true }).range(desde, hasta)
      })
      const totalSaldoFavorClientes = (clientesSaldoFavor || []).reduce((sum, c) => sum + Number(c.saldo_a_favor || 0), 0)
      const numClientesConSaldoFavor = (clientesSaldoFavor || []).length

      // 5) El cálculo del reporte vive en el módulo puro (22+ pruebas en verde).
      const reporte = construirReportePeriodoCxC({
        clientes: [...clientes, ...clientesExtra],
        transacciones,
        rango,
      })

      return {
        ...reporte,
        kpis: {
          ...reporte.kpis,
          // Valores reales de saldo a favor (el módulo los deja en 0 a propósito).
          totalSaldoFavorClientes,
          numClientesConSaldoFavor,
        },
      }
    },
    enabled: !!perfil,
    retry: 1,
    staleTime: 1000 * 60 * 3,
  })
}
