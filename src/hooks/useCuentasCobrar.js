// src/hooks/useCuentasCobrar.js
// Queries y mutations para el sistema de cuentas por cobrar
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import { authFetch } from '../services/authFetch'
import useAuthStore from '../store/useAuthStore'
import { CLIENTES_KEY } from './useClientes'
import { showToast } from '../components/ui/Toast'
import { repartirCxC, cargosPendientes, pagadoDeMas } from '../utils/cxcReparto'
import { leerPaginado } from '../utils/leerPaginado'

export const CXC_KEY = ['cuentas-cobrar']

// ─── OP-2026-042: resumen completo de la cuenta de UN cliente ───────────────
// Trae TODOS sus cargos y abonos (sin el tope de 100 del historial) para:
//  - el selector "¿Qué despacho paga?" al registrar un abono
//  - mostrar el "pagado de más" (abonos que no corresponden a ninguna deuda)
export function useResumenCuentaCliente(clienteId) {
  return useQuery({
    queryKey: [...CXC_KEY, 'resumen-cliente', clienteId],
    queryFn: async () => {
      // OP-2026-057: por páginas (M7) y con metodo_pago para la regla de despachos con dos deudas (M3)
      const movs = await leerPaginado(() => supabase
        .from('cuentas_por_cobrar')
        .select('id, tipo, monto_usd, despacho_id, metodo_pago, descripcion, creado_en, fecha_vencimiento, despacho:notas_despacho(numero)')
        .eq('cliente_id', clienteId)
        .in('tipo', ['cargo', 'abono'])
        .order('creado_en', { ascending: true })
        .order('id', { ascending: true }))
      const numeroPorDespacho = Object.fromEntries(movs.filter(m => m.despacho_id).map(m => [m.despacho_id, m.despacho?.numero ?? null]))
      return {
        pendientes: cargosPendientes(movs).map(c => ({ ...c, numero: c.despacho_id ? numeroPorDespacho[c.despacho_id] : null })),
        pagadoDeMas: pagadoDeMas(movs),
      }
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60,
  })
}

// ─── Historial CxC de un cliente ──────────────────────────────────────────
export function useCuentasCobrar(clienteId) {
  return useQuery({
    queryKey: [...CXC_KEY, clienteId],
    queryFn: async () => {
      // OP-2026-057 (M2): historial COMPLETO (antes se cortaba en los últimos 100 movimientos)
      return leerPaginado(() => supabase
        .from('cuentas_por_cobrar')
        .select(`
          id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, fecha_vencimiento,
          registrado_por, creado_en, metodo_pago
        `)
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .order('id', { ascending: false }))
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Resumen global CxC (para reporte) ────────────────────────────────────
export function useResumenCxC(rango) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...CXC_KEY, 'resumen', esPrivilegiado, perfil?.id, rango?.from, rango?.to],
    queryFn: async () => {
      // Obtener clientes con saldo pendiente > 0
      let query = supabase
        .from('clientes')
        .select(`
          id, nombre, rif_cedula, telefono,
          saldo_pendiente,
          vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)
        `)
        .gt('saldo_pendiente', 0)
        .eq('activo', true)
        .order('saldo_pendiente', { ascending: false })

      if (!esPrivilegiado) query = query.eq('vendedor_id', perfil.id)

      const { data: clientesConDeuda, error } = await query
      if (error) throw error

      const clientes = clientesConDeuda ?? []
      let totalDeuda = clientes.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0)
      let promedioDeuda = clientes.length > 0 ? totalDeuda / clientes.length : 0

      // Obtener transacciones (cargos y abonos) para los clientes con deuda activa
      const clienteIds = clientes.map(c => c.id)
      let transacciones = []
      if (clienteIds.length > 0) {
        for (let i = 0; i < clienteIds.length; i += 50) {
          const batch = clienteIds.slice(i, i + 50)
          // OP-2026-057 (M7): por páginas, para no perder movimientos si un lote supera el máximo de la base
          const data = await leerPaginado(() => supabase
            .from('cuentas_por_cobrar')
            .select('id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd, fecha_vencimiento, creado_en, metodo_pago, forma_pago_abono, descripcion, referencia')
            .in('tipo', ['cargo', 'abono'])
            .in('cliente_id', batch)
            .order('creado_en', { ascending: true })
            .order('id', { ascending: true }))
          transacciones = transacciones.concat(data ?? [])
        }
      }

      // Reconstruir los saldos pendientes reales por cargo (FIFO + despacho_id matching)
      const cargosPendientesPorCliente = {}
      const abonosPorCliente = {}
      clienteIds.forEach(cid => {
        cargosPendientesPorCliente[cid] = []
        abonosPorCliente[cid] = []
      })

      // Agrupar transacciones por cliente
      const txsPorCliente = {}
      transacciones.forEach(t => {
        if (!txsPorCliente[t.cliente_id]) txsPorCliente[t.cliente_id] = []
        txsPorCliente[t.cliente_id].push(t)
      })

      // FIFO para clientes originales (saldo global > 0)
      Object.keys(txsPorCliente).forEach(cid => {
        // OP-2026-042: misma regla de reparto en todo el sistema (src/utils/cxcReparto.js).
        // consumo_credito consume saldo a favor; nunca se aplica contra cargos CxC.
        const { cargos: clientCargos, abonos: clientAbonos } = repartirCxC(txsPorCliente[cid])

        // Filtrar cargos: sin rango → solo pendientes; con rango → todos los del periodo
        cargosPendientesPorCliente[cid] = clientCargos
          .filter(c => {
            if (!rango?.from && !rango?.to) {
              return c.saldo_pendiente_cargo > 0.005
            }
            if (!c.creado_en) return false
            const fechaCargo = c.creado_en.split('T')[0]
            if (rango?.from && fechaCargo < rango.from) return false
            if (rango?.to && fechaCargo > rango.to) return false
            return true
          })
          .map(c => ({ ...c, saldo_usd: c.saldo_pendiente_cargo }))

        // Abonos del cliente en el rango seleccionado
        abonosPorCliente[cid] = clientAbonos.filter(a => {
          if (!a.creado_en) return false
          const fechaAbono = a.creado_en.split('T')[0]
          if (rango?.from && fechaAbono < rango.from) return false
          if (rango?.to && fechaAbono > rango.to) return false
          return true
        })
      })

      // ── Si hay rango de fecha, también incluir clientes que pagaron 100%
      // (saldo global = 0, pero tuvieron cargos en el periodo)
      let clientesExtraIds = []
      if (rango?.from || rango?.to) {
        const cargosEnRango = await leerPaginado(() => supabase
          .from('cuentas_por_cobrar')
          .select('cliente_id')
          .eq('tipo', 'cargo')
          .gte('creado_en', `${rango.from || '2000-01-01'}T00:00:00-04:00`)
          .lte('creado_en', `${rango.to || '2100-01-01'}T23:59:59-04:00`)
          .order('id', { ascending: true }))

        const idsEnRango = [...new Set((cargosEnRango || []).map(r => r.cliente_id))]
        clientesExtraIds = idsEnRango.filter(id => !clienteIds.includes(id))
      }

      let clientesExtra = []
      if (clientesExtraIds.length > 0) {
        for (let i = 0; i < clientesExtraIds.length; i += 50) {
          const batch = clientesExtraIds.slice(i, i + 50)
          let qExtra = supabase
            .from('clientes')
            .select(`
              id, nombre, rif_cedula, telefono,
              saldo_pendiente,
              vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)
            `)
            .in('id', batch)
          if (!esPrivilegiado) qExtra = qExtra.eq('vendedor_id', perfil.id)
          const { data: extraData } = await qExtra
          if (extraData) clientesExtra = clientesExtra.concat(extraData)
        }
      }

      // Inicializar mapas para clientes extra y aplicar FIFO
      clientesExtraIds.forEach(cid => {
        cargosPendientesPorCliente[cid] = []
        abonosPorCliente[cid] = []
      })

      if (clientesExtraIds.length > 0) {
        for (let i = 0; i < clientesExtraIds.length; i += 50) {
          const batch = clientesExtraIds.slice(i, i + 50)
          const txExtra = await leerPaginado(() => supabase
            .from('cuentas_por_cobrar')
            .select('id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd, fecha_vencimiento, creado_en, metodo_pago, forma_pago_abono, descripcion, referencia')
            .in('tipo', ['cargo', 'abono'])
            .in('cliente_id', batch)
            .order('creado_en', { ascending: true })
            .order('id', { ascending: true }))

          if (txExtra) {
            // Agrupar por cliente
            const extraPorCliente = {}
            txExtra.forEach(t => {
              if (!extraPorCliente[t.cliente_id]) extraPorCliente[t.cliente_id] = []
              extraPorCliente[t.cliente_id].push(t)
            })

            Object.keys(extraPorCliente).forEach(cid => {
              const { cargos: clientCargos, abonos: clientAbonos } = repartirCxC(extraPorCliente[cid])

              // Solo cargos del periodo (pagados y no pagados)
              cargosPendientesPorCliente[cid] = clientCargos
                .filter(c => {
                  if (!c.creado_en) return false
                  const fechaCargo = c.creado_en.split('T')[0]
                  if (rango?.from && fechaCargo < rango.from) return false
                  if (rango?.to && fechaCargo > rango.to) return false
                  return true
                })
                .map(c => ({ ...c, saldo_usd: c.saldo_pendiente_cargo }))

              abonosPorCliente[cid] = clientAbonos.filter(a => {
                if (!a.creado_en) return false
                const fechaAbono = a.creado_en.split('T')[0]
                if (rango?.from && fechaAbono < rango.from) return false
                if (rango?.to && fechaAbono > rango.to) return false
                return true
              })
            })
          }
        }
      }

      const todosClientes = [...clientes, ...clientesExtra]
      const todosCargosActivos = Object.values(cargosPendientesPorCliente)
        .flat()
        .filter(c => Number(c.saldo_usd || 0) > 0.005)

      // Aging por rangos
      const now = new Date()
      const aging = [
        { rango: '0 – 30 días', count: 0, totalUsd: 0 },
        { rango: '31 – 60 días', count: 0, totalUsd: 0 },
        { rango: '61 – 90 días', count: 0, totalUsd: 0 },
        { rango: '90+ días', count: 0, totalUsd: 0 },
      ]

      const diasPorCliente = {}
      todosCargosActivos.forEach(c => {
        const dias = Math.floor((now - new Date(c.creado_en)) / (1000 * 60 * 60 * 24))
        if (!diasPorCliente[c.cliente_id] || dias > diasPorCliente[c.cliente_id]) {
          diasPorCliente[c.cliente_id] = dias
        }
      })

      todosCargosActivos.forEach(c => {
        const dias = Math.floor((now - new Date(c.creado_en)) / (1000 * 60 * 60 * 24))
        const bucket = dias <= 30 ? 0 : dias <= 60 ? 1 : dias <= 90 ? 2 : 3
        aging[bucket].count++
        aging[bucket].totalUsd += Number(c.saldo_usd || 0)
      })

      const cargoMasAntiguo = todosCargosActivos.length > 0
        ? todosCargosActivos.reduce((oldest, c) => new Date(c.creado_en) < new Date(oldest.creado_en) ? c : oldest)
        : null
      const diasMasAntiguo = cargoMasAntiguo
        ? Math.floor((now - new Date(cargoMasAntiguo.creado_en)) / (1000 * 60 * 60 * 24))
        : 0

      const alertasVencimiento = todosCargosActivos.filter(c => {
        if (!c.fecha_vencimiento) return false
        const diffDays = Math.ceil((new Date(c.fecha_vencimiento) - now) / (1000 * 60 * 60 * 24))
        return diffDays <= 3
      }).map(c => {
        const diffDays = Math.ceil((new Date(c.fecha_vencimiento) - now) / (1000 * 60 * 60 * 24))
        const cClient = todosClientes.find(cli => cli.id === c.cliente_id)
        return { ...c, cliente_nombre: cClient ? cClient.nombre : 'Desconocido', diasRestantes: diffDays }
      })

      const diasRestantesPorCliente = {}
      todosCargosActivos.forEach(c => {
        if (c.fecha_vencimiento) {
          const diffDays = Math.ceil((new Date(c.fecha_vencimiento) - now) / (1000 * 60 * 60 * 24))
          if (diasRestantesPorCliente[c.cliente_id] === undefined || diffDays < diasRestantesPorCliente[c.cliente_id]) {
            diasRestantesPorCliente[c.cliente_id] = diffDays
          }
        }
      })

      const clientesEnriquecidos = todosClientes.map(c => {
        const cActivos = cargosPendientesPorCliente[c.id] || []
        const saldoReporte = (rango?.from || rango?.to)
          ? cActivos.reduce((sum, car) => sum + car.saldo_usd, 0)
          : Number(c.saldo_pendiente || 0)
        const montoOtorgadoReporte = (rango?.from || rango?.to)
          ? cActivos.reduce((sum, car) => sum + Number(car.monto_usd || 0), 0)
          : Number(c.saldo_pendiente || 0)
        const montoCobradoReporte = Math.max(0, montoOtorgadoReporte - saldoReporte)

        return {
          ...c,
          saldo_pendiente: Math.round(saldoReporte * 100) / 100,
          monto_otorgado: Math.round(montoOtorgadoReporte * 100) / 100,
          monto_cobrado: Math.round(montoCobradoReporte * 100) / 100,
          diasSinPago: diasPorCliente[c.id] ?? 0,
          diasRestantes: diasRestantesPorCliente[c.id] !== undefined ? diasRestantesPorCliente[c.id] : null,
          cargosActivos: cActivos,
          abonosEnRango: abonosPorCliente[c.id] || []
        }
      })

      const clientesConDeudaFiltrados = (rango?.from || rango?.to)
        ? clientesEnriquecidos
            .filter(c => c.monto_otorgado > 0.005 || c.saldo_pendiente > 0.005)
            .sort((a, b) => Number(b.monto_otorgado || 0) - Number(a.monto_otorgado || 0))
        : clientesEnriquecidos

      totalDeuda = clientesConDeudaFiltrados.reduce((s, c) => s + c.saldo_pendiente, 0)
      const totalOtorgado = (rango?.from || rango?.to)
        ? clientesConDeudaFiltrados.reduce((s, c) => s + c.monto_otorgado, 0)
        : totalDeuda
      const totalCobrado = (rango?.from || rango?.to)
        ? clientesConDeudaFiltrados.reduce((s, c) => s + c.monto_cobrado, 0)
        : 0

      promedioDeuda = clientesConDeudaFiltrados.length > 0 ? totalDeuda / clientesConDeudaFiltrados.length : 0

      // Obtener abonos recientes
      let abonosQuery = supabase
        .from('cuentas_por_cobrar')
        .select(`
          id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, creado_en, metodo_pago,
          cliente:clientes(nombre),
          despacho:notas_despacho(numero, cotizacion:cotizaciones(numero))
        `)
        .eq('tipo', 'abono')
        .order('creado_en', { ascending: false })

      if (rango?.from) {
        abonosQuery = abonosQuery.gte('creado_en', `${rango.from}T00:00:00-04:00`)
      }
      if (rango?.to) {
        abonosQuery = abonosQuery.lte('creado_en', `${rango.to}T23:59:59-04:00`)
      }
      // OP-2026-057 (M7): con rango de fechas se leen todos por páginas; sin rango, los 50 más recientes
      let abonosRaw
      if (!rango?.from && !rango?.to) {
        abonosRaw = (await abonosQuery.limit(50)).data
      } else {
        const armar = () => {
          let q = supabase
            .from('cuentas_por_cobrar')
            .select(`
          id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, creado_en, metodo_pago,
          cliente:clientes(nombre),
          despacho:notas_despacho(numero, cotizacion:cotizaciones(numero))
        `)
            .eq('tipo', 'abono')
            .order('creado_en', { ascending: false })
            .order('id', { ascending: false })
          if (rango?.from) q = q.gte('creado_en', `${rango.from}T00:00:00-04:00`)
          if (rango?.to) q = q.lte('creado_en', `${rango.to}T23:59:59-04:00`)
          return q
        }
        abonosRaw = await leerPaginado(armar)
      }

      // Consultar saldo_a_favor global de clientes activos
      let querySaldoFavor = supabase
        .from('clientes')
        .select('saldo_a_favor')
        .gt('saldo_a_favor', 0)
        .eq('activo', true)
      if (!esPrivilegiado) querySaldoFavor = querySaldoFavor.eq('vendedor_id', perfil.id)
      const { data: clientesSaldoFavor } = await querySaldoFavor
      const totalSaldoFavorClientes = (clientesSaldoFavor || []).reduce((sum, c) => sum + Number(c.saldo_a_favor || 0), 0)
      const numClientesConSaldoFavor = (clientesSaldoFavor || []).length

      // OP-2026-042 (falla G3): clientes con pagos de más. El saldo nunca baja
      // de 0, así que estos montos no se veían en ningún lado. Si uno de estos
      // clientes vuelve a comprar a crédito, el exceso se come esa deuda.
      let clientesPagadoDeMas = []
      try {
        const { data: excesos, error: errExceso } = await supabase
          .from('v_cxc_pagado_de_mas')
          .select('cliente_id, cargos_usd, abonos_usd, pagado_de_mas_usd')
          .order('pagado_de_mas_usd', { ascending: false })
        if (errExceso) throw errExceso
        const idsExceso = (excesos || []).map(e => e.cliente_id)
        if (idsExceso.length > 0) {
          let qCli = supabase
            .from('clientes')
            .select('id, nombre, vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)')
            .in('id', idsExceso)
          if (!esPrivilegiado) qCli = qCli.eq('vendedor_id', perfil.id)
          const { data: cliExceso } = await qCli
          const porId = Object.fromEntries((cliExceso || []).map(c => [c.id, c]))
          clientesPagadoDeMas = (excesos || [])
            .filter(e => porId[e.cliente_id])
            .map(e => ({
              id: e.cliente_id,
              nombre: porId[e.cliente_id].nombre,
              vendedor: porId[e.cliente_id].vendedor,
              cargos: Number(e.cargos_usd || 0),
              abonos: Number(e.abonos_usd || 0),
              pagadoDeMas: Number(e.pagado_de_mas_usd || 0),
            }))
        }
      } catch (e) {
        console.warn('[CxC] No se pudo leer pagados de más:', e?.message)
      }
      const totalPagadoDeMas = Math.round(clientesPagadoDeMas.reduce((s, c) => s + c.pagadoDeMas, 0) * 100) / 100

      return {
        kpis: {
          totalPagadoDeMas,
          numClientesPagadoDeMas: clientesPagadoDeMas.length,
          totalDeuda,
          totalOtorgado,
          totalCobrado,
          promedioDeuda,
          totalSaldoFavorClientes,
          numClientesConSaldoFavor,
          numClientesConDeuda: clientesConDeudaFiltrados.length,
          diasMasAntiguo,
          numCargos: clientesConDeudaFiltrados.reduce((s, c) => s + (c.cargosActivos?.length || 0), 0),
        },
        clientesConDeuda: clientesConDeudaFiltrados,
        clientesPagadoDeMas,
        aging,
        alertasVencimiento,
        abonos: abonosRaw || []
      }
    },
    enabled: !!perfil,
    retry: 1,
    staleTime: 1000 * 60 * 3,
  })
}

// ─── OP-2026-049 (N10): errores de guardado claros ───────────────────────────
// Antes, si el servidor rechazaba o la conexión fallaba, la ficha no mostraba
// nada (el error quedaba solo en la consola). Estas funciones convierten
// cualquier fallo en un Error con mensaje en español, código y estado HTTP, y
// avisan con un mensaje rojo. El aviso de "posible duplicado" (G4) no se muestra
// como error: lo maneja el formulario con una confirmación.
export const MSG_SIN_CONEXION = 'No hay conexión con el servidor. Revisa internet y vuelve a intentar.'

export async function llamarApiCxc(ruta, opciones, porDefecto) {
  let res
  try {
    res = await authFetch(ruta, opciones)
  } catch {
    const e = new Error(MSG_SIN_CONEXION)
    e.code = 'SIN_CONEXION'
    throw e
  }
  let result = null
  try { result = await res.json() } catch { result = null }
  if (!res.ok) {
    const e = new Error(
      result?.error
        || (res.status === 401 || res.status === 403 ? 'Tu sesión venció. Vuelve a entrar con tu PIN.' : porDefecto)
    )
    e.status = res.status
    e.code = result?.code || null
    e.datos = result || null
    throw e
  }
  return result
}

export function avisarErrorGuardado(prefijo) {
  // vars.sinAvisoGlobal: la pantalla que llama ya muestra su propio aviso.
  // vars.manejaDuplicado: la pantalla muestra la confirmación de "posible duplicado".
  return (error, vars) => {
    if (vars?.sinAvisoGlobal) return
    if (error?.code === 'POSIBLE_DUPLICADO' && vars?.manejaDuplicado) return
    showToast(`${prefijo}: ${error?.message || 'error desconocido'}`, 'error', 8000)
  }
}

// ─── Registrar abono (pago del cliente, via Worker API) ─────────────────────
export function useRegistrarAbono() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion, despachoId, idempotencyKey, confirmarDuplicado }) => {
      return llamarApiCxc('/api/cxc/abono', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Clave estable por operación (no por petición): un reintento reutiliza la
          // misma clave y el servidor devuelve el abono ya registrado en vez de duplicarlo.
          ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {})
        },
        body: JSON.stringify({
          clienteId,
          monto,
          formaPago: formaPago || null,
          referencia: referencia || null,
          descripcion: descripcion || 'Abono recibido',
          despachoId: despachoId || null,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(confirmarDuplicado ? { confirmarDuplicado: true } : {})
        }),
      }, 'No se pudo registrar el abono')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      showToast('Abono registrado exitosamente', 'success')
    },
    onError: avisarErrorGuardado('No se guardó el abono'),
  })
}

// ─── Revertir abono (Worker API) ─────────────────────────────────────────────
export function useRevertirAbono() {
  const qc = useQueryClient()

  return useMutation({
    // OP-2026-055 (I3): anular exige motivo; la copia completa queda en el archivo de movimientos anulados
    mutationFn: async ({ abonoId, motivo }) => {
      return llamarApiCxc('/api/cxc/revertir-abono', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abonoId, motivo }),
      }, 'No se pudo anular el movimiento')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      qc.invalidateQueries({ queryKey: ['cxc-movimientos-borrados'] })
      showToast('Movimiento anulado. Queda guardado en "Movimientos anulados".', 'success')
    },
  })
}

// ─── Revertir (parcial o total) el cargo CxC de un despacho (Worker API) ────
// Cuadre automático de la corrección de métodos de pago: cuando la parte a
// crédito era un error de captura, el cargo baja a `montoNuevo` (0 lo elimina).
// El servidor valida el rol, exige motivo y es idempotente por monto objetivo.
export function useRevertirCargoCxc() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, montoNuevo, motivo }) => {
      const res = await authFetch('/api/cxc/revertir-cargo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, montoNuevo, motivo }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al revertir el cargo de CxC')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      showToast('Cargo de CxC revertido exitosamente', 'success')
    },
  })
}

// ─── Registrar saldo a favor (Worker API) ──────────────────────────────────
export function useRegistrarSaldoFavor() {
  const qc = useQueryClient()

  return useMutation({
    // OP-2026-051: huella por operación y confirmación de posible repetido
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion, idempotencyKey, confirmarDuplicado }) => {
      return llamarApiCxc('/api/cxc/saldo-favor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {})
        },
        body: JSON.stringify({
          clienteId,
          monto,
          formaPago: formaPago || null,
          referencia: referencia || null,
          descripcion: descripcion || 'Saldo a favor registrado',
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(confirmarDuplicado ? { confirmarDuplicado: true } : {})
        }),
      }, 'No se pudo registrar el saldo a favor')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      showToast('Saldo a favor registrado exitosamente', 'success')
    },
    onError: avisarErrorGuardado('No se guardó el saldo a favor'),
  })
}

// ─── Registrar devolución de saldo a favor (Worker API) ────────────────────
export function useRegistrarDevolucionCredito() {
  const qc = useQueryClient()

  return useMutation({
    // OP-2026-051: huella por operación y confirmación de posible repetido
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion, idempotencyKey, confirmarDuplicado }) => {
      return llamarApiCxc('/api/cxc/devolucion-credito', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {})
        },
        body: JSON.stringify({
          clienteId,
          monto,
          formaPago,
          referencia: referencia || null,
          descripcion: descripcion || 'Devolución de saldo a favor registrada',
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(confirmarDuplicado ? { confirmarDuplicado: true } : {})
        }),
      }, 'No se pudo registrar la devolución de saldo a favor')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      showToast('Devolución de saldo a favor registrada exitosamente', 'success')
    },
    onError: avisarErrorGuardado('No se guardó la devolución de saldo'),
  })
}

// ─── Cruzar saldo a favor contra deudas (Worker API) ─────────────────────────
export function useCruzarSaldoFavor() {
  const qc = useQueryClient()

  return useMutation({
    // OP-2026-051: huella por operación (reintento o doble clic no duplican)
    mutationFn: async ({ clienteId, monto, idempotencyKey }) => {
      return llamarApiCxc('/api/cxc/cruzar-saldo-favor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {})
        },
        body: JSON.stringify({
          clienteId,
          monto,
          ...(idempotencyKey ? { idempotencyKey } : {})
        }),
      }, 'No se pudo cruzar el saldo a favor')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      showToast('Saldo cruzado exitosamente', 'success')
    },
    onError: avisarErrorGuardado('No se hizo el cruce'),
  })
}

// ─── Obtener origen de saldo a favor ──────────────────────────────────────────
export function useSaldoFavorOrigen(clienteId) {
  return useQuery({
    queryKey: [...CXC_KEY, 'origen-saldo-favor', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cuentas_por_cobrar')
        .select('forma_pago_abono')
        .eq('cliente_id', clienteId)
        .eq('tipo', 'credito')
        .order('creado_en', { ascending: false })
        .limit(1)

      if (error) throw error
      return data?.[0]?.forma_pago_abono || 'Crédito'
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 5,
  })
}
