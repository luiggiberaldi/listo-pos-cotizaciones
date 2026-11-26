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
})
