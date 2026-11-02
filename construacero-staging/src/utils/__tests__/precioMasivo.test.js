import { describe, expect, it } from 'vitest'
import { validarValorMasivo, precioNuevoMasivo } from '../precioMasivo.js'

describe('validarValorMasivo (mismas reglas que el servidor)', () => {
  it('vacío no es error: solo falta escribir', () => {
    expect(validarValorMasivo('porcentaje', '')).toBeNull()
  })
  it.each([['abc'], ['0'], ['-100'], ['-150'], ['1001']])('porcentaje inválido: %s', t => {
    expect(validarValorMasivo('porcentaje', t)).toEqual(expect.any(String))
  })
  it.each([['10'], ['-5'], ['-99.9'], ['1000']])('porcentaje válido: %s', t => {
    expect(validarValorMasivo('porcentaje', t)).toBeNull()
  })
  it.each([['0'], ['-3'], ['x'], ['100000000']])('precio fijo inválido: %s', t => {
    expect(validarValorMasivo('valor_fijo', t)).toEqual(expect.any(String))
  })
  it('precio fijo válido', () => {
    expect(validarValorMasivo('valor_fijo', '25.5')).toBeNull()
  })
})

describe('precioNuevoMasivo', () => {
  it('aplica el porcentaje y redondea a 2 decimales', () => {
    expect(precioNuevoMasivo('porcentaje', '10', 10)).toBe(11)
    expect(precioNuevoMasivo('porcentaje', '-5', 1.89)).toBe(1.8)
    expect(precioNuevoMasivo('porcentaje', '10', '7.5')).toBe(8.25)
  })
  it('con precio fijo devuelve ese precio', () => {
    expect(precioNuevoMasivo('valor_fijo', '25.5', 10)).toBe(25.5)
  })
  it('un precio en 0 con porcentaje se queda en 0', () => {
    expect(precioNuevoMasivo('porcentaje', '10', 0)).toBe(0)
  })
  it('sin precio actual no calcula nada (no inventa precios)', () => {
    expect(precioNuevoMasivo('porcentaje', '10', null)).toBeNull()
    expect(precioNuevoMasivo('valor_fijo', '5', undefined)).toBeNull()
  })
  it('valor inválido o resultado fuera de rango no calcula', () => {
    expect(precioNuevoMasivo('porcentaje', '-100', 10)).toBeNull()
    expect(precioNuevoMasivo('porcentaje', '1000', 99999999)).toBeNull()
  })
})
