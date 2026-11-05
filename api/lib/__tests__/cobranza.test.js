import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../audit.js', () => ({ logToSystem: vi.fn(() => Promise.resolve()) }))
vi.mock('../webpush.js', () => ({ sendWebPush: vi.fn(() => Promise.resolve()) }))

import { sendWebPush } from '../webpush.js'
import { runAvisoCobranza } from '../cobranza.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'k' }
const cuentaA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const cuentaB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const jefeA = '11111111-1111-4111-8111-111111111111'
const adminA = '22222222-2222-4222-8222-222222222222'
const jefeB = '33333333-3333-4333-8333-333333333333'
const cliA = '44444444-4444-4444-8444-444444444444'
const cliB = '55555555-5555-4555-8555-555555555555'
// 5 de noviembre, 8:00 a. m. en Venezuela
const AHORA = new Date('2026-11-05T12:00:00Z')

function stubDb({ txsA, txsB = [] }) {
  const urls = []
  const responder = (u, filas) => new Response(JSON.stringify(new URL(u).searchParams.get('offset') === '0' ? filas : []), { status: 200 })
  vi.stubGlobal('fetch', vi.fn(async u => {
    const s = String(u); urls.push(decodeURIComponent(s))
    if (s.includes('/usuarios?')) return responder(s, [{ id: jefeA, cuenta_id: cuentaA }, { id: adminA, cuenta_id: cuentaA }, { id: jefeB, cuenta_id: cuentaB }])
    if (s.includes('/clientes?')) return responder(s, s.includes(cuentaA) ? [{ id: cliA }] : [{ id: cliB }])
    if (s.includes('/cuentas_por_cobrar?')) return responder(s, s.includes(cuentaA) ? txsA : txsB)
    if (s.includes('push_subscriptions?select')) return new Response(JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a', usuario_id: jefeA }]), { status: 200 })
    return new Response('', { status: 200 })
  }))
  return urls
}

beforeEach(() => { vi.clearAllMocks() })

describe('runAvisoCobranza (tarea de las 8 a. m.)', () => {
  it('avisa solo a jefe y administración de cada cuenta, con lo vencido y por vencer', async () => {
    const urls = stubDb({ txsA: [
      { id: 'c1', cliente_id: cliA, tipo: 'cargo', monto_usd: 100, fecha_vencimiento: '2026-11-01', creado_en: '2026-10-01T00:00:00Z' },
      { id: 'c2', cliente_id: cliA, tipo: 'cargo', monto_usd: 50, fecha_vencimiento: '2026-11-07', creado_en: '2026-10-02T00:00:00Z' },
      { id: 'a1', cliente_id: cliA, tipo: 'abono', monto_usd: 30, creado_en: '2026-10-03T00:00:00Z' },
    ] })
    const res = await runAvisoCobranza(ENV, AHORA)

    expect(urls.find(u => u.includes('/usuarios?'))).toContain('rol=in.(jefe,administracion)')
    expect(urls.filter(u => u.includes('/clientes?')).every(u => u.includes('activo=eq.true') && u.includes('saldo_pendiente=gt.0'))).toBe(true)
    const subs = urls.filter(u => u.includes('push_subscriptions?select'))
    expect(subs).toHaveLength(1) // la cuenta B no tiene nada pendiente → no se avisa
    expect(subs[0]).toContain(`usuario_id=in.(${jefeA},${adminA})`)
    expect(subs[0]).not.toContain(jefeB)

    const payload = JSON.parse(sendWebPush.mock.calls[0][3])
    expect(payload).toEqual({
      title: '💰 Cobranza: 1 cuenta vencida',
      body: '1 vencida ($70.00) · 1 vence en los próximos 3 días ($50.00)',
      tag: 'cobranza-2026-11-05',
      url: '/reportes?tab=credito',
    })
    expect(res).toEqual([
      expect.objectContaining({ cuentaId: cuentaA, enviado: true, vencidas: 1, porVencer: 1, sent: 1 }),
      { cuentaId: cuentaB, enviado: false },
    ])
  })

  it('las consultas de deudas quedan limitadas a la cuenta', async () => {
    const urls = stubDb({ txsA: [] })
    await runAvisoCobranza(ENV, AHORA)
    const cxc = urls.filter(u => u.includes('/cuentas_por_cobrar?'))
    expect(cxc.some(u => u.includes(`cuenta_id=eq.${cuentaA}`) && u.includes(cliA))).toBe(true)
    expect(cxc.every(u => u.includes('cuenta_id=eq.'))).toBe(true)
    expect(sendWebPush).not.toHaveBeenCalled()
  })
})
