import { describe, expect, it } from 'vitest'
import { precio2Visible, precio3Visible } from '../preciosHabilitados'

describe('preciosHabilitados', () => {
  it('oculta un precio inhabilitado aunque conserve valor', () => {
    const producto = { precio_2: 8.7, precio_3: 8.5, precio2_habilitado: false, precio3_habilitado: true }
    expect(precio2Visible(producto)).toBe(false)
    expect(precio3Visible(producto)).toBe(true)
  })

  it('oculta un precio sin valor aunque el flag esté habilitado', () => {
    const producto = { precio_2: null, precio_3: 8.5, precio2_habilitado: true, precio3_habilitado: true }
    expect(precio2Visible(producto)).toBe(false)
    expect(precio3Visible(producto)).toBe(true)
  })

  it('asume habilitado cuando el flag no viene en los datos (cache antigua)', () => {
    const producto = { precio_2: 8.7, precio_3: 8.5 }
    expect(precio2Visible(producto)).toBe(true)
    expect(precio3Visible(producto)).toBe(true)
  })

  it('oculta ambos precios cuando ambos están inhabilitados', () => {
    const producto = { precio_2: 8.7, precio_3: 8.5, precio2_habilitado: false, precio3_habilitado: false }
    expect(precio2Visible(producto)).toBe(false)
    expect(precio3Visible(producto)).toBe(false)
  })

  it('es seguro con producto nulo o indefinido', () => {
    expect(precio2Visible(null)).toBe(false)
    expect(precio3Visible(undefined)).toBe(false)
  })
})
