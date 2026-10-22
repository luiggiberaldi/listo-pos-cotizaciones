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
      let query = supabase
        .from('clientes')
        .select(SELECT_CLIENTE)
        .gt('saldo_pendiente', 0)
        .eq('activo', true)
        .order('saldo_pendiente', { ascending: false })
      if (!esPrivilegiado) query = query.eq('vendedor_id', perfil.id)
      const { data: clientesConDeuda, error } = await query
      if (error) throw error

      const clientes = clientesConDeuda ?? []
      const clienteIds = clientes.map(c => c.id)

      // 2) Clientes con movimiento (cargo o abono) dentro del rango, aunque hoy
      //    deban $0: sin ellos el saldo inicial y la lista de movimientos del
      //    período quedarían incompletos (p. ej. quien pagó toda su deuda).
      let clientesExtraIds = []
      if (rango?.from || rango?.to) {
        const { data: movsEnRango, error: errorRango } = await supabase
          .from('cuentas_por_cobrar')
          .select('cliente_id')
          .in('tipo', ['cargo', 'abono'])
          .gte('creado_en', `${rango.from || '2000-01-01'}T00:00:00-04:00`)
          .lte('creado_en', `${rango.to || '2100-01-01'}T23:59:59-04:00`)
        if (errorRango) throw errorRango
        clientesExtraIds = [...new Set((movsEnRango || []).map(r => r.cliente_id))].filter(id => !clienteIds.includes(id))
      }

      const clientesExtra = []
      for (let i = 0; i < clientesExtraIds.length; i += 50) {
        const batch = clientesExtraIds.slice(i, i + 50)
        let qExtra = supabase.from('clientes').select(SELECT_CLIENTE).in('id', batch)
        if (!esPrivilegiado) qExtra = qExtra.eq('vendedor_id', perfil.id)
        const { data: extraData, error: errorExtra } = await qExtra
        if (errorExtra) throw errorExtra
        if (extraData) clientesExtra.push(...extraData)
      }

      // 3) Historial COMPLETO de movimientos de esos clientes (sin filtro de fecha:
      //    el saldo inicial del período se calcula con todo lo anterior al rango).
      const todosIds = [...clienteIds, ...clientesExtra.map(c => c.id)]
      let transacciones = []
      for (let i = 0; i < todosIds.length; i += 50) {
        const batch = todosIds.slice(i, i + 50)
        const { data, error: errorTxs } = await supabase
          .from('cuentas_por_cobrar')
          .select(SELECT_MOVIMIENTO)
          .in('tipo', ['cargo', 'abono'])
          .in('cliente_id', batch)
          .order('creado_en', { ascending: true })
        if (errorTxs) throw errorTxs
        transacciones = transacciones.concat(data ?? [])
      }

      // 4) Saldo a favor global (disponible HOY, no al corte) — la pantalla lo
      //    muestra aparte y el módulo puro no lo conoce.
      let querySaldoFavor = supabase
        .from('clientes')
        .select('saldo_a_favor')
        .gt('saldo_a_favor', 0)
        .eq('activo', true)
      if (!esPrivilegiado) querySaldoFavor = querySaldoFavor.eq('vendedor_id', perfil.id)
      const { data: clientesSaldoFavor, error: errorSaldoFavor } = await querySaldoFavor
      if (errorSaldoFavor) throw errorSaldoFavor
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
