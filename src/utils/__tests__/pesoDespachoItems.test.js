import { describe, expect, it } from 'vitest'
import { resumenPesoItems } from '../pesoDespacho.js'

describe('resumenPesoItems (documentos impresos)', () => {
  it('suma cantidad × peso por unidad', () => {
    const r = resumenPesoItems([
      { cantidad: 100, peso_unit_kg: 15 },
      { cantidad: 10, peso_unit_kg: 0.1 },
    ], 3500)
    expect(r).toMatchObject({ totalKg: 1501, sinPeso: 0, lineas: 2, capacidadKg: 3500, excede: false, pct: 43 })
  })
  it('avisa cuando supera la capacidad, sin bloquear', () => {
    expect(resumenPesoItems([{ cantidad: 4, peso_unit_kg: 1000 }], 3500)).toMatchObject({ excede: true, pct: 114 })
  })
  it('cuenta los artículos sin peso como incompleto', () => {
    expect(resumenPesoItems([{ cantidad: 2, peso_unit_kg: 5 }, { cantidad: 3, peso_unit_kg: null }], null))
      .toMatchObject({ totalKg: 10, sinPeso: 1, lineas: 2, capacidadKg: null, excede: false, pct: null })
  })
  it('los servicios (flete, corte) sin la propiedad peso_unit_kg no cuentan', () => {
    expect(resumenPesoItems([{ cantidad: 1, peso_unit_kg: 2 }, { cantidad: 1, nombre_snap: 'SERVICIO DE FLETE (E)' }], 100))
      .toMatchObject({ totalKg: 2, sinPeso: 0, lineas: 1 })
  })
  it('si ningún artículo tiene peso, o la vista no entregó la propiedad, devuelve null (el documento queda como siempre)', () => {
    expect(resumenPesoItems([{ cantidad: 1, peso_unit_kg: null }], 3500)).toBeNull()
    expect(resumenPesoItems([{ cantidad: 1 }], 3500)).toBeNull()
    expect(resumenPesoItems([], 3500)).toBeNull()
  })
})
