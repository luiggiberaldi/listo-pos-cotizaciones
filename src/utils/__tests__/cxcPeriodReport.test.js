import { describe, expect, it } from 'vitest'
import { construirReportePeriodoCxC, obtenerLimiteSuperiorCxC } from '../cxcPeriodReport'

const cliente = { id: 'cliente-1', nombre: 'Cliente Uno', saldo_pendiente: 115 }
const movimiento = (id, tipo, monto, creadoEn, extra = {}) => ({ id, cliente_id: cliente.id, tipo, monto_usd: monto, creado_en: creadoEn, ...extra })
const rangoSeptiembre = { from: '2026-09-01', to: '2026-09-30' }

describe('construirReportePeriodoCxC', () => {
  it('reconstruye saldo inicial y de cierre al corte ignorando actividad posterior', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [
        movimiento('cargo-inicial', 'cargo', 100, '2026-08-25T14:00:00-04:00'),
        movimiento('cargo-periodo', 'cargo', 40, '2026-09-10T14:00:00-04:00'),
        movimiento('abono-periodo', 'abono', 25, '2026-09-20T14:00:00-04:00', { forma_pago_abono: 'Efectivo $' }),
        movimiento('cargo-posterior', 'cargo', 500, '2026-10-01T04:00:00.000Z'),
        movimiento('abono-posterior', 'abono', 30, '2026-10-02T14:00:00-04:00'),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.saldoInicialNeto).toBe(100)
    expect(reporte.kpis.totalCargos).toBe(40)
    expect(reporte.kpis.totalAbonos).toBe(25)
    expect(reporte.kpis.saldoFinalNeto).toBe(115)
    expect(reporte.kpis.saldoFinalEsperado).toBe(115)
    expect(reporte.kpis.diferenciaCuadreMovimientos).toBe(0)
    expect(reporte.kpis.diferenciaConciliacion).toBeNull()
    expect(reporte.kpis.totalCobrado).toBe(25)
    expect(reporte.kpis.totalDeuda).toBe(115)
    expect(reporte.movimientosDelPeriodo.map(({ id }) => id)).toEqual(['cargo-periodo', 'abono-periodo'])
  })

  it('incluye ambos extremos civiles del rango y excluye la medianoche siguiente', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [
        movimiento('antes-inicio', 'cargo', 1, '2026-09-01T03:59:59.999Z'),
        movimiento('inicio', 'cargo', 10, '2026-09-01T04:00:00.000Z'),
        movimiento('fin', 'abono', 2, '2026-10-01T03:59:59.999Z'),
        movimiento('despues-fin', 'abono', 3, '2026-10-01T04:00:00.000Z'),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.saldoInicialNeto).toBe(1)
    expect(reporte.kpis.totalCargos).toBe(10)
    expect(reporte.kpis.totalAbonos).toBe(2)
    expect(reporte.kpis.saldoFinalNeto).toBe(9)
    expect(reporte.movimientosDelPeriodo.map(({ id }) => id)).toEqual(['inicio', 'fin'])
  })

  it('separa cobro monetario de cruce interno en un abono multiforma', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [
        movimiento('cargo', 'cargo', 100, '2026-09-02T12:00:00-04:00'),
        movimiento('abono-mixto', 'abono', 30, '2026-09-03T12:00:00-04:00', {
          forma_pago_abono: JSON.stringify([{ metodo: 'Efectivo $', monto: 20 }, { metodo: 'Saldo a favor', monto: 10 }]),
        }),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.totalAbonos).toBe(30)
    expect(reporte.kpis.totalCobrado).toBe(20)
    expect(reporte.kpis.totalAbonosSaldoFavor).toBe(10)
    expect(reporte.kpis.saldoFinalNeto).toBe(70)
  })

  it('separa del dinero métodos desconocidos y montos de abonos incompletamente declarados', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [
        movimiento('cargo', 'cargo', 100, '2026-09-02T12:00:00-04:00'),
        movimiento('abono-sin-metodo', 'abono', 5, '2026-09-03T12:00:00-04:00'),
        movimiento('abono-desconocido', 'abono', 7, '2026-09-04T12:00:00-04:00', { forma_pago_abono: 'Cheque' }),
        movimiento('abono-split-incompleto', 'abono', 20, '2026-09-05T12:00:00-04:00', {
          forma_pago_abono: JSON.stringify([{ metodo: 'Efectivo $', monto: 12 }, { metodo: 'Método desconocido' }]),
        }),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.totalAbonos).toBe(32)
    expect(reporte.kpis.totalCobrado).toBe(12)
    expect(reporte.kpis.totalAbonosSinClasificar).toBe(20)
  })

  it('limita a la deuda reportada montos de medios que exceden por fracciones de centavo', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [
        movimiento('cargo', 'cargo', 100, '2026-09-02T12:00:00-04:00'),
        movimiento('abono', 'abono', 100, '2026-09-03T12:00:00-04:00', {
          forma_pago_abono: JSON.stringify([{ metodo: 'Efectivo $', monto: 60 }, { metodo: 'Zelle', monto: 40.004 }]),
        }),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.totalCobrado).toBe(100)
  })

  it('no declara conciliado el saldo de hoy si el ledger difiere del saldo almacenado', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [{ ...cliente, saldo_pendiente: 80 }],
      transacciones: [movimiento('cargo', 'cargo', 100, '2026-09-30T10:00:00-04:00')],
      rango: { from: '2026-09-01', to: '2026-09-30' },
      ahora: new Date('2026-09-30T12:00:00-04:00'),
    })

    expect(reporte.kpis.saldoActualComparado).toBe(true)
    expect(reporte.kpis.diferenciaSaldoActual).toBe(20)
    expect(reporte.kpis.clientesConDiferenciaSaldoActual).toBe(1)
    expect(reporte.kpis.totalDeuda).toBe(80)
    expect(reporte.clientesConDeuda[0].diferencia_conciliacion).toBe(20)
  })

  it('no compara saldos actuales contra cortes históricos', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [movimiento('cargo', 'cargo', 100, '2026-09-10T10:00:00-04:00')],
      rango: { from: '2026-09-01', to: '2026-09-20' },
      ahora: new Date('2026-09-30T12:00:00-04:00'),
    })

    expect(reporte.kpis.saldoActualComparado).toBe(false)
    expect(reporte.kpis.diferenciaSaldoActual).toBeNull()
  })

  it('mantiene en actividad cargos totalmente saldados dentro del período', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [{ ...cliente, saldo_pendiente: 0 }],
      transacciones: [
        movimiento('cargo', 'cargo', 75, '2026-09-02T12:00:00-04:00'),
        movimiento('abono', 'abono', 75, '2026-09-03T12:00:00-04:00'),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.totalDeuda).toBe(0)
    expect(reporte.clientesConDeuda).toHaveLength(0)
    expect(reporte.clientesDelPeriodo).toHaveLength(1)
    expect(reporte.movimientosDelPeriodo).toHaveLength(2)
  })

  it('preserva el resumen sin rango para clientes seleccionados por saldo actual', () => {
    const reporte = construirReportePeriodoCxC({ clientes: [{ ...cliente, saldo_pendiente: 42.5 }], transacciones: [] })
    expect(reporte.kpis.totalDeuda).toBe(42.5)
    expect(reporte.kpis.saldoFinalNeto).toBe(42.5)
    expect(reporte.kpis.saldoInicialNeto).toBe(42.5)
    expect(reporte.clientesConDeuda).toHaveLength(1)
  })

  it('mantiene saldo inicial cero en el rango con solo límite superior', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [cliente],
      transacciones: [movimiento('cargo', 'cargo', 25, '2026-09-25T12:00:00-04:00')],
      rango: { to: '2026-09-30' },
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })
    expect(reporte.kpis.saldoInicialNeto).toBe(0)
    expect(reporte.kpis.saldoFinalNeto).toBe(25)
    expect(reporte.kpis.saldoFinalEsperado).toBe(25)
  })

  it('calcula el límite superior exclusivo a medianoche de Caracas del día siguiente', () => {
    expect(obtenerLimiteSuperiorCxC(rangoSeptiembre)).toBe('2026-10-01T00:00:00-04:00')
  })

  // OP-2026-062: caso real (Osniel Coronel) — el pago quedó registrado horas antes
  // que la nota que también pagaba. El sobrante no debe perderse.
  it('aplica a cargos posteriores el sobrante de un abono registrado antes que el cargo', () => {
    const clienteAlDia = { ...cliente, saldo_pendiente: 0 }
    const reporte = construirReportePeriodoCxC({
      clientes: [clienteAlDia],
      transacciones: [
        movimiento('cargo-a', 'cargo', 649.64, '2026-09-02T10:00:00-04:00', { fecha_vencimiento: '2026-09-17' }),
        movimiento('abono-adelantado', 'abono', 951.56, '2026-09-03T12:45:00-04:00', { forma_pago_abono: 'Zelle' }),
        movimiento('cargo-b', 'cargo', 301.92, '2026-09-03T16:52:00-04:00', { fecha_vencimiento: '2026-09-18' }),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.totalDeuda).toBe(0)
    expect(reporte.aging.reduce((suma, tramo) => suma + tramo.totalUsd, 0)).toBe(0)
    expect(reporte.aging.reduce((suma, tramo) => suma + tramo.count, 0)).toBe(0)
    expect(reporte.alertasVencimiento).toHaveLength(0)
  })

  it('descuenta el saldo a favor previo de un cargo nuevo pequeño (sin deuda fantasma)', () => {
    const clienteConFavor = { ...cliente, saldo_pendiente: 0 }
    const reporte = construirReportePeriodoCxC({
      clientes: [clienteConFavor],
      transacciones: [
        movimiento('favor-1', 'abono', 8.1, '2026-08-16T12:00:00-04:00', { forma_pago_abono: 'Saldo a favor' }),
        movimiento('cargo-chico', 'cargo', 0.34, '2026-09-18T16:00:00-04:00', { fecha_vencimiento: '2026-09-26' }),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.saldoInicialNeto).toBe(-8.1)
    expect(reporte.kpis.saldoFinalNeto).toBe(-7.76)
    expect(reporte.kpis.totalDeuda).toBe(0)
    expect(reporte.aging.reduce((suma, tramo) => suma + tramo.totalUsd, 0)).toBe(0)
    expect(reporte.alertasVencimiento).toHaveLength(0)
  })

  it('la antigüedad de deuda suma lo mismo que la deuda al cierre con pagos parciales', () => {
    const reporte = construirReportePeriodoCxC({
      clientes: [{ ...cliente, saldo_pendiente: 70 }],
      transacciones: [
        movimiento('abono-previo', 'abono', 30, '2026-09-01T09:00:00-04:00', { forma_pago_abono: 'Efectivo $' }),
        movimiento('cargo-1', 'cargo', 60, '2026-09-02T10:00:00-04:00'),
        movimiento('cargo-2', 'cargo', 40, '2026-09-05T10:00:00-04:00'),
      ],
      rango: rangoSeptiembre,
      ahora: new Date('2026-10-05T12:00:00-04:00'),
    })

    expect(reporte.kpis.totalDeuda).toBe(70)
    expect(reporte.aging.reduce((suma, tramo) => suma + tramo.totalUsd, 0)).toBe(70)
  })
})
