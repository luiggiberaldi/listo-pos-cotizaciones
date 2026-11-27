// src/utils/__tests__/despachoSinCobro.test.js — OP-2026-095 Fase 4 (pruebas reales de comportamiento)
import { describe, it, expect } from 'vitest'
import { evaluarSinCobro } from '../despachoSinCobro.js'

describe('OP-2026-095 Fase 4 — evaluarSinCobro (préstamo vs donación vs venta)', () => {
  it('despacho 100 % préstamo con total $0 no exige pago y explica devoluciones (sin mencionar facturar)', () => {
    const r = evaluarSinCobro({
      esCod: false,
      total: 0,
      items: [{ esPrestamo: true }, { es_prestamo: true }],
    })
    expect(r.sinCobro).toBe(true)
    expect(r.motivo).toBe('prestamo')
    expect(r.titulo).toContain('100 % préstamo')
    expect(r.descripcion).not.toMatch(/factura/i)
    expect(r.etiquetaCorta).toContain('todo es préstamo')
  })

  it('despacho $0 que NO es préstamo (ej. 100 % donación) no dice "todo es préstamo"', () => {
    const r = evaluarSinCobro({
      esCod: false,
      total: 0,
      items: [{ esPrestamo: false }],
    })
    expect(r.sinCobro).toBe(true)
    expect(r.motivo).toBe('sin_cobro')
    expect(r.titulo).toContain('total $0')
    expect(r.titulo).not.toContain('préstamo')
  })

  it('préstamo + flete mayor a $0 SÍ exige método de pago', () => {
    const r = evaluarSinCobro({
      esCod: false,
      total: 45,
      items: [{ esPrestamo: true }],
    })
    expect(r.sinCobro).toBe(false)
    expect(r.motivo).toBeNull()
  })

  it('COD con total $0 no activa sinCobro', () => {
    const r = evaluarSinCobro({
      esCod: true,
      total: 0,
      items: [{ esPrestamo: true }],
    })
    expect(r.sinCobro).toBe(false)
  })
})
