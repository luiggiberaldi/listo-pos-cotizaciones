const TOLERANCIA_SALDO = 0.005
const REDONDEO = 10000
const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000
const ZONA_CXC = 'America/Caracas'

function redondear4(valor) {
  return Math.round((Number(valor) || 0) * REDONDEO) / REDONDEO
}

function fechaCaracasISO(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CXC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha)
  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]))
  return `${valores.year}-${valores.month}-${valores.day}`
}

function siguienteDiaISO(fechaISO) {
  const [year, month, day] = fechaISO.slice(0, 10).split('-').map(Number)
  const siguiente = new Date(Date.UTC(year, month - 1, day + 1))
  return `${siguiente.getUTCFullYear()}-${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}-${String(siguiente.getUTCDate()).padStart(2, '0')}`
}

function inicioDiaCaracas(fechaISO) {
  if (!fechaISO) return null
  return new Date(`${fechaISO.slice(0, 10)}T00:00:00-04:00`).getTime()
}

export function obtenerLimiteSuperiorCxC(rango, ahora = new Date()) {
  if (rango?.to) return `${siguienteDiaISO(rango.to)}T00:00:00-04:00`
  return new Date(ahora.getTime() + 1).toISOString()
}

function fechaCorteISO(ahora, finExclusivoMs, rango) {
  if (rango?.to) return rango.to
  if (rango?.from) return fechaCaracasISO(new Date(finExclusivoMs - 1))
  return fechaCaracasISO(ahora)
}

function inicioDiaUTC(fechaISO) {
  if (!fechaISO) return null
  const [year, month, day] = fechaISO.slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function timestampDeFechaCaracas(fechaISO) {
  return fechaISO ? new Date(`${fechaISO.slice(0, 10)}T00:00:00-04:00`).getTime() : null
}

function diferenciaDias(fechaInicial, fechaFinal) {
  if (!fechaInicial || !fechaFinal) return null
  return Math.round((inicioDiaUTC(fechaFinal) - inicioDiaUTC(fechaInicial)) / MILISEGUNDOS_DIA)
}

function fechaCivil(value, esTimestamp = false) {
  if (!value) return null
  if (!esTimestamp && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10)
  const fecha = new Date(value)
  return Number.isNaN(fecha.getTime()) ? null : fechaCaracasISO(fecha)
}

function fechaMovimientoMs(movimiento) {
  const fecha = new Date(movimiento.creado_en).getTime()
  return Number.isFinite(fecha) ? fecha : null
}

function montoMovimiento(movimiento) {
  return Math.max(0, Number(movimiento.monto_usd) || 0)
}

function netoMovimientos(movimientos) {
  return redondear4(movimientos.reduce((saldo, movimiento) => {
    if (movimiento.tipo === 'cargo') return saldo + montoMovimiento(movimiento)
    if (movimiento.tipo === 'abono') return saldo - montoMovimiento(movimiento)
    return saldo
  }, 0))
}

function formasPago(abono) {
  const valor = abono.forma_pago_abono ?? abono.metodo_pago
  if (Array.isArray(valor)) return valor
  if (valor && typeof valor === 'object') return [valor]
  if (typeof valor !== 'string' || !valor.trim()) return []
  const texto = valor.trim()
  if (texto.startsWith('[') || texto.startsWith('{')) {
    try {
      const parseado = JSON.parse(texto)
      return Array.isArray(parseado) ? parseado : [parseado]
    } catch {
      return [{ metodo: texto }]
    }
  }
  return [{ metodo: texto }]
}

function etiquetaFormaPago(pago) {
  return pago?.metodo || pago?.metodo_pago || pago?.formaPago || ''
}

function esAjusteDevolucion(abono) {
  const forma = String(abono.forma_pago_abono ?? abono.metodo_pago ?? '').toLocaleLowerCase('es')
  const descripcion = String(abono.descripcion || '').toLocaleLowerCase('es')
  return /devoluci[oó]n/.test(forma) || /abono por devoluci[oó]n/.test(descripcion)
}

function esPagoInterno(pago) {
  const metodo = String(etiquetaFormaPago(pago)).trim().toLocaleLowerCase('es')
  return metodo.includes('saldo a favor') || metodo.includes('cruce interno') || metodo === 'cruce'
}

const METODOS_DINERO = new Set([
  'efectivo $',
  'efectivo bs',
  'efectivo',
  'zelle',
  'transf. / pago móvil',
  'transferencia',
  'pago móvil',
  'punto de venta',
  'usdt',
])

function categoriaPago(pago) {
  if (esPagoInterno(pago)) return 'saldoFavor'
  const metodo = String(etiquetaFormaPago(pago)).trim().toLocaleLowerCase('es')
  return METODOS_DINERO.has(metodo) ? 'dinero' : 'sinClasificar'
}

function resumenAbono(abono) {
  const montoTotal = montoMovimiento(abono)
  if (esAjusteDevolucion(abono)) return { dinero: 0, saldoFavor: 0, ajuste: montoTotal, sinClasificar: 0 }

  const pagos = formasPago(abono)
  if (pagos.length === 0) return { dinero: 0, saldoFavor: 0, ajuste: 0, sinClasificar: montoTotal }

  const montosDeclarados = pagos.map(pago => Number(pago?.monto))
  const tieneMontos = montosDeclarados.some(Number.isFinite)
  if (!tieneMontos) {
    if (pagos.length !== 1) return { dinero: 0, saldoFavor: 0, ajuste: 0, sinClasificar: montoTotal }
    const categoria = categoriaPago(pagos[0])
    return {
      dinero: categoria === 'dinero' ? montoTotal : 0,
      saldoFavor: categoria === 'saldoFavor' ? montoTotal : 0,
      ajuste: 0,
      sinClasificar: categoria === 'sinClasificar' ? montoTotal : 0,
    }
  }

  const sumaDeclarada = montosDeclarados.reduce((suma, monto) => suma + (Number.isFinite(monto) ? Math.max(0, monto) : 0), 0)
  if (sumaDeclarada > montoTotal + TOLERANCIA_SALDO) {
    return { dinero: 0, saldoFavor: 0, ajuste: 0, sinClasificar: montoTotal }
  }

  let dinero = 0
  let saldoFavor = 0
  let montoDisponible = montoTotal
  let sinClasificar = Math.max(0, montoTotal - sumaDeclarada)
  pagos.forEach((pago, indice) => {
    const declarado = Number.isFinite(montosDeclarados[indice]) ? Math.max(0, montosDeclarados[indice]) : 0
    const monto = Math.min(montoDisponible, declarado)
    montoDisponible = redondear4(montoDisponible - monto)
    const categoria = categoriaPago(pago)
    if (categoria === 'dinero') dinero += monto
    else if (categoria === 'saldoFavor') saldoFavor += monto
    else sinClasificar += monto
  })

  return {
    dinero: redondear4(dinero),
    saldoFavor: redondear4(saldoFavor),
    ajuste: 0,
    sinClasificar: redondear4(sinClasificar),
  }
}

function montoCobradoEnDinero(abono) {
  return resumenAbono(abono).dinero
}

function montoAbonoSaldoFavor(abono) {
  return resumenAbono(abono).saldoFavor
}

function montoAbonoAjuste(abono) {
  return resumenAbono(abono).ajuste
}

function montoAbonoSinClasificar(abono) {
  return resumenAbono(abono).sinClasificar
}

function distribuirAbonos(movimientos) {
  const cargos = []
  movimientos.forEach(movimiento => {
    if (movimiento.tipo === 'cargo') {
      cargos.push({ ...movimiento, saldo_pendiente_cargo: montoMovimiento(movimiento) })
      return
    }
    if (movimiento.tipo !== 'abono') return

    let restante = montoMovimiento(movimiento)
    if (movimiento.despacho_id) {
      const cargoDirecto = cargos.find(cargo => cargo.despacho_id === movimiento.despacho_id && cargo.saldo_pendiente_cargo > TOLERANCIA_SALDO)
      if (cargoDirecto) {
        const aplicar = Math.min(cargoDirecto.saldo_pendiente_cargo, restante)
        cargoDirecto.saldo_pendiente_cargo = redondear4(cargoDirecto.saldo_pendiente_cargo - aplicar)
        restante = redondear4(restante - aplicar)
      }
    }

    for (const cargo of cargos) {
      if (restante <= TOLERANCIA_SALDO) break
      if (cargo.saldo_pendiente_cargo <= TOLERANCIA_SALDO) continue
      const aplicar = Math.min(cargo.saldo_pendiente_cargo, restante)
      cargo.saldo_pendiente_cargo = redondear4(cargo.saldo_pendiente_cargo - aplicar)
      restante = redondear4(restante - aplicar)
    }
  })

  return cargos.map(cargo => ({
    ...cargo,
    saldo_pendiente_cargo: Math.max(0, cargo.saldo_pendiente_cargo),
    saldo_usd: Math.max(0, cargo.saldo_pendiente_cargo),
  }))
}

/**
 * Construye un estado de CxC al corte junto con los movimientos del rango.
 * El cuadre matemático no certifica integridad del historial; el corte actual se contrasta con saldo_pendiente.
 */
export function construirReportePeriodoCxC({ clientes = [], transacciones = [], rango = null, ahora = new Date() } = {}) {
  const tienePeriodo = Boolean(rango?.from || rango?.to)
  const desdeMs = rango?.from ? inicioDiaCaracas(rango.from) : Number.NEGATIVE_INFINITY
  const finExclusivoMs = rango?.to
    ? timestampDeFechaCaracas(siguienteDiaISO(rango.to))
    : ahora.getTime() + 1
  const fechaCorte = fechaCorteISO(ahora, finExclusivoMs, rango)

  if (rango?.from && rango?.to && rango.from > rango.to) {
    throw new Error('La fecha inicial del reporte no puede ser posterior a la fecha final.')
  }

  const clientesPorId = new Map(clientes.map(cliente => [String(cliente.id), cliente]))
  const movimientosPorCliente = new Map()
  for (const movimiento of transacciones) {
    const clienteId = String(movimiento.cliente_id)
    if (!clientesPorId.has(clienteId) || !['cargo', 'abono'].includes(movimiento.tipo)) continue
    const fechaMs = fechaMovimientoMs(movimiento)
    if (fechaMs === null || fechaMs >= finExclusivoMs) continue
    if (!movimientosPorCliente.has(clienteId)) movimientosPorCliente.set(clienteId, [])
    movimientosPorCliente.get(clienteId).push(movimiento)
  }

  const clientesReporte = []
  const alertasVencimiento = []
  const aging = [
    { rango: '0 – 30 días', count: 0, totalUsd: 0 },
    { rango: '31 – 60 días', count: 0, totalUsd: 0 },
    { rango: '61 – 90 días', count: 0, totalUsd: 0 },
    { rango: '90+ días', count: 0, totalUsd: 0 },
  ]
  const abonos = []
  const movimientosDelPeriodo = []
  let saldoInicialNeto = 0
  let saldoFinalNeto = 0
  let totalCargos = 0
  let totalAbonos = 0
  let totalCobrado = 0
  let totalAbonosSaldoFavor = 0
  let totalAbonosAjuste = 0
  let totalAbonosSinClasificar = 0
  let diferenciaSaldoActual = 0
  let clientesConDiferenciaSaldoActual = 0
  const revisionesSaldoActual = []
  let diasMasAntiguo = 0
  let numCargosPendientes = 0
  const compararConSaldoActual = tienePeriodo && Boolean(rango?.from) && fechaCorte === fechaCaracasISO(ahora)

  clientes.forEach(cliente => {
    const id = String(cliente.id)
    const movimientos = (movimientosPorCliente.get(id) || []).slice().sort((a, b) => {
      const diferencia = fechaMovimientoMs(a) - fechaMovimientoMs(b)
      return diferencia || String(a.id).localeCompare(String(b.id))
    })
    const movimientosPeriodo = tienePeriodo
      ? movimientos.filter(movimiento => {
          const fecha = fechaMovimientoMs(movimiento)
          return fecha >= desdeMs && fecha < finExclusivoMs
        })
      : []
    const movimientosPrevios = rango?.from
      ? movimientos.filter(movimiento => fechaMovimientoMs(movimiento) < desdeMs)
      : tienePeriodo ? [] : movimientos
    const movimientosEnCorte = movimientos.filter(movimiento => fechaMovimientoMs(movimiento) < finExclusivoMs)
    const movimientosAntesDeCierre = movimientos.filter(movimiento => fechaMovimientoMs(movimiento) < finExclusivoMs)
    const netoCierre = tienePeriodo
      ? netoMovimientos(movimientosAntesDeCierre)
      : redondear4(cliente.saldo_pendiente)
    if (compararConSaldoActual) {
      const diferenciaCliente = Math.abs(Math.max(0, netoCierre) - Math.max(0, Number(cliente.saldo_pendiente) || 0))
      if (diferenciaCliente > TOLERANCIA_SALDO) {
        clientesConDiferenciaSaldoActual += 1
        revisionesSaldoActual.push({
          id: cliente.id,
          nombre: cliente.nombre || 'Desconocido',
          saldoLedger: Math.round(Math.max(0, netoCierre) * 100) / 100,
          saldoAlmacenado: Math.round(Math.max(0, Number(cliente.saldo_pendiente) || 0) * 100) / 100,
          diferencia: Math.round(diferenciaCliente * 100) / 100,
        })
      }
      diferenciaSaldoActual += diferenciaCliente
    }
    const netoInicial = rango?.from
      ? netoMovimientos(movimientosPrevios)
      : tienePeriodo ? 0 : netoCierre
    const cargosPeriodo = movimientosPeriodo.filter(movimiento => movimiento.tipo === 'cargo')
    const abonosPeriodo = movimientosPeriodo.filter(movimiento => movimiento.tipo === 'abono')
    const cargosDistribuidos = distribuirAbonos(movimientosEnCorte)
    const cargosActivos = cargosDistribuidos.filter(cargo => cargo.saldo_pendiente_cargo > TOLERANCIA_SALDO)
    const cargosDistribuidosIniciales = distribuirAbonos(movimientosPrevios)
    const cargosAlInicio = cargosDistribuidosIniciales.filter(cargo => cargo.saldo_pendiente_cargo > TOLERANCIA_SALDO)
    const cargosDelPeriodo = cargosPeriodo.map(cargo => {
      const distribuido = cargosDistribuidos.find(item => item.id === cargo.id)
      return { ...cargo, saldo_usd: distribuido?.saldo_usd || 0 }
    })
    const cargosPeriodoNeto = cargosPeriodo.reduce((suma, cargo) => suma + montoMovimiento(cargo), 0)
    const abonosPeriodoNeto = abonosPeriodo.reduce((suma, abono) => suma + montoMovimiento(abono), 0)
    const saldoPeriodoNeto = tienePeriodo
      ? redondear4(netoInicial + cargosPeriodoNeto - abonosPeriodoNeto)
      : netoCierre
    const totalCargosCliente = redondear4(cargosPeriodoNeto)
    const totalAbonosCliente = redondear4(abonosPeriodoNeto)
    const cobradoCliente = redondear4(abonosPeriodo.reduce((suma, abono) => suma + montoCobradoEnDinero(abono), 0))
    const abonosFavorCliente = redondear4(abonosPeriodo.reduce((suma, abono) => suma + montoAbonoSaldoFavor(abono), 0))
    const abonosAjusteCliente = redondear4(abonosPeriodo.reduce((suma, abono) => suma + montoAbonoAjuste(abono), 0))
    const abonosSinClasificarCliente = redondear4(abonosPeriodo.reduce((suma, abono) => suma + montoAbonoSinClasificar(abono), 0))
    const saldoInicial = Math.max(0, netoInicial)
    const saldoCierre = Math.max(0, compararConSaldoActual ? Number(cliente.saldo_pendiente) || 0 : netoCierre)
    const cierreConciliado = redondear4(netoCierre)
    const fechaCorteCivil = fechaCorte
    let mayorAntiguedad = 0
    let diasRestantesMinimos = null

    cargosActivos.forEach(cargo => {
      const fechaCargo = fechaCivil(cargo.creado_en, true)
      const dias = Math.max(0, diferenciaDias(fechaCargo, fechaCorteCivil) ?? 0)
      mayorAntiguedad = Math.max(mayorAntiguedad, dias)
      diasMasAntiguo = Math.max(diasMasAntiguo, dias)
      const indice = dias <= 30 ? 0 : dias <= 60 ? 1 : dias <= 90 ? 2 : 3
      aging[indice].count += 1
      aging[indice].totalUsd += cargo.saldo_pendiente_cargo

      const vencimiento = fechaCivil(cargo.fecha_vencimiento)
      if (vencimiento) {
        const diasRestantes = diferenciaDias(fechaCorteCivil, vencimiento)
        if (diasRestantesMinimos === null || diasRestantes < diasRestantesMinimos) diasRestantesMinimos = diasRestantes
        if (diasRestantes <= 3) {
          alertasVencimiento.push({
            ...cargo,
            cliente_nombre: cliente.nombre || 'Desconocido',
            saldo_usd: cargo.saldo_pendiente_cargo,
            diasRestantes,
          })
        }
      }
    })

    const tieneActividad = movimientosPeriodo.length > 0
    const saldoActualRequiereRevision = compararConSaldoActual && Math.abs(Number(cliente.saldo_pendiente) || 0) > TOLERANCIA_SALDO
    if (Math.abs(netoInicial) <= TOLERANCIA_SALDO && Math.abs(netoCierre) <= TOLERANCIA_SALDO && !tieneActividad && !saldoActualRequiereRevision) return

    const movimientosClienteDelPeriodo = movimientosPeriodo.map(movimiento => ({
      ...movimiento,
      cliente: movimiento.cliente || { nombre: cliente.nombre },
    }))
    const abonosEnRango = movimientosClienteDelPeriodo.filter(movimiento => movimiento.tipo === 'abono')
    movimientosDelPeriodo.push(...movimientosClienteDelPeriodo)
    abonos.push(...abonosEnRango)
    saldoInicialNeto += netoInicial
    saldoFinalNeto += netoCierre
    totalCargos += totalCargosCliente
    totalAbonos += totalAbonosCliente
    totalCobrado += cobradoCliente
    totalAbonosSaldoFavor += abonosFavorCliente
    totalAbonosAjuste += abonosAjusteCliente
    totalAbonosSinClasificar += abonosSinClasificarCliente
    numCargosPendientes += cargosActivos.length

    clientesReporte.push({
      ...cliente,
      saldo_inicial: Math.round(saldoInicial * 100) / 100,
      saldo_inicial_credito: Math.max(0, Math.round(-netoInicial * 100) / 100),
      saldo_inicial_neto: Math.round(netoInicial * 100) / 100,
      cargosAlInicio,
      saldo_final_neto: Math.round(cierreConciliado * 100) / 100,
      saldo_credito_neto: Math.max(0, -netoCierre),
      saldo_final_esperado: Math.round(saldoPeriodoNeto * 100) / 100,
      diferencia_conciliacion: compararConSaldoActual
        ? Math.round((Math.max(0, netoCierre) - Math.max(0, Number(cliente.saldo_pendiente) || 0)) * 100) / 100
        : null,
      saldo_pendiente: Math.round(saldoCierre * 100) / 100,
      monto_otorgado: Math.round(totalCargosCliente * 100) / 100,
      monto_cobrado: Math.round(cobradoCliente * 100) / 100,
      total_abonado_periodo: Math.round(totalAbonosCliente * 100) / 100,
      diasSinPago: mayorAntiguedad,
      diasRestantes: diasRestantesMinimos,
      cargosActivos,
      cargosDelPeriodo,
      abonosEnRango,
      movimientosEnRango: movimientosClienteDelPeriodo,
    })
  })

  const totalDeuda = Math.round(clientesReporte.reduce((suma, cliente) => suma + cliente.saldo_pendiente, 0) * 100) / 100
  const clientesAlCierre = clientesReporte.filter(cliente => cliente.saldo_pendiente > TOLERANCIA_SALDO)
  const clientesConDeuda = clientesAlCierre.length
  const promedioDeuda = clientesConDeuda > 0 ? totalDeuda / clientesConDeuda : 0
  aging.forEach(bucket => { bucket.totalUsd = Math.round(bucket.totalUsd * 100) / 100 })
  abonos.sort((a, b) => fechaMovimientoMs(b) - fechaMovimientoMs(a))

  return {
    clientesConDeuda: clientesAlCierre,
    revisionesSaldoActual,
    clientesDelPeriodo: clientesReporte,
    aging,
    alertasVencimiento: alertasVencimiento.sort((a, b) => a.diasRestantes - b.diasRestantes),
    abonos,
    movimientosDelPeriodo: movimientosDelPeriodo.sort((a, b) => fechaMovimientoMs(a) - fechaMovimientoMs(b)),
    kpis: {
      totalDeuda,
      totalOtorgado: Math.round((tienePeriodo ? totalCargos : totalDeuda) * 100) / 100,
      totalCargos: Math.round(totalCargos * 100) / 100,
      totalAbonos: Math.round(totalAbonos * 100) / 100,
      totalCobrado: Math.round(totalCobrado * 100) / 100,
      totalAbonosSaldoFavor: Math.round(totalAbonosSaldoFavor * 100) / 100,
      totalAbonosAjuste: Math.round(totalAbonosAjuste * 100) / 100,
      totalAbonosSinClasificar: Math.round(totalAbonosSinClasificar * 100) / 100,
      saldoActualComparado: compararConSaldoActual,
      diferenciaSaldoActual: compararConSaldoActual ? Math.round(diferenciaSaldoActual * 100) / 100 : null,
      clientesConDiferenciaSaldoActual: compararConSaldoActual ? clientesConDiferenciaSaldoActual : null,
      saldoInicial: Math.round(clientesReporte.reduce((suma, cliente) => suma + cliente.saldo_inicial, 0) * 100) / 100,
      saldoInicialCredito: Math.round(clientesReporte.reduce((suma, cliente) => suma + cliente.saldo_inicial_credito, 0) * 100) / 100,
      saldoInicialNeto: Math.round(saldoInicialNeto * 100) / 100,
      saldoFinalNeto: Math.round(saldoFinalNeto * 100) / 100,
      saldoFinalEsperado: Math.round((tienePeriodo ? saldoInicialNeto + totalCargos - totalAbonos : saldoFinalNeto) * 100) / 100,
      // Un corte histórico solo puede mostrar el cuadre de los movimientos cargados,
      // no certificar que el ledger esté completo. Para hoy sí contrasta contra clientes.saldo_pendiente.
      diferenciaConciliacion: compararConSaldoActual ? Math.round(diferenciaSaldoActual * 100) / 100 : null,
      diferenciaCuadreMovimientos: tienePeriodo ? Math.round((saldoFinalNeto - (saldoInicialNeto + totalCargos - totalAbonos)) * 100) / 100 : null,
      saldoCreditoInicial: Math.round(clientesReporte.reduce((suma, cliente) => suma + Math.max(0, -cliente.saldo_inicial_neto), 0) * 100) / 100,
      saldoCreditoFinal: Math.round(clientesReporte.reduce((suma, cliente) => suma + cliente.saldo_credito_neto, 0) * 100) / 100,
      promedioDeuda: Math.round(promedioDeuda * 100) / 100,
      numClientesConDeuda: clientesConDeuda,
      numClientesConActividad: clientesReporte.length,
      diasMasAntiguo,
      numCargos: numCargosPendientes,
      totalSaldoFavorClientes: 0,
      numClientesConSaldoFavor: 0,
    },
  }
}
