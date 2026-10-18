import { describe, expect, it } from 'vitest'
import { convertBsToUsd } from '../codCurrency.js'

describe('convertBsToUsd', () => {
  it('convierte un monto normal y fija el resultado a centavos', () => {
    expect(convertBsToUsd('20000.00', 200)).toBe(100)
    expect(convertBsToUsd('18000.00', 300)).toBe(60)
    expect(convertBsToUsd('20000.01', 2)).toBe(10000.01)
  })

  it('redondea medios centavos hacia arriba igual que PostgreSQL numeric', () => {
    expect(convertBsToUsd('200.01', 2)).toBe(100.01)
    expect(convertBsToUsd('20000.01', 2)).toBe(10000.01)
    expect(convertBsToUsd('20000000.01', 2)).toBe(10000000.01)
    expect(convertBsToUsd('20000.01', 3)).toBe(6666.67)
    expect(convertBsToUsd('20000.01', 1.23456789)).toBe(16200.01)
  })

  it('rechaza montos o tasas no representables dentro de la precisión contratada', () => {
    expect(convertBsToUsd('0', 200)).toBeNull()
    expect(convertBsToUsd('1.001', 200)).toBeNull()
    expect(convertBsToUsd('100', 0)).toBeNull()
    expect(convertBsToUsd('100', 1_000_000_001)).toBeNull()
    expect(convertBsToUsd('100', 200.000000001)).toBeNull()
    expect(convertBsToUsd('100', Number.NaN)).toBeNull()
  })
})
