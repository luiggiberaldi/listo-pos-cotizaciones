import { describe, it, expect } from 'vitest'
import { preciosVentaVisibles, precioVentaBase, sinPrecioVenta } from '../precioVenta'

describe('precioVenta — regla: el precio 0 no es vendible', () => {
  it('un producto con precio mayor que 0 es vendible', () => {
    const p = { precio_usd: 1.89 }
    expect(precioVentaBase(p)).toBe(1.89)
    expect(sinPrecioVenta(p)).toBe(false)
    expect(preciosVentaVisibles(p)).toEqual([1.89])
  })

  it('un producto con precio 0 no es vendible', () => {
    const p = { precio_usd: 0 }
    expect(precioVentaBase(p)).toBeNull()
    expect(sinPrecioVenta(p)).toBe(true)
  })

  it('un producto sin precio (null o vacío) no es vendible', () => {
    expect(sinPrecioVenta({ precio_usd: null })).toBe(true)
    expect(sinPrecioVenta({})).toBe(true)
    expect(sinPrecioVenta(null)).toBe(true)
  })

  it('un precio negativo tampoco es vendible', () => {
    expect(sinPrecioVenta({ precio_usd: -2 })).toBe(true)
  })

  it('si el P1 está en 0 pero P2 tiene precio, se vende con el primero disponible', () => {
    const p = { precio_usd: 0, precio_2: 5, precio2_habilitado: true }
    expect(precioVentaBase(p)).toBe(5)
    expect(sinPrecioVenta(p)).toBe(false)
  })

  it('los precios ocultos (deshabilitados) no cuentan como precio de venta', () => {
    const p = { precio_usd: 0, precio_2: 5, precio2_habilitado: false }
    expect(precioVentaBase(p)).toBeNull()
    expect(sinPrecioVenta(p)).toBe(true)
  })

  it('P3 también sirve como precio de venta', () => {
    const p = { precio_usd: 0, precio_2: null, precio_3: 8.5, precio3_habilitado: true }
    expect(precioVentaBase(p)).toBe(8.5)
  })

  it('acepta el campo legacy preciousd', () => {
    expect(sinPrecioVenta({ preciousd: 3.2 })).toBe(false)
    expect(sinPrecioVenta({ preciousd: 0 })).toBe(true)
  })

  it('preciosVentaVisibles devuelve solo los precios visibles, en orden', () => {
    const p = { precio_usd: 1, precio_2: 2, precio_3: 3, precio2_habilitado: true, precio3_habilitado: true }
    expect(preciosVentaVisibles(p)).toEqual([1, 2, 3])
  })
})
