import { describe, it, expect } from 'vitest'
import { calcTotales } from '../calcTotales'

describe('calcTotales', () => {
  it('items vacios retorna subtotal 0 y totalUsd = costoEnvio', () => {
    const r = calcTotales([], 0, 10, 0)
    expect(r.subtotal).toBe(0)
    expect(r.totalUsd).toBe(10)
    expect(r.ivaUsd).toBe(0)
    expect(r.descuentoUsd).toBe(0)
  })

  it('items null retorna subtotal 0 y totalUsd = costoEnvio', () => {
    const r = calcTotales(null, 0, 5, 0)
    expect(r.subtotal).toBe(0)
    expect(r.totalUsd).toBe(5)
  })

  it('items undefined retorna subtotal 0', () => {
    const r = calcTotales(undefined, 0, 0, 0)
    expect(r.subtotal).toBe(0)
    expect(r.totalUsd).toBe(0)
  })

  it('un item basico: 2 x $10 = $20', () => {
    const items = [{ cantidad: 2, precioUnitUsd: 10 }]
    const r = calcTotales(items, 0, 0, 0)
    expect(r.subtotal).toBe(20)
    expect(r.totalUsd).toBe(20)
  })

  it('multiples items suman correctamente', () => {
    const items = [
      { cantidad: 3, precioUnitUsd: 10 },
      { cantidad: 2, precioUnitUsd: 5.5 },
    ]
    const r = calcTotales(items, 0, 0, 0)
    expect(r.subtotal).toBe(41)
    expect(r.totalUsd).toBe(41)
  })

  it('costoEnvio se suma al total', () => {
    const items = [{ cantidad: 1, precioUnitUsd: 100 }]
    const r = calcTotales(items, 0, 15, 0)
    expect(r.subtotal).toBe(100)
    expect(r.totalUsd).toBe(115)
  })

  it('IVA 16% se calcula sobre subtotal (no sobre envio)', () => {
    const items = [{ cantidad: 1, precioUnitUsd: 100 }]
    const r = calcTotales(items, 0, 0, 16)
    expect(r.ivaUsd).toBe(16)
    expect(r.totalUsd).toBe(116)
  })

  it('IVA 0 no agrega nada', () => {
    const items = [{ cantidad: 1, precioUnitUsd: 50 }]
    const r = calcTotales(items, 0, 0, 0)
    expect(r.ivaUsd).toBe(0)
    expect(r.totalUsd).toBe(50)
  })

  it('caso completo: items + envio + IVA 16%', () => {
    const items = [
      { cantidad: 5, precioUnitUsd: 20 },  // 100
      { cantidad: 10, precioUnitUsd: 3 },   // 30
    ]
    const r = calcTotales(items, 0, 25, 16)
    expect(r.subtotal).toBe(130)
    expect(r.ivaUsd).toBe(20.8)    // 130 * 0.16
    expect(r.totalUsd).toBe(175.8)  // 130 + 20.8 + 25
  })

  it('descuentoUsd siempre es 0 (campo deprecado)', () => {
    const items = [{ cantidad: 1, precioUnitUsd: 100 }]
    const r = calcTotales(items, 50, 0, 0)
    expect(r.descuentoUsd).toBe(0)
  })

  it('items con cantidad o precio null se tratan como 0', () => {
    const items = [
      { cantidad: null, precioUnitUsd: 10 },
      { cantidad: 5, precioUnitUsd: null },
    ]
    const r = calcTotales(items, 0, 0, 0)
    expect(r.subtotal).toBe(0)
  })

  it('items con strings numericos funcionan', () => {
    const items = [{ cantidad: '3', precioUnitUsd: '10.5' }]
    const r = calcTotales(items, 0, 0, 0)
    expect(r.subtotal).toBe(31.5)
  })

  it('costoEnvio null se trata como 0', () => {
    const items = [{ cantidad: 1, precioUnitUsd: 10 }]
    const r = calcTotales(items, 0, null, 0)
    expect(r.totalUsd).toBe(10)
  })

  it('ivaPct no proporcionado usa default 0', () => {
    const items = [{ cantidad: 1, precioUnitUsd: 100 }]
    const r = calcTotales(items, 0, 0)
    expect(r.ivaUsd).toBe(0)
    expect(r.totalUsd).toBe(100)
  })
})
