import { describe, expect, it } from 'vitest'
import { comparaCapacidad, formatPeso, pesoLinea, resumenPeso } from '../pesoDespacho.js'

describe('formatPeso', () => {
  it('muestra kilos con coma decimal y sin ceros sobrantes', () => {
    expect(formatPeso(0.1)).toBe('0,1 kg')
    expect(formatPeso(10.7)).toBe('10,7 kg')
    expect(formatPeso('2140')).toMatch(/^2\.?140 kg$/)
    expect(formatPeso(0)).toBe('0 kg')
  })
  it('sin dato → guion', () => {
    for (const v of [null, undefined, '', 'abc']) expect(formatPeso(v)).toBe('—')
  })
})

describe('resumenPeso', () => {
  it('completo', () => {
    expect(resumenPeso({ peso_total_kg: '21.4', items_sin_peso: 0, items_total: 3 })).toEqual({ totalKg: 21.4, sinPeso: 0, incompleto: false, sinDatos: false })
  })
  it('incompleto: faltan algunos artículos', () => {
    expect(resumenPeso({ peso_total_kg: 5, items_sin_peso: 1, items_total: 3 })).toMatchObject({ incompleto: true, sinDatos: false, sinPeso: 1 })
  })
  it('sin ningún peso cargado', () => {
    expect(resumenPeso({ peso_total_kg: 0, items_sin_peso: 4, items_total: 4 })).toMatchObject({ incompleto: true, sinDatos: true })
  })
  it('sin fila (vista no disponible o despacho sin ítems) no inventa datos', () => {
    expect(resumenPeso(undefined)).toEqual({ totalKg: 0, sinPeso: 0, incompleto: false, sinDatos: false })
  })
})

describe('comparaCapacidad (solo advierte)', () => {
  it('dentro de la capacidad', () => {
    expect(comparaCapacidad(3200, 5000)).toEqual({ capacidadKg: 5000, pct: 64, excede: false, libreKg: 1800 })
  })
  it('se pasa: excede', () => {
    expect(comparaCapacidad(5200, 5000)).toMatchObject({ excede: true, pct: 104, libreKg: -200 })
  })
  it('exactamente la capacidad no excede', () => {
    expect(comparaCapacidad(5000, 5000).excede).toBe(false)
  })
  it('sin capacidad cargada no muestra nada', () => {
    for (const c of [null, undefined, 0, '', -5]) expect(comparaCapacidad(100, c)).toBeNull()
  })
})

describe('pesoLinea', () => {
  it('cantidad × peso, redondeado a 3 decimales', () => {
    expect(pesoLinea(10, 0.1)).toBe(1)
    expect(pesoLinea(3, 10.7)).toBe(32.1)
    expect(pesoLinea(0.3, 0.1)).toBe(0.03)
  })
  it('sin peso por unidad → null', () => {
    expect(pesoLinea(5, null)).toBeNull()
    expect(pesoLinea(null, 2)).toBeNull()
  })
})
