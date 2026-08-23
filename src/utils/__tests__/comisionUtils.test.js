import { describe, expect, it } from 'vitest'
import {
  adjustLegacyCommissionForExcludedProducts,
  calcularTotalCorte,
  countUniqueDispatches,
  getCommissionablePaymentSplit,
  isDonationPayment,
  isLoanPayment,
  parsePaymentMethods,
} from '../comisionUtils'

describe('contrato de comisiones', () => {
  it('excluye una cuenta por cobrar completa', () => {
    const split = getCommissionablePaymentSplit({
      totalUsd: 100,
      formaPago: 'Cta por cobrar',
    })

    expect(split.cxcAmount).toBe(100)
    expect(split.nonCxcAmount).toBe(0)
    expect(split.fraction).toBe(0)
  })

  it('suma solo la porcion no CxC en un pago mixto', () => {
    const split = getCommissionablePaymentSplit({
      totalUsd: 100,
      formaPago: [
        { metodo: 'Efectivo $', monto: 60 },
        { metodo: 'Cta por cobrar', monto: 40 },
      ],
    })

    expect(split.cxcAmount).toBe(40)
    expect(split.nonCxcAmount).toBe(60)
    expect(split.fraction).toBe(0.6)
  })

  it('resuelve COD con sus metodos_pagados definitivos', () => {
    const methods = parsePaymentMethods([
      {
        metodo: 'Cobro a destino',
        monto: 100,
        cobro_destino_pagado: true,
        metodos_pagados: [{ metodo: 'Efectivo', monto: 100 }],
      },
    ])
    const split = getCommissionablePaymentSplit({ totalUsd: 100, formaPago: methods })

    expect(methods).toEqual([{ metodo: 'Efectivo', monto: 100 }])
    expect(split.cxcAmount).toBe(0)
    expect(split.nonCxcAmount).toBe(100)
  })

  it('soporta JSON legacy y credito sin monto', () => {
    const split = getCommissionablePaymentSplit({
      totalUsd: 240,
      formaPagoCliente: '[{"metodo":"Efectivo $","monto":140},{"metodo":"Cta por cobrar"}]',
    })

    expect(split.cxcAmount).toBe(100)
    expect(split.nonCxcAmount).toBe(140)
  })

  it('reconoce las exclusiones de donacion y prestamo', () => {
    expect(isDonationPayment([{ metodo: 'Donación', monto: 20 }])).toBe(true)
    expect(isLoanPayment([{ metodo: 'Préstamo', monto: 20 }])).toBe(true)
    expect(isDonationPayment([{ metodo: 'Efectivo $', monto: 20 }])).toBe(false)
    expect(isLoanPayment([{ metodo: 'Efectivo $', monto: 20 }])).toBe(false)
  })

  it('calcula el total resumido con ajustes manuales', () => {
    expect(calcularTotalCorte(100, 25, 10)).toBe(115)
    expect(calcularTotalCorte(100, 0, 0)).toBe(100)
  })

  it('cuenta despachos unicos aunque existan varias filas de producto', () => {
    expect(countUniqueDispatches([
      { despachoid: 'dispatch-1' },
      { despachoid: 'dispatch-1' },
      { despacho: { id: 'dispatch-2' } },
      { despacho: { numero: 3003 } },
    ])).toBe(3)
  })

  it('descuenta la parte legacy de un prestamo mixto sin reasignarla', () => {
    const adjustment = adjustLegacyCommissionForExcludedProducts({
      products: [
        { nombre_snap: 'ZUNCHO VALIDO', total_linea_usd: 100 },
        { nombre_snap: 'MATERIAL EN PRESTAMO', total_linea_usd: 100, es_prestamo: true },
      ],
      comisioncabilla: 0,
      comisionotros: 6,
      config: { comision_pct_otros: 3 },
    })

    expect(adjustment.applied).toBe(true)
    expect(adjustment.otros).toBe(3)
    expect(adjustment.total).toBe(3)
  })
})
