import { describe, it, expect } from 'vitest'
import {
  construirVentasDia, columnaDeMetodo, validarFechaVentasDia, numerosFaltantes,
  montoMostrado, cuadreEfectivo, fechaVenezuela,
} from '../ventasDia.js'

const fp = arr => JSON.stringify(arr)
const D = (numero, pagos, extra = {}) => ({
  id: `d${numero}`, numero, cliente_id: 'c1', estado: 'despachada',
  creado_en: '2026-10-24T14:00:00+00:00',
  total_usd: pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0),
  forma_pago: fp(pagos), ...extra,
})

describe('ventasDia', () => {
  it('clasifica cada forma de pago en su columna', () => {
    expect(columnaDeMetodo('Efectivo $')).toBe('efectivoUsd')
    expect(columnaDeMetodo('Efectivo Bs')).toBe('efectivoBs')
    expect(columnaDeMetodo('Transf. / Pago Móvil')).toBe('pagoMovil')
    expect(columnaDeMetodo('Pago móvil')).toBe('pagoMovil')
    expect(columnaDeMetodo('Punto de Venta')).toBe('punto')
    expect(columnaDeMetodo('Zelle')).toBe('zelle')
    expect(columnaDeMetodo('USDT')).toBe('usdt')
    expect(columnaDeMetodo('Cta por cobrar')).toBe('porCobrar')
    expect(columnaDeMetodo('Cobro a destino')).toBe('cobroDestino')
    expect(columnaDeMetodo('Cruce')).toBe('otros')
    expect(columnaDeMetodo('Donación')).toBe('otros')
  })

  it('valida la fecha y arma el día de Venezuela', () => {
    expect(validarFechaVentasDia('2026-10-24')).toEqual({ fecha: '2026-10-24', desdeTs: '2026-10-24T00:00:00-04:00', hastaTs: '2026-10-25T00:00:00-04:00' })
    expect(validarFechaVentasDia('24-10-2026').error).toBeTruthy()
    expect(validarFechaVentasDia(null).error).toBeTruthy()
    expect(fechaVenezuela('2026-10-25T02:00:00Z')).toBe('2026-10-24')
  })

  it('reproduce la hoja de papel del 24-10-2026 (subtotales y total)', () => {
    const tasa = 1012
    // Bs de la hoja convertidos a dólares, como los guarda el sistema
    const bs = v => Math.round((v / tasa) * 100) / 100
    const despachos = [
      D(4248, [{ metodo: 'Transf. / Pago Móvil', monto: bs(21150.80) }]),
      D(4251, [{ metodo: 'Efectivo $', monto: 41 }, { metodo: 'Transf. / Pago Móvil', monto: bs(293.48) }]),
      D(4252, [{ metodo: 'Efectivo $', monto: 499.80 }]),
      D(4268, [{ metodo: 'Efectivo $', monto: 80 }, { metodo: 'Transf. / Pago Móvil', monto: bs(600) }, { metodo: 'Cta por cobrar', monto: 20 }]),
      D(4270, [{ metodo: 'Efectivo $', monto: 0 }]),
    ]
    const r = construirVentasDia({ fecha: '2026-10-24', despachos, clientes: [{ id: 'c1', nombre: 'Cliente' }] })
    expect(r.filas.map(f => f.numero)).toEqual([4248, 4251, 4252, 4268, 4270])
    expect(r.totales.efectivoUsd).toBe(620.8)
    expect(r.totales.porCobrar).toBe(20)
    expect(r.resumen.porCobrarUsd).toBe(20)
    expect(r.resumen.totalVendidoUsd).toBe(r.resumen.cobradoUsd + 20)
    expect(r.filas.at(-1).avisos).toContain('Sin pago registrado')
    expect(r.columnasUsadas).toEqual(['efectivoUsd', 'pagoMovil', 'porCobrar'])
    // Bs mostrados con la tasa del día (redondeo de centavos)
    expect(Math.abs(montoMostrado('pagoMovil', r.filas[0].montos.pagoMovil, tasa) - 21150.80)).toBeLessThan(6)
  })

  it('ordena por número, deja fuera las anuladas y explica las notas que faltan', () => {
    const despachos = [
      D(102, [{ metodo: 'Zelle', monto: 10 }]),
      D(100, [{ metodo: 'Zelle', monto: 10 }]),
      D(101, [{ metodo: 'Zelle', monto: 10 }], { estado: 'anulada' }),
      D(105, [{ metodo: 'Zelle', monto: 10 }]),
    ]
    expect(numerosFaltantes(despachos)).toEqual([101, 103, 104])
    const r = construirVentasDia({
      fecha: '2026-10-24', despachos,
      otrosNumeros: [{ numero: 103, estado: 'entregada', creado_en: '2026-10-23T15:00:00Z' }],
    })
    expect(r.filas.map(f => f.numero)).toEqual([100, 102, 105])
    expect(r.filas.map(f => f.item)).toEqual([1, 2, 3])
    expect(r.faltantes).toEqual([
      { numero: 101, motivo: 'Anulada' },
      { numero: 103, motivo: 'Es de otro día (23/10/2026)' },
      { numero: 104, motivo: 'No existe en el sistema' },
    ])
    expect(r.resumen.totalVendidoUsd).toBe(30)
  })

  it('junta las referencias de pago y avisa si los pagos no cuadran o está pendiente', () => {
    const r = construirVentasDia({
      fecha: '2026-10-24',
      despachos: [
        { ...D(1, [{ metodo: 'Transf. / Pago Móvil', monto: 50, referencia: ' 123456 ' }]), referencia_pago: '999', estado: 'pendiente' },
        { ...D(2, [{ metodo: 'Efectivo $', monto: 40 }]), total_usd: 50 },
      ],
    })
    expect(r.filas[0].referencias).toEqual(['123456', '999'])
    expect(r.filas[0].avisos).toContain('Pendiente de aprobar')
    expect(r.filas[1].avisos[0]).toMatch(/no cuadran/)
  })

  it('cobro al entregar y crédito no cuentan como dinero cobrado; donación va a otros', () => {
    const r = construirVentasDia({
      fecha: '2026-10-24',
      despachos: [
        D(1, [{ metodo: 'Cobro a destino', monto: 100, cobro_destino_pagado: false }]),
        D(2, [{ metodo: 'Donación', monto: 5 }]),
        D(3, [{ metodo: 'Efectivo Bs', monto: 10 }]),
      ],
    })
    expect(r.resumen.cobradoUsd).toBe(10)
    expect(r.resumen.porCobrarUsd).toBe(100)
    expect(r.resumen.otrosUsd).toBe(5)
    expect(r.resumen.totalVendidoUsd).toBe(115)
    expect(r.filas[1].otrosDetalle).toEqual(['Donación'])
  })

  it('cuadre de efectivo', () => {
    expect(cuadreEfectivo(813.76, '')).toBeNull()
    expect(cuadreEfectivo(813.76, 813.76).estado).toBe('cuadra')
    expect(cuadreEfectivo(813.76, 800)).toEqual({ esperado: 813.76, contado: 800, diferencia: -13.76, estado: 'falta' })
    expect(cuadreEfectivo(813.76, 820).estado).toBe('sobra')
  })

  it('montoMostrado: Bs sin tasa queda vacío', () => {
    expect(montoMostrado('pagoMovil', 10, 0)).toBeNull()
    expect(montoMostrado('efectivoUsd', 10, 0)).toBe(10)
  })
})

describe('ventasDia: bolívares reales', () => {
  it('usa monto_bs cuando el pago lo trae y la tasa cuando no', async () => {
    const { montoFila, subtotalMostrado } = await import('../ventasDia.js')
    const r = construirVentasDia({
      fecha: '2026-10-24',
      despachos: [
        D(1, [{ metodo: 'Transf. / Pago Móvil', monto: 0.99, monto_bs: 1000 }]),
        D(2, [{ metodo: 'Transf. / Pago Móvil', monto: 1 }]),
      ],
    })
    expect(montoFila(r.filas[0], 'pagoMovil', 1012)).toBe(1000)
    expect(montoFila(r.filas[1], 'pagoMovil', 1012)).toBe(1012)
    expect(subtotalMostrado(r, 'pagoMovil', 1012)).toBe(2012)
    expect(subtotalMostrado(r, 'pagoMovil', 0)).toBeNull()
  })
})
