import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(),
  verifyAuth: vi.fn(),
  verifySupervisor: vi.fn(),
  verifyPrivileged: vi.fn(),
  supaServiceHeaders: vi.fn(),
  SUPER_ADMIN_UUID: '00000000-0000-0000-0000-000000000000',
  invalidateOperatorCache: vi.fn(),
}))

vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(() => Promise.resolve()),
  logToSystem: vi.fn(() => Promise.resolve()),
}))

import { validateOperator } from '../../lib/auth.js'
import { handleTesterCleanupFixtures } from '../admin.js'

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
}
const accountId = '11111111-1111-4111-8111-111111111111'
const operatorId = '22222222-2222-4222-8222-222222222222'
const clientId = '33333333-3333-4333-8333-333333333333'
const loteId = '44444444-4444-4444-8444-444444444444'
const transportistaId = '55555555-5555-4555-8555-555555555555'
const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function auth(rol = 'desarrollador') {
  return {
    user: { id: accountId, operator_id: operatorId },
    operador: { id: operatorId, nombre: 'Tester', rol, cuenta_id: accountId },
    headers: {
      apikey: ENV.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${ENV.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    ip: '127.0.0.1',
  }
}

function request(body) {
  return new Request('https://app.test/api/admin/tester/cleanup-fixtures', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ ...body, idempotencyKey }),
  })
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  validateOperator.mockResolvedValue(auth())
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const parsed = new URL(url)
    const table = parsed.pathname.split('/').pop()
    if (table === 'clientes') {
      if (options.method === 'PATCH') return response([{ id: clientId }])
      return response([{ id: clientId, nombre: 'Cliente Determinista Test', rif_cedula: 'J-88888888-0' }])
    }
    if (table === 'cuentas_por_cobrar') return response([{ id: 'cxc-1' }])
    if (table === 'reasignaciones_clientes') return response([{ id: 'reasig-1' }])
    if (table === 'inventario_movimientos') {
      if (options.method === 'DELETE') return response([{ id: 'mov-1' }])
      return response([{ id: 'mov-1', motivo: 'Ajuste de inventario por tester determinista' }])
    }
    if (table === 'transportistas') {
      if (options.method === 'PATCH') return response([{ id: transportistaId, activo: false }])
      return response([{ id: transportistaId, nombre: 'Transportista Determinista Test', activo: true }])
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`)
  }))
})

describe('cleanup de fixtures del Tester por Worker', () => {
  it('limpia CxC, reasignaciones y lote solo dentro del tenant', async () => {
    const result = await handleTesterCleanupFixtures(request({
      clienteIds: [clientId],
      loteIds: [loteId],
      transportistaIds: [transportistaId],
    }), ENV)
    const body = await result.json()

    expect(result.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      clientes_procesados: 1,
      cxc_eliminadas: 1,
      reasignaciones_eliminadas: 1,
      lotes_procesados: 1,
      movimientos_eliminados: 1,
      transportistas_procesados: 1,
      transportistas_desactivados: 1,
      cleanup_replay_safe: true,
    })

    const calls = vi.mocked(fetch).mock.calls.map(([url, options]) => ({
      url: String(url),
      method: options?.method || 'GET',
    }))
    expect(calls.some(call => call.url.includes(`cuenta_id=eq.${accountId}`))).toBe(true)
    expect(calls.some(call => call.url.includes(`lote_id=eq.${loteId}`))).toBe(true)
    expect(calls.every(call => !call.url.includes('cuenta_id=eq.99999999'))).toBe(true)
  })

  it('rechaza un cliente que no tiene el marcador del fixture antes de borrar', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => response([{
      id: clientId,
      nombre: 'Cliente real',
      rif_cedula: 'J-12345678-9',
    }]))

    const result = await handleTesterCleanupFixtures(request({ clienteIds: [clientId] }), ENV)
    const body = await result.json()

    expect(result.status).toBe(409)
    expect(body.error).toContain('fixture determinista')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('rechaza un lote que no contiene el motivo del Tester', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => response([{ id: 'mov-1', motivo: 'Ingreso real de proveedor' }]))

    const result = await handleTesterCleanupFixtures(request({ loteIds: [loteId] }), ENV)
    const body = await result.json()

    expect(result.status).toBe(409)
    expect(body.error).toContain('no coincide')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('exige rol desarrollador y clave de idempotencia válida', async () => {
    validateOperator.mockResolvedValue(auth('administracion'))
    const forbidden = await handleTesterCleanupFixtures(request({ clienteIds: [clientId] }), ENV)
    expect(forbidden.status).toBe(403)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()

    validateOperator.mockResolvedValue(auth())
    const invalidKeyRequest = new Request('https://app.test/api/admin/tester/cleanup-fixtures', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid' },
      body: JSON.stringify({ clienteIds: [clientId], idempotencyKey: 'invalid' }),
    })
    const invalidKey = await handleTesterCleanupFixtures(invalidKeyRequest, ENV)
    expect(invalidKey.status).toBe(400)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
