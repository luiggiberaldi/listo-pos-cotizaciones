import { describe, expect, it } from 'vitest'
import { shouldIncludeReporteVendedor } from '../reporteVendedoresAccess.js'

describe('visibilidad del reporte de vendedores', () => {
  it('oculta vendedores sin comisión al supervisor', () => {
    expect(shouldIncludeReporteVendedor('supervisor', { rol: 'vendedor_sin_comision', activo: true })).toBe(false)
    expect(shouldIncludeReporteVendedor('supervisor', { rol: 'vendedor', activo: true })).toBe(true)
  })

  it('conserva EMPRESA para el jefe si está activa', () => {
    expect(shouldIncludeReporteVendedor('jefe', { rol: 'vendedor_sin_comision', activo: true })).toBe(true)
  })

  it('oculta vendedores desactivados para cualquier visor', () => {
    expect(shouldIncludeReporteVendedor('supervisor', { rol: 'vendedor', activo: false })).toBe(false)
    expect(shouldIncludeReporteVendedor('jefe', { rol: 'vendedor_sin_comision', activo: false })).toBe(false)
  })

  it('oculta roles que no son vendedores para cualquier visor', () => {
    for (const rol of ['jefe', 'supervisor', 'administracion', 'logistica', 'desarrollador']) {
      expect(shouldIncludeReporteVendedor('jefe', { rol, activo: true })).toBe(false)
    }
  })
})
