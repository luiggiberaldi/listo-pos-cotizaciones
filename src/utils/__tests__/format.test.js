import { describe, it, expect } from 'vitest'
import { fmtUsd, fmtUsdSimple, fmtBs, usdToBs, fmtFecha, fmtFechaLarga, sanitizePostgrestSearch } from '../format'

// ─── fmtUsd ─────────────────────────────────────────────────────────────────

describe('fmtUsd', () => {
  it('formatea numero con separador de miles', () => {
    const r = fmtUsd(1234.5)
    expect(r).toContain('1,234.50') // en-US locale
  })

  it('formatea 0', () => {
    expect(fmtUsd(0)).toContain('0.00')
  })

  it('null retorna $0.00', () => {
    expect(fmtUsd(null)).toContain('0.00')
  })

  it('empieza con $', () => {
    expect(fmtUsd(100)).toMatch(/^\$/)
  })
})

// ─── fmtUsdSimple ───────────────────────────────────────────────────────────

describe('fmtUsdSimple', () => {
  it('formatea sin separador de miles', () => {
    expect(fmtUsdSimple(1234.5)).toBe('$1234.50')
  })

  it('null retorna $0.00', () => {
    expect(fmtUsdSimple(null)).toBe('$0.00')
  })

  it('entero agrega .00', () => {
    expect(fmtUsdSimple(100)).toBe('$100.00')
  })
})

// ─── fmtBs ──────────────────────────────────────────────────────────────────

describe('fmtBs', () => {
  it('null retorna "Bs 0,00"', () => {
    expect(fmtBs(null)).toBe('Bs 0,00')
  })

  it('NaN retorna "Bs 0,00"', () => {
    expect(fmtBs(NaN)).toBe('Bs 0,00')
  })

  it('numero valido empieza con "Bs"', () => {
    const r = fmtBs(1500.5)
    expect(r).toMatch(/^Bs\s/)
  })

  it('numero valido contiene decimales', () => {
    const r = fmtBs(100)
    expect(r).toMatch(/\d/)
  })
})

// ─── usdToBs ────────────────────────────────────────────────────────────────

describe('usdToBs', () => {
  it('convierte 100 USD a tasa 36.5 = 3650', () => {
    expect(usdToBs(100, 36.5)).toBe(3650)
  })

  it('retorna 0 si usd es null', () => {
    expect(usdToBs(null, 36.5)).toBe(0)
  })

  it('retorna 0 si usd es 0', () => {
    expect(usdToBs(0, 36.5)).toBe(0)
  })

  it('retorna 0 si tasa es 0', () => {
    expect(usdToBs(100, 0)).toBe(0)
  })

  it('retorna 0 si tasa es null', () => {
    expect(usdToBs(100, null)).toBe(0)
  })
})

// ─── fmtFecha ───────────────────────────────────────────────────────────────

describe('fmtFecha', () => {
  it('null retorna "—"', () => {
    expect(fmtFecha(null)).toBe('—')
  })

  it('undefined retorna "—"', () => {
    expect(fmtFecha(undefined)).toBe('—')
  })

  it('fecha valida retorna string con numeros', () => {
    const r = fmtFecha('2026-04-25T12:00:00Z')
    expect(r).toMatch(/\d/)
    expect(r).toMatch(/2026/)
  })
})

// ─── fmtFechaLarga ──────────────────────────────────────────────────────────

describe('fmtFechaLarga', () => {
  it('null retorna "—"', () => {
    expect(fmtFechaLarga(null)).toBe('—')
  })

  it('fecha valida incluye timezone', () => {
    const r = fmtFechaLarga('2026-04-25T12:00:00Z')
    expect(r).toMatch(/\(.*\)/)
  })

  it('fecha valida contiene hora', () => {
    const r = fmtFechaLarga('2026-04-25T15:30:00Z')
    expect(r).toMatch(/\d{1,2}:\d{2}/)
  })
})

// ─── sanitizePostgrestSearch ────────────────────────────────────────────────

describe('sanitizePostgrestSearch', () => {
  it('remueve puntos', () => {
    expect(sanitizePostgrestSearch('test.value')).toBe('testvalue')
  })

  it('remueve comas', () => {
    expect(sanitizePostgrestSearch('a,b,c')).toBe('abc')
  })

  it('remueve parentesis', () => {
    expect(sanitizePostgrestSearch('test(1)')).toBe('test1')
  })

  it('remueve backslash', () => {
    expect(sanitizePostgrestSearch('test\\value')).toBe('testvalue')
  })

  it('remueve % y _', () => {
    expect(sanitizePostgrestSearch('test%value_2')).toBe('testvalue2')
  })

  it('null retorna ""', () => {
    expect(sanitizePostgrestSearch(null)).toBe('')
  })

  it('undefined retorna ""', () => {
    expect(sanitizePostgrestSearch(undefined)).toBe('')
  })

  it('trim de espacios', () => {
    expect(sanitizePostgrestSearch('  test  ')).toBe('test')
  })
})
