import { describe, it, expect, vi, afterEach } from 'vitest'
import { getSabadoActualOFuturo } from '../dateHelpers'

// getSabadoActualOFuturo: default del PanelDesignacion (incidente 12-sep).
// Reglas: sábado → hoy; otro día → el próximo sábado; siempre TZ-local
// (nunca toISOString, que salta de día después de las 20:00 VE).

afterEach(() => { vi.useRealTimers() })

describe('getSabadoActualOFuturo', () => {
  it('si hoy es sábado, devuelve hoy', () => {
    // 2026-09-12 es sábado
    vi.setSystemTime(new Date(2026, 8, 12, 15, 0, 0))
    expect(getSabadoActualOFuturo()).toBe('2026-09-12')
  })

  it('en viernes devuelve el sábado siguiente (el de mañana)', () => {
    // 2026-09-11 es viernes — este caso es el del incidente del 12-sep
    vi.setSystemTime(new Date(2026, 8, 11, 16, 40, 0))
    expect(getSabadoActualOFuturo()).toBe('2026-09-12')
  })

  it('en domingo devuelve el sábado de la misma semana', () => {
    // 2026-09-13 es domingo
    vi.setSystemTime(new Date(2026, 8, 13, 10, 0, 0))
    expect(getSabadoActualOFuturo()).toBe('2026-09-19')
  })

  it('de noche en hora local NO salta de día (regresión UTC)', () => {
    // 23:30 locales del viernes 11-sep: toISOString() daría el 12, pero la
    // fecha local sigue siendo 11 → el helper debe devolver el sábado 12 igual.
    vi.setSystemTime(new Date(2026, 8, 11, 23, 30, 0))
    expect(getSabadoActualOFuturo()).toBe('2026-09-12')
  })

  it('offset=1 devuelve el sábado siguiente al calculado', () => {
    vi.setSystemTime(new Date(2026, 8, 11, 16, 40, 0))
    expect(getSabadoActualOFuturo(1)).toBe('2026-09-19')
  })
})
