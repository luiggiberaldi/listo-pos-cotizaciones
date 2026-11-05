import { describe, expect, it } from 'vitest'
import { cargosPendientes, fechaCaracas, resumirCobranza, sumarDias, textoCobranza } from '../cobranza.js'

const cargo = (id, cliente, monto, vence, creado, despacho = null) =>
  ({ id, cliente_id: cliente, tipo: 'cargo', monto_usd: monto, fecha_vencimiento: vence, creado_en: creado, despacho_id: despacho })
const abono = (id, cliente, monto, creado, despacho = null) =>
  ({ id, cliente_id: cliente, tipo: 'abono', monto_usd: monto, creado_en: creado, despacho_id: despacho })

describe('fechas en hora de Venezuela', () => {
  it('a las 11 p. m. de Venezuela sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
    expect(fechaCaracas(new Date('2026-11-06T03:30:00Z'))).toBe('2026-11-05')
    expect(fechaCaracas(new Date('2026-11-06T12:00:00Z'))).toBe('2026-11-06')
  })
  it('suma días cruzando mes', () => {
    expect(sumarDias('2026-11-29', 3)).toBe('2026-12-02')
  })
})

describe('cargosPendientes (mismo cálculo que el reporte de Crédito)', () => {
  it('aplica primero el abono del mismo despacho y luego el resto al cargo más antiguo', () => {
    const txs = [
      cargo('c1', 'A', 100, '2026-11-01', '2026-10-01T10:00:00Z', 'd1'),
      cargo('c2', 'A', 50, '2026-11-10', '2026-10-02T10:00:00Z', 'd2'),
      abono('a1', 'A', 50, '2026-10-03T10:00:00Z', 'd2'),
      abono('a2', 'A', 30, '2026-10-04T10:00:00Z'),
    ]
    expect(cargosPendientes(txs).map(c => [c.id, c.pendiente])).toEqual([['c1', 70]])
  })
  it('ignora residuos de centavos y el orden en que lleguen las filas', () => {
    const txs = [abono('a1', 'A', 99.999, '2026-10-02T00:00:00Z'), cargo('c1', 'A', 100, '2026-11-01', '2026-10-01T00:00:00Z')]
    expect(cargosPendientes(txs)).toEqual([])
  })
})

describe('resumirCobranza', () => {
  const hoy = '2026-11-05'
  const txs = [
    cargo('c1', 'A', 100, '2026-11-04', '2026-10-01T00:00:00Z'), // vencida ayer
    cargo('c2', 'A', 40, '2026-11-05T00:00:00+00:00', '2026-10-02T00:00:00Z'), // vence hoy → por vencer
    abono('a1', 'A', 60, '2026-10-03T00:00:00Z'), // deja c1 en 40
    cargo('c3', 'B', 25.5, '2026-11-08', '2026-10-05T00:00:00Z'), // vence en 3 días → por vencer
    cargo('c4', 'B', 80, '2026-11-09', '2026-10-06T00:00:00Z'), // en 4 días → fuera
    cargo('c5', 'C', 10, null, '2026-10-06T00:00:00Z'), // sin fecha → fuera
  ]
  it('separa vencidas y por vencer con lo que realmente falta cobrar', () => {
    expect(resumirCobranza(txs, hoy, 3)).toEqual({
      hoy, dias: 3,
      vencidas: { cantidad: 1, totalUsd: 40 },
      porVencer: { cantidad: 2, totalUsd: 65.5 },
    })
  })
  it('un cargo pagado completo no cuenta', () => {
    const r = resumirCobranza([...txs, abono('a2', 'A', 40, '2026-10-07T00:00:00Z')], hoy, 3)
    expect(r.vencidas.cantidad).toBe(0)
  })
})

describe('textoCobranza', () => {
  const base = { hoy: '2026-11-05', dias: 3 }
  it('sin nada pendiente no hay aviso', () => {
    expect(textoCobranza({ ...base, vencidas: { cantidad: 0, totalUsd: 0 }, porVencer: { cantidad: 0, totalUsd: 0 } })).toBeNull()
  })
  it('con vencidas es urgente y menciona ambas cosas', () => {
    expect(textoCobranza({ ...base, vencidas: { cantidad: 4, totalUsd: 3200 }, porVencer: { cantidad: 1, totalUsd: 510.5 } })).toEqual({
      title: '💰 Cobranza: 4 cuentas vencidas',
      body: '4 vencidas ($3,200.00) · 1 vence en los próximos 3 días ($510.50)',
      urgente: true,
    })
  })
  it('solo por vencer: aviso normal', () => {
    const t = textoCobranza({ ...base, vencidas: { cantidad: 0, totalUsd: 0 }, porVencer: { cantidad: 6, totalUsd: 5100 } })
    expect(t).toEqual({ title: '💰 Cobranza: 6 cuentas por vencer', body: '6 vencen en los próximos 3 días ($5,100.00)', urgente: false })
  })
})
