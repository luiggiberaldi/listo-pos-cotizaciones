// OP-2026-092 — un despacho 100 % préstamo (total $0) no exige método de pago al editar sus productos.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const s = readFileSync(path.resolve(__dirname, '../../..', 'src/components/despachos/EditarItemsDespachoModal.jsx'), 'utf8')

describe('OP-2026-092 despacho solo préstamo sin método de pago', () => {
  it('con total $0 los pagos se consideran cuadrados aunque no haya ninguno', () => {
    expect(s).toContain('const sinCobro = !esCod && total <= 0.015')
    expect(s).toContain(': (pagoInmediatoCuadrado || sinCobro)')
  })
  it('explica el motivo al usuario', () => {
    expect(s).toContain('Este despacho es 100 % préstamo: no se cobra nada ahora.')
    expect(s).toContain('Sin cobro: todo es préstamo')
  })
  it('al guardar sin cobro se limpian los pagos anotados que ya no corresponden', () => {
    expect(s).toContain('JSON.stringify(totales.sinCobro ? [] : formasPagoFinales)')
  })

  describe('ventana "Editar despacho" y comisión de préstamos facturados', () => {
    const e = readFileSync(path.resolve(__dirname, '../../..', 'src/components/despachos/EditDespachoModal.jsx'), 'utf8')
    const srv = readFileSync(path.resolve(__dirname, '../../..', 'api/handlers/despachos.js'), 'utf8')
    it('Editar despacho tampoco exige método de pago con total $0 y guarda sin pagos', () => {
      expect(e).toContain('const sinCobro = !esCod && totalConFlete <= 0.015')
      expect(e).toContain('(pagoInmediatoCuadrado || sinCobro)')
      expect(e).toContain('JSON.stringify(sinCobro ? [] : formasPagoFinales)')
    })
    it('editar el pago no borra la comisión sumada por un préstamo facturado', () => {
      expect(srv).toContain('cliente_prestamos?despacho_id=eq.${despachoId}&cantidad_facturada=gt.0')
      expect(srv).toContain('tienePrestamoFacturado && Array.isArray(comEntries)')
    })
  })
})
