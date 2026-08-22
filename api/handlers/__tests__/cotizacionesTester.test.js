import { beforeEach, describe, expect, it, vi } from 'vitest'

const SUPER_ADMIN_UUID = '00000000-0000-0000-0000-000000000000'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
  verifySupervisor: vi.fn(),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
  logToSystem: vi.fn(() => Promise.resolve()),
}))

import { validateOperator, verifyAuth } from '../../lib/auth.js'
import { handleGuardarCotizacion } from '../cotizaciones.js'

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
}
const accountId = '11111111-1111-4111-8111-111111111111'
const sellerId = '22222222-2222-4222-8222-222222222222'
const clientId = '33333333-3333-4333-8333-333333333333'
const quoteId = '44444444-4444-4444-8444-444444444444'

function virtualAuth() {
  return {
    user: { id: accountId, operator_id: SUPER_ADMIN_UUID },
    operador: { id: SUPER_ADMIN_UUID, nombre: 'Desarrollador', rol: 'desarrollador', cuenta_id: accountId },
    headers: { apikey: 'service-key', Authorization: 'Bearer service-key', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

function request(headerData = {}) {
  return new Request('https://app.test/api/cotizaciones/guardar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      headerData: {
        cliente_id: clientId,
        vendedor_id: sellerId,
        subtotal_usd: 10,
        descuento_global_pct: 0,
        descuento_usd: 0,
        costo_envio_usd: 0,
        total_usd: 10,
        ...headerData,
      },
      items: [{
        nombre_snap: 'Producto test',
        cantidad: 1,
        precio_unit_usd: 10,
        total_linea_usd: 10,
      }],
    }),
  })
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyAuth.mockResolvedValue({ id: accountId, operator_id: SUPER_ADMIN_UUID })
  validateOperator.mockResolvedValue(virtualAuth())
})

describe('cotizaciones del Tester con desarrollador virtual', () => {
  it('conserva un vendedor real validado dentro del tenant', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options })
      if (String(url).includes('/usuarios?')) return response([{ id: sellerId }])
      if (String(url).includes('/cotizaciones?')) return response([{ id: quoteId }])
      if (String(url).includes('/cotizacion_items')) return response([])
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await handleGuardarCotizacion(request(), ENV)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toEqual({ id: quoteId })
    const quoteCall = calls.find(call => call.url.includes('/cotizaciones?'))
    expect(JSON.parse(quoteCall.options.body)).toMatchObject({
      vendedor_id: sellerId,
      cliente_id: clientId,
      estado: 'borrador',
    })
    expect(quoteCall.url).not.toContain(SUPER_ADMIN_UUID)
  })

  it('rechaza un vendedor que no pertenece al tenant', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('/usuarios?')) return response([])
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await handleGuardarCotizacion(request(), ENV)
    const body = await result.json()

    expect(result.status).toBe(400)
    expect(body.error).toContain('no pertenece')
  })
})
