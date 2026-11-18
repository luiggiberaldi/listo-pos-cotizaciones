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

  // OP-2026-032: Niki (supervisora) cobró $5,19 por un cliente suyo vendido por Josué
  // y su fila no salía; el total no cuadraba con Reportes → Comisiones.
  it('muestra al supervisor que tiene comisión o ventas en el período', () => {
    expect(shouldIncludeReporteVendedor('jefe', { rol: 'supervisor', activo: true, comisionTotal: 5.19 })).toBe(true)
    expect(shouldIncludeReporteVendedor('supervisor', { rol: 'supervisor', activo: true, totalUsd: 136, numDespachos: 1 })).toBe(true)
    expect(shouldIncludeReporteVendedor('jefe', { rol: 'supervisor', activo: true, totalUsd: 0, numDespachos: 0, comisionTotal: 0 })).toBe(false)
    expect(shouldIncludeReporteVendedor('jefe', { rol: 'supervisor', activo: false, comisionTotal: 5.19 })).toBe(false)
  })
})
