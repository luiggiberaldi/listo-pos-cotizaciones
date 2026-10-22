import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import { handlePagarTransportista, handleRevertirPagoTransportista } from '../transportistas.js'

const cuentaId = '11111111-1111-4111-8111-111111111111'
const transportistaId = '22222222-2222-4222-8222-222222222222'
const pagoId = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  validateOperator.mockResolvedValue({
    operador: { id: '44444444-4444-4444-8444-444444444444', nombre: 'Admin', rol: 'administracion', cuenta_id: cuentaId },
    ip: '127.0.0.1',
  })
})

describe('liquidación atómica de transportistas', () => {
  it('llama la RPC con la cuenta y la clave de idempotencia', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ pago_id: pagoId, despachos_marcados: 2, monto_aplicado_usd: 35, excedente_usd: 0 }), { status: 200 })
    }))

    const response = await handlePagarTransportista(
      new Request('https://app.test/api/transportistas/pagar', {
        method: 'POST',
        body: JSON.stringify({ transportistaId, monto: 35, idempotencyKey: 'payment-key-123456' }),
      }),
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' },
    )

    expect(response.status).toBe(200)
    expect(calls[0].url).toContain('/rpc/liquidar_transportista')
    const payload = JSON.parse(calls[0].options.body)
    expect(payload.p_cuenta_id).toBe(cuentaId)
    expect(payload.p_idempotency_key).toBe('payment-key-123456')
  })

  it('rechaza el monto antes de llamar a Supabase si no es finito', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handlePagarTransportista(
      new Request('https://app.test/api/transportistas/pagar', {
        method: 'POST',
        body: JSON.stringify({ transportistaId, monto: 'Infinity', idempotencyKey: 'payment-key-123456' }),
      }),
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' },
    )
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('usa la RPC para revertir y conserva el aislamiento por cuenta', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ pago_id: pagoId, despachos_reseteados: 2 }), { status: 200 })
    }))

    const response = await handleRevertirPagoTransportista(
      new Request('https://app.test/api/transportistas/revertir-pago', {
        method: 'POST',
        body: JSON.stringify({ pagoId }),
      }),
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' },
    )

    expect(response.status).toBe(200)
    expect(calls[0].url).toContain('/rpc/revertir_pago_transportista')
    expect(JSON.parse(calls[0].options.body).p_cuenta_id).toBe(cuentaId)
  })
})

