import { describe, it, expect } from 'vitest'
import { round2, round4, mulR, divR, sumR, subR } from '../dinero'

// ─── round2: redondeo a 2 decimales (centavos) ─────────────────────────────

describe('round2', () => {
  it('redondea 1.005 a 1.01 (bug clasico IEEE 754)', () => {
    expect(round2(1.005)).toBe(1.01)
  })

  it('redondea 2.005 a 2.01', () => {
    expect(round2(2.005)).toBe(2.01)
  })

  it('redondea 1.004 a 1', () => {
    expect(round2(1.004)).toBe(1)
  })

  it('redondea 1.006 a 1.01', () => {
    expect(round2(1.006)).toBe(1.01)
  })

  it('redondea 0 a 0', () => {
    expect(round2(0)).toBe(0)
  })

  it('retorna 0 para NaN', () => {
    expect(round2(NaN)).toBe(0)
  })

  it('retorna 0 para Infinity', () => {
    expect(round2(Infinity)).toBe(0)
  })

  it('retorna 0 para -Infinity', () => {
    expect(round2(-Infinity)).toBe(0)
  })

  it('maneja numeros negativos', () => {
    expect(round2(-1.006)).toBe(-1.01)
  })

  it('maneja numeros grandes sin perder precision', () => {
    expect(round2(99999.99)).toBe(99999.99)
  })

  it('redondea 0.1 + 0.2 correctamente', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
})

// ─── round4: redondeo a 4 decimales (tasas de cambio) ───────────────────────

describe('round4', () => {
  it('redondea tasa BCV tipica: 36.12345 a 36.1235', () => {
    expect(round4(36.12345)).toBe(36.1235)
  })

  it('retorna 0 para NaN', () => {
    expect(round4(NaN)).toBe(0)
  })

  it('retorna 0 para Infinity', () => {
    expect(round4(Infinity)).toBe(0)
  })

  it('redondea 1.00005 a 1.0001', () => {
    expect(round4(1.00005)).toBe(1.0001)
  })
})

// ─── mulR: multiplicacion segura ────────────────────────────────────────────

describe('mulR', () => {
  it('multiplica basico: 10.5 * 3 = 31.5', () => {
    expect(mulR(10.5, 3)).toBe(31.5)
  })

  it('trata null como 0', () => {
    expect(mulR(null, 5)).toBe(0)
  })

  it('trata undefined como 0', () => {
    expect(mulR(undefined, 5)).toBe(0)
  })

  it('multiplica decimales con redondeo: 1.111 * 1.111', () => {
    expect(mulR(1.111, 1.111)).toBe(1.23)
  })

  it('ambos operandos null retorna 0', () => {
    expect(mulR(null, null)).toBe(0)
  })
})

// ─── divR: division segura ──────────────────────────────────────────────────

describe('divR', () => {
  it('divide basico: 10 / 3 = 3.33', () => {
    expect(divR(10, 3)).toBe(3.33)
  })

  it('division por 0 retorna 0', () => {
    expect(divR(10, 0)).toBe(0)
  })

  it('division por null retorna 0', () => {
    expect(divR(10, null)).toBe(0)
  })

  it('division por NaN retorna 0', () => {
    expect(divR(10, NaN)).toBe(0)
  })

  it('division por Infinity retorna 0', () => {
    expect(divR(10, Infinity)).toBe(0)
  })

  it('numerador null retorna 0', () => {
    expect(divR(null, 5)).toBe(0)
  })

  it('conversion de moneda: 3650 / 36.5 = 100', () => {
    expect(divR(3650, 36.5)).toBe(100)
  })
})

// ─── sumR: suma segura ──────────────────────────────────────────────────────

describe('sumR', () => {
  it('suma array: [1.001, 2.002, 3.003] = 6.01', () => {
    expect(sumR([1.001, 2.002, 3.003])).toBe(6.01)
  })

  it('suma variadic: sumR(1, 2, 3) = 6', () => {
    expect(sumR(1, 2, 3)).toBe(6)
  })

  it('suma array con nulls: [1, null, 3] = 4', () => {
    expect(sumR([1, null, 3])).toBe(4)
  })

  it('suma array vacio: [] = 0', () => {
    expect(sumR([])).toBe(0)
  })

  it('previene drift acumulado: 0.1 + 0.2 + 0.3 = 0.6', () => {
    expect(sumR([0.1, 0.2, 0.3])).toBe(0.6)
  })

  it('un solo argumento retorna el mismo redondeado', () => {
    expect(sumR(5.555)).toBe(5.56)
  })
})

// ─── subR: resta segura ─────────────────────────────────────────────────────

describe('subR', () => {
  it('resta basica: 10.006 - 5.003 = 5', () => {
    expect(subR(10.006, 5.003)).toBe(5)
  })

  it('resta con primer operando null: null - 5 = -5', () => {
    expect(subR(null, 5)).toBe(-5)
  })

  it('resta con segundo operando undefined: 10 - undefined = 10', () => {
    expect(subR(10, undefined)).toBe(10)
  })

  it('resta que da negativo: 3 - 5 = -2', () => {
    expect(subR(3, 5)).toBe(-2)
  })

  it('ambos null: 0 - 0 = 0', () => {
    expect(subR(null, null)).toBe(0)
  })
})
