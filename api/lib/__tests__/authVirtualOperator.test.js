import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUPER_ADMIN_UUID, validateOperator } from '../auth.js'

const accountId = '5b15e0c1-6e2c-4fea-8132-c0673ad38ca0'
const otherAccountId = '11111111-1111-4111-8111-111111111111'
const token = 'a'.repeat(64)
const tokenHash = createHash('sha256').update(token).digest('hex')
const env = {
  SUPABASE_URL: 'https://virtual-auth.test',
  SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_KEY: 'synthetic-service',
}

function installTransport(sessionOverrides = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input, options) => {
    const url = new URL(input)
    if (url.origin !== env.SUPABASE_URL) throw new Error('Unexpected external request')
    if (url.pathname === '/auth/v1/user') {
      return Response.json({
        id: accountId,
        app_metadata: { operator_id: SUPER_ADMIN_UUID, operator_rol: 'desarrollador' },
      })
    }
    if (url.pathname === '/rest/v1/operator_sessions') {
      expect(options.headers.Authorization).toBe('Bearer synthetic-service')
      expect(url.searchParams.get('cuenta_id')).toBe(`eq.${accountId}`)
      return Response.json([{
        token_hash: tokenHash, cuenta_id: accountId, operator_id: SUPER_ADMIN_UUID,
        virtual_developer: true, credential_hash: null, revoked_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...sessionOverrides,
      }])
    }
    throw new Error(`Unexpected request: ${url.pathname}`)
  }))
}

function request(headers = {}) {
  return new Request('https://worker.test/api/despachos/crear', {
    headers: { Authorization: 'Bearer virtual-operator-test-token', ...headers },
  })
}

describe('validateOperator virtual developer sessions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('assigns the authenticated account only with a valid virtual developer session', async () => {
    installTransport()
    const result = await validateOperator(request({ 'X-Operator-Session': token, 'X-Operator-Id': SUPER_ADMIN_UUID }), env)
    expect(result.error).toBeUndefined()
    expect(result.operador).toMatchObject({ id: SUPER_ADMIN_UUID, rol: 'desarrollador', cuenta_id: accountId })
    expect(result.user.operator_virtual_developer).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not promote shared account metadata into a developer session', async () => {
    installTransport()
    const result = await validateOperator(request(), env)
    expect(result.error.status).toBe(403)
    expect(result.operador).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a zero UUID header without a session', async () => {
    installTransport()
    const result = await validateOperator(request({ 'X-Operator-Id': SUPER_ADMIN_UUID }), env)
    expect(result.error.status).toBe(401)
  })

  it.each([
    ['an unflagged zero UUID', { virtual_developer: false }],
    ['a flagged nonzero operator', { operator_id: otherAccountId }],
    ['a different account', { cuenta_id: otherAccountId }],
    ['a revoked session', { revoked_at: new Date().toISOString() }],
    ['an expired session', { expires_at: '2000-01-01T00:00:00.000Z' }],
    ['a credential-bearing virtual session', { credential_hash: 'unexpected-hash' }],
  ])('rejects %s', async (_name, overrides) => {
    installTransport(overrides)
    const result = await validateOperator(request({ 'X-Operator-Session': token }), env)
    expect(result.error.status).toBe(401)
    expect(result.operador).toBeUndefined()
  })
})
