import { describe, it, expect } from 'vitest'
import { vencimientoDespacho } from '../vencimientoDespacho'

const cta = (dias, monto = 500) => ({ metodo: 'Cta por cobrar', diasVencimiento: dias, monto })
const desp = (formas, creado = '2026-11-06T15:00:00Z') => ({ creado_en: creado, forma_pago: formas })
const ahora = (iso) => new Date(iso)

describe('vencimientoDespacho', () => {
  it('contado o sin días: no hay vencimiento', () => {
    expect(vencimientoDespacho(desp([{ metodo: 'Zelle', monto: 100 }]))).toBeNull()
    expect(vencimientoDespacho(desp([cta(0)]))).toBeNull()
    expect(vencimientoDespacho(desp([]))).toBeNull()
    expect(vencimientoDespacho(desp('Cta por cobrar'))).toBeNull()
    expect(vencimientoDespacho({})).toBeNull()
  })

  it('crédito de 15 días: fecha, restantes y textos', () => {
    const v = vencimientoDespacho(desp([cta(15)]), ahora('2026-11-06T16:00:00Z'))
    expect(v.fechaVencimiento).toBe('2026-11-21')
    expect(v.fechaTexto).toBe('21/11/2026')
    expect(v.restantes).toBe(15)
    expect(v.estado).toBe('normal')
    expect(v.esMixto).toBe(false)
    expect(v.textoPdf).toBe('Crédito 15 días · Vence: 21/11/2026')
    expect(v.textoDetalle).toBe('Vence el 21/11/2026 · quedan 15 días')
    expect(v.textoCorto).toBe('15 días · 15d restantes')
  })

  it('acepta forma_pago como texto JSON', () => {
    const v = vencimientoDespacho(desp(JSON.stringify([cta(8)])), ahora('2026-11-06T16:00:00Z'))
    expect(v.fechaTexto).toBe('14/11/2026')
  })

  it('pago mixto: el PDF dice cuánto queda a crédito', () => {
    const v = vencimientoDespacho(desp([{ metodo: 'Zelle', monto: 300 }, cta(15, 1200)]), ahora('2026-11-06T16:00:00Z'))
    expect(v.esMixto).toBe(true)
    expect(v.textoPdf).toBe('$1.200,00 a crédito · Vence: 21/11/2026')
  })

  it('estados: por vencer (3 o menos), vence hoy y vencido', () => {
    const base = desp([cta(15)])
    expect(vencimientoDespacho(base, ahora('2026-11-18T16:00:00Z')).estado).toBe('por_vencer') // quedan 3
    expect(vencimientoDespacho(base, ahora('2026-11-17T16:00:00Z')).estado).toBe('normal') // quedan 4
    const hoy = vencimientoDespacho(base, ahora('2026-11-21T16:00:00Z'))
    expect(hoy.restantes).toBe(0)
    expect(hoy.textoDetalle).toBe('Vence el 21/11/2026 · vence hoy')
    const v = vencimientoDespacho(base, ahora('2026-11-24T16:00:00Z'))
    expect(v.estado).toBe('vencido')
    expect(v.restantes).toBe(-3)
    expect(v.textoCorto).toBe('15 días · vencido hace 3 días')
    expect(vencimientoDespacho(base, ahora('2026-11-22T16:00:00Z')).textoDetalle).toBe('Vence el 21/11/2026 · vencido hace 1 día')
  })

  it('una venta de la noche en Venezuela no se corre de día (usa la hora de Caracas)', () => {
    // 9:30 p. m. del 6/11 en Caracas = 01:30 UTC del 7/11
    const v = vencimientoDespacho(desp([cta(1)], '2026-11-07T01:30:00Z'), ahora('2026-11-06T23:00:00Z'))
    expect(v.fechaVencimiento).toBe('2026-11-07')
    expect(v.restantes).toBe(1) // hoy 6/11 en Caracas → vence mañana
  })
})
