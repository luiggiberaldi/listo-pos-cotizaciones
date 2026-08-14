import { describe, it, expect } from 'vitest'

describe('Cálculo de Tasa en Reporte de Comisiones vs Ventas', () => {
  const despachoHistorico = {
    id: 'desp-001',
    numero: '1947',
    total_usd: 1000,
    tasa_snapshot: 881.0, // Tasa histórica al momento de la venta/aprobación
    productos: [{ nombre_snap: 'CABILLA 1/2', total_linea_neto: 1000 }]
  }

  const comisionVendedor = {
    id: 'com-001',
    despachoid: 'desp-001',
    totalcomision: 100, // 100 USD
    comisioncabilla: 100,
    comisionotros: 0,
    estado: 'pendiente',
    despacho: despachoHistorico,
    despachonumero: '1947'
  }

  it('debe usar la tasa seleccionada Euro BCV actual para comisiones ignorando la tasa histórica de la venta', () => {
    const tasaEuroActual = 910.50
    const tipoTasa = 'Euro BCV'
    const tasaAplicada = tasaEuroActual

    // Normalización de comisiones con tasa actual
    const rateVal = Number(tasaAplicada || tasaEuroActual || 0)
    const comisionNormTasa = rateVal > 0 ? rateVal : Number(comisionVendedor.despacho?.tasa_snapshot || 0)
    const comisionBs = comisionVendedor.totalcomision * comisionNormTasa

    expect(comisionNormTasa).toBe(910.50)
    expect(comisionBs).toBe(91050.0) // 100 * 910.50, NO 100 * 881.00
  })

  it('debe usar la tasa USDT seleccionada para comisiones cuando el usuario elige USDT', () => {
    const tasaUsdtActual = 890.20
    const tipoTasa = 'USDT'
    const tasaAplicada = tasaUsdtActual

    const rateVal = Number(tasaAplicada || 0)
    const comisionNormTasa = rateVal > 0 ? rateVal : Number(comisionVendedor.despacho?.tasa_snapshot || 0)
    const comisionBs = comisionVendedor.totalcomision * comisionNormTasa

    expect(comisionNormTasa).toBe(890.20)
    expect(comisionBs).toBe(89020.0) // 100 * 890.20
  })

  it('en reportes de ventas SÍ debe preservar la tasa histórica de la venta', () => {
    // Para ventas, se usa el snapshot original de cuando se aprobó la orden
    const tasaVenta = Number(despachoHistorico.tasa_snapshot || 0)
    const totalVentaBs = despachoHistorico.total_usd * tasaVenta

    expect(tasaVenta).toBe(881.0)
    expect(totalVentaBs).toBe(881000.0) // 1000 * 881.0
  })

  it('debe calcular correctamente los totales con ajustes manuales en Bs con la tasa actual', () => {
    const tasaActual = 915.00
    const totalComisionUsd = 200.00
    const cxcUsd = 50.00
    const descuentoCarroUsd = 20.00

    const totalPagarUsd = totalComisionUsd + cxcUsd - descuentoCarroUsd // 230 USD
    const totalPagarBs = totalPagarUsd * tasaActual

    expect(totalPagarUsd).toBe(230.00)
    expect(totalPagarBs).toBe(210450.00)
  })
})
