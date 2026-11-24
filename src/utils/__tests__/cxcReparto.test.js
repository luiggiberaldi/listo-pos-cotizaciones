import { describe, it, expect } from 'vitest'
import {
  repartirCxC, pendienteDeDespacho, pendienteSoloEnlazado, abonosQueCubrenDespacho,
  cargosPendientes, pagadoDeMas, abonoAnulableEnDevolucion,
} from '../cxcReparto.js'

const D1863 = 'd1863'
const D1954 = 'd1954'

// Caso real Decoraciones Encendo (OP-2026-041), en el momento justo ANTES de la devolución:
// cargo #1863 a crédito y el "Cruce – NO PROCEDE" manual sin enlace.
const encendoAntes = [
  { id: 'c1', tipo: 'cargo', monto_usd: 2144, despacho_id: D1863, creado_en: '2026-07-22T19:47:23.134994+00:00' },
  { id: 'a1', tipo: 'abono', monto_usd: 2144, despacho_id: null, forma_pago_abono: '[{"metodo":"Cruce"}]', referencia: 'NO PROCEDE', creado_en: '2026-07-27T15:53:48.198193+00:00' },
]

describe('repartirCxC (misma regla que la pantalla de CxC)', () => {
  it('fase 1: el abono enlazado paga su despacho aunque haya cargos más viejos', () => {
    const movs = [
      { id: 'c1', tipo: 'cargo', monto_usd: 100, despacho_id: 'A', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'c2', tipo: 'cargo', monto_usd: 50, despacho_id: 'B', creado_en: '2026-01-02T00:00:00+00:00' },
      { id: 'a1', tipo: 'abono', monto_usd: 50, despacho_id: 'B', creado_en: '2026-01-03T00:00:00+00:00' },
    ]
    expect(pendienteDeDespacho(movs, 'A')).toBe(100)
    expect(pendienteDeDespacho(movs, 'B')).toBe(0)
  })

  it('fase 2: los abonos sueltos pagan del más viejo al más nuevo', () => {
    const movs = [
      { id: 'c1', tipo: 'cargo', monto_usd: 100, despacho_id: 'A', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'c2', tipo: 'cargo', monto_usd: 50, despacho_id: 'B', creado_en: '2026-01-02T00:00:00+00:00' },
      { id: 'a1', tipo: 'abono', monto_usd: 120, despacho_id: null, creado_en: '2026-01-03T00:00:00+00:00' },
    ]
    expect(pendienteDeDespacho(movs, 'A')).toBe(0)
    expect(pendienteDeDespacho(movs, 'B')).toBe(30)
  })

  it('el sobrante de un abono enlazado pasa a fase 2', () => {
    const movs = [
      { id: 'c1', tipo: 'cargo', monto_usd: 100, despacho_id: 'A', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'c2', tipo: 'cargo', monto_usd: 50, despacho_id: 'B', creado_en: '2026-01-02T00:00:00+00:00' },
      { id: 'a1', tipo: 'abono', monto_usd: 80, despacho_id: 'B', creado_en: '2026-01-03T00:00:00+00:00' },
    ]
    expect(pendienteDeDespacho(movs, 'B')).toBe(0)
    expect(pendienteDeDespacho(movs, 'A')).toBe(70)
  })

  it('ignora movimientos de saldo a favor (credito, consumo, devolución de crédito)', () => {
    const movs = [
      { id: 'c1', tipo: 'cargo', monto_usd: 100, despacho_id: 'A', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'x1', tipo: 'credito', monto_usd: 500, creado_en: '2026-01-02T00:00:00+00:00' },
      { id: 'x2', tipo: 'consumo_credito', monto_usd: 40, despacho_id: 'A', creado_en: '2026-01-02T00:00:00+00:00' },
    ]
    expect(pendienteDeDespacho(movs, 'A')).toBe(100)
  })

  it('ordena por fecha con microsegundos y luego por id', () => {
    const movs = [
      { id: 'a2', tipo: 'abono', monto_usd: 10, creado_en: '2026-01-02T00:00:00.000002+00:00' },
      { id: 'c1', tipo: 'cargo', monto_usd: 10, despacho_id: 'A', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'c2', tipo: 'cargo', monto_usd: 10, despacho_id: 'B', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'a1', tipo: 'abono', monto_usd: 10, creado_en: '2026-01-02T00:00:00.000001+00:00' },
    ]
    const { abonos } = repartirCxC(movs)
    expect(abonos.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(abonos[0].aplicaciones[0].despacho_id).toBe('A')
  })
})

describe('Caso Decoraciones Encendo (falla G1)', () => {
  it('la regla vieja (solo enlazado) creía que el despacho #1863 se debía completo', () => {
    expect(pendienteSoloEnlazado(encendoAntes, D1863)).toBe(2144)
  })
  it('con el reparto, el #1863 ya estaba cubierto por el Cruce manual', () => {
    expect(pendienteDeDespacho(encendoAntes, D1863)).toBe(0)
    const cubren = abonosQueCubrenDespacho(encendoAntes, D1863)
    expect(cubren).toHaveLength(1)
    expect(cubren[0]).toMatchObject({ id: 'a1', aplicado: 2144, enlazado: false, referencia: 'NO PROCEDE' })
  })
  it('después de lo que pasó en producción, quedan $1.949 pagados de más y la deuda real de $195 escondida', () => {
    const despues = [
      ...encendoAntes,
      { id: 'a2', tipo: 'abono', monto_usd: 2144, despacho_id: D1863, forma_pago_abono: 'Devolución', creado_en: '2026-07-27T20:03:06.066105+00:00' },
      { id: 'k1', tipo: 'credito', monto_usd: 4.3, despacho_id: D1863, creado_en: '2026-07-27T20:03:06.182131+00:00' },
      { id: 'c2', tipo: 'cargo', monto_usd: 195, despacho_id: D1954, creado_en: '2026-07-27T20:07:58.761193+00:00' },
    ]
    expect(pagadoDeMas(despues)).toBe(1949)
    expect(pendienteDeDespacho(despues, D1954)).toBe(0)
    // Corrección: sin el Cruce, aparece la deuda real
    const corregido = despues.filter(m => m.id !== 'a1')
    expect(pagadoDeMas(corregido)).toBe(0)
    expect(pendienteDeDespacho(corregido, D1954)).toBe(195)
  })
})

describe('cargosPendientes (selector de despacho)', () => {
  it('lista solo los cargos con algo pendiente', () => {
    const movs = [
      { id: 'c1', tipo: 'cargo', monto_usd: 100, despacho_id: 'A', creado_en: '2026-01-01T00:00:00+00:00' },
      { id: 'c2', tipo: 'cargo', monto_usd: 50, despacho_id: 'B', creado_en: '2026-01-02T00:00:00+00:00' },
      { id: 'a1', tipo: 'abono', monto_usd: 100, creado_en: '2026-01-03T00:00:00+00:00' },
    ]
    expect(cargosPendientes(movs)).toEqual([
      expect.objectContaining({ despacho_id: 'B', pendiente: 50, monto_usd: 50 }),
    ])
  })
})

describe('pagadoDeMas (falla G3)', () => {
  it('es 0 si los abonos no superan los cargos', () => {
    expect(pagadoDeMas([{ tipo: 'cargo', monto_usd: 10 }, { tipo: 'abono', monto_usd: 10 }])).toBe(0)
  })
  it('cuenta los registros viejos de pago con saldo a favor (Ferrechuros)', () => {
    expect(pagadoDeMas([
      { tipo: 'cargo', monto_usd: 16 }, { tipo: 'abono', monto_usd: 16 },
      { tipo: 'credito', monto_usd: 815 },
      { tipo: 'abono', monto_usd: 810, forma_pago_abono: 'Saldo a favor' },
    ])).toBe(810)
  })
})

describe('abonoAnulableEnDevolucion', () => {
  it('permite un cruce suelto o enlazado al mismo despacho', () => {
    expect(abonoAnulableEnDevolucion({ despacho_id: null, forma_pago_abono: 'Cruce' }, 'A')).toBe(true)
    expect(abonoAnulableEnDevolucion({ despacho_id: 'A', forma_pago_abono: 'Efectivo $' }, 'A')).toBe(true)
  })
  it('rechaza abonos de otro despacho, de devoluciones o de saldo a favor', () => {
    expect(abonoAnulableEnDevolucion({ despacho_id: 'B' }, 'A')).toBe(false)
    expect(abonoAnulableEnDevolucion({ forma_pago_abono: 'Devolución' }, 'A')).toBe(false)
    expect(abonoAnulableEnDevolucion({ forma_pago_abono: 'Saldo a favor' }, 'A')).toBe(false)
  })
})
