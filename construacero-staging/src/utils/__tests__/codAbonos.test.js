import { describe, it, expect } from 'vitest'
import { resumenCod } from '../codAbonos'

describe('resumenCod', () => {
  it('COD sin pagos: pendiente completo', () => {
    expect(resumenCod({ metodo: 'Cobro a destino', monto: 100 }))
      .toEqual({ monto: 100, abonado: 0, falta: 100, pagado: false, parcial: false })
  })

  it('COD con un abono parcial', () => {
    const r = resumenCod({ metodo: 'Cobro a destino', monto: 100, cobro_destino_pagado: false,
      metodos_pagados: [{ metodo: 'Zelle', monto: 40 }] })
    expect(r).toEqual({ monto: 100, abonado: 40, falta: 60, pagado: false, parcial: true })
  })

  it('suma varios abonos (incluye Efectivo Bs en su equivalente USD)', () => {
    const r = resumenCod({ monto: 1076.79, metodos_pagados: [
      { metodo: 'Efectivo $', monto: 500 },
      { metodo: 'Efectivo Bs', monto: 200.33, monto_bs: 9000 },
    ] })
    expect(r.parcial).toBe(true)
    expect(r.abonado).toBe(700.33)
    expect(r.falta).toBe(376.46)
  })

  it('COD pagado por completo', () => {
    const r = resumenCod({ monto: 100, cobro_destino_pagado: true, metodos_pagados: [{ monto: 100 }] })
    expect(r).toEqual({ monto: 100, abonado: 100, falta: 0, pagado: true, parcial: false })
  })

  it('datos que no cuadran (abonado >= monto sin marca de pagado): pendiente completo', () => {
    const r = resumenCod({ monto: 100, cobro_destino_pagado: false, metodos_pagados: [{ monto: 100 }] })
    expect(r).toEqual({ monto: 100, abonado: 0, falta: 100, pagado: false, parcial: false })
  })

  it('ignora montos inválidos y no lee metodo_propuesto (despacho devuelto)', () => {
    const r = resumenCod({ monto: 50, metodos_pagados: [{ monto: 'x' }, { monto: -5 }],
      metodo_propuesto: [{ monto: '20' }] })
    expect(r).toEqual({ monto: 50, abonado: 0, falta: 50, pagado: false, parcial: false })
  })
})
