import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOperatorRole, validateOperator, verifyAuth } from '../auth.js'
import { hashPinPBKDF2 } from '../crypto.js'
import { issueOperatorSession, OPERATOR_SESSION_LIFETIME_MS, resolveOperatorSession, revokeOperatorSession, sha256Hex, SUPER_ADMIN_UUID } from '../operatorSession.js'
import { handleClearOperator, handleGetOperators, handleSuperAdmin, handleSwitchOperator } from '../../handlers/auth-operators.js'
import { rateLimitMap } from '../utils.js'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222'
const SELLER = '33333333-3333-4333-8333-333333333333'
const SUPERVISOR = '44444444-4444-4444-8444-444444444444'
const PIN = '2468'
const digest = value => createHash('sha256').update(value).digest('hex')
let serial = 0

function jwt(claims = {}) {
  return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({
    sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + 3600, nonce: ++serial, ...claims,
  })).toString('base64url')}.synthetic-signature`
}

async function fixture() {
  const env = {
    SUPABASE_URL: `https://operator-session-${++serial}.test`,
    SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_KEY: 'synthetic-service', DEV_SUPER_CODE: 'synthetic-dev-code',
  }
  const bearer = jwt()
  const pinHash = await hashPinPBKDF2(PIN, 'synthetic-salt')
  const operators = new Map([
    [SELLER, { id: SELLER, cuenta_id: ACCOUNT, activo: true, nombre: 'Seller', rol: 'vendedor', codigo: 'S1', color: '#123456',
      pin_hash: pinHash, pin_salt: 'synthetic-salt', markup_pct: 5, comision_pct: 3, comision_pct_cabilla: 2, es_externo: false }],
    [SUPERVISOR, { id: SUPERVISOR, cuenta_id: ACCOUNT, activo: true, nombre: 'Supervisor', rol: 'supervisor', codigo: 'U1', color: '#345678',
      pin_hash: pinHash, pin_salt: 'synthetic-salt', markup_pct: 7, comision_pct: 4, comision_pct_cabilla: 1, es_externo: false }],
  ])
  const sessions = new Map()
  const writes = []
  const state = {
    account: ACCOUNT, authStatus: 200, authMetadata: {}, failPath: null, failMethod: null,
    throwPath: null, sessionResponse: null, operatorResponse: null,
  }
  const transport = vi.fn(async (input, options = {}) => {
    const url = new URL(input)
    if (url.origin !== env.SUPABASE_URL) throw new Error('External requests are prohibited in this test')
    const method = options.method || 'GET'
    if (state.throwPath === url.pathname) throw new Error('Synthetic transport unavailable')
    if (state.failPath === url.pathname && (!state.failMethod || state.failMethod === method)) {
      return Response.json({ error: 'Synthetic storage failure' }, { status: 503 })
    }
    if (url.pathname === '/auth/v1/user') {
      expect(options.headers.Authorization).toMatch(/^Bearer /)
      return Response.json({ id: state.account, app_metadata: state.authMetadata }, { status: state.authStatus })
    }
    expect(options.headers.Authorization).toBe('Bearer synthetic-service')
    if (url.pathname === '/rest/v1/operator_sessions') {
      if (method === 'POST') {
        const row = { ...JSON.parse(options.body), revoked_at: null, creado_en: new Date().toISOString() }
        writes.push({ method, row: { ...row } })
        sessions.set(row.token_hash, row)
        return new Response(null, { status: 201 })
      }
      expect(url.searchParams.get('cuenta_id')).toMatch(/^eq\.[a-f0-9-]+$/)
      const hash = url.searchParams.get('token_hash')?.slice(3)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
      const row = sessions.get(hash)
      if (method === 'PATCH') {
        const change = JSON.parse(options.body)
        writes.push({ method, hash, account: url.searchParams.get('cuenta_id')?.slice(3), change })
        if (row?.cuenta_id === url.searchParams.get('cuenta_id')?.slice(3)) Object.assign(row, change)
        return new Response(null, { status: 204 })
      }
      expect(url.searchParams.get('revoked_at')).toBe('is.null')
      expect(url.searchParams.get('expires_at')).toMatch(/^gt\./)
      if (state.sessionResponse) return Response.json(state.sessionResponse)
      const matches = row && row.cuenta_id === url.searchParams.get('cuenta_id')?.slice(3) && !row.revoked_at && Date.parse(row.expires_at) > Date.now()
      return Response.json(matches ? [row] : [])
    }
    if (url.pathname === '/rest/v1/usuarios') {
      expect(url.searchParams.get('cuenta_id')).toBe(`eq.${state.account}`)
      expect(url.searchParams.get('activo')).toBe('eq.true')
      if (state.operatorResponse) return Response.json(state.operatorResponse)
      const operatorId = url.searchParams.get('id')?.slice(3)
      const rows = [...operators.values()].filter(operator => operator.cuenta_id === state.account && operator.activo && (!operatorId || operator.id === operatorId))
      return Response.json(rows)
    }
    if (url.pathname === '/rest/v1/configuracion_negocio') return Response.json([{ markup_pct_externo: 9 }])
    if (['/rest/v1/auditoria', '/rest/v1/system_logs'].includes(url.pathname) && method === 'POST') {
      return new Response(null, { status: 201 })
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  })
  vi.stubGlobal('fetch', transport)
  function request({ token, operatorId, accessToken = bearer, body, headers = {} } = {}) {
    return new Request('https://worker.test/api/test', {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(token ? { 'X-Operator-Session': token } : {}),
        ...(operatorId ? { 'X-Operator-Id': operatorId } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  async function login(operatorId = SELLER, previous = null, pin = PIN) {
    const response = await handleSwitchOperator(request({ token: previous?.token, body: { operator_id: operatorId, pin } }), env)
    return { response, body: await response.json() }
  }
  async function session(operatorId = SELLER) {
    return issueOperatorSession(env, { accountId: ACCOUNT, operator: operators.get(operatorId) })
  }
  return { env, bearer, operators, sessions, writes, state, transport, request, login, session }
}

beforeEach(() => {
  rateLimitMap.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('verified business account authentication', () => {
  it('rejects a forged JWT when the auth server rejects it', async () => {
    const f = await fixture()
    f.state.authStatus = 401
    const forged = jwt({ app_metadata: { operator_id: SUPER_ADMIN_UUID, operator_rol: 'desarrollador' } })
    expect(await verifyAuth(f.request({ accessToken: forged }), f.env)).toBeNull()
    expect(f.transport).toHaveBeenCalledTimes(1)
    expect(f.transport.mock.calls[0][0]).toBe(`${f.env.SUPABASE_URL}/auth/v1/user`)
    expect(await verifyAuth(f.request({ accessToken: forged }), f.env)).toBeNull()
    expect(f.transport).toHaveBeenCalledTimes(2)
  })

  it('does not treat JWT sub or account metadata as operator authority', async () => {
    const f = await fixture()
    f.state.authMetadata = { operator_id: SUPER_ADMIN_UUID, operator_rol: 'desarrollador' }
    const user = await verifyAuth(f.request({ accessToken: jwt({ sub: OTHER_ACCOUNT }) }), f.env)
    expect(user.id).toBe(ACCOUNT)
    expect(user.operator_id).toBeNull()
    expect(user.operator_rol).toBeNull()
    expect(user.operador).toBeNull()
  })

  it('rejects missing authorization and arbitrary operator headers', async () => {
    const f = await fixture()
    expect(await verifyAuth(new Request('https://worker.test'), f.env)).toBeNull()
    expect(await verifyAuth(f.request({ operatorId: SUPERVISOR }), f.env)).toBeNull()
    const result = await validateOperator(f.request(), f.env)
    expect(result.error.status).toBe(403)
  })

  it('caches only verified business identities and never beyond JWT expiry', async () => {
    const f = await fixture()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 2 })
    expect((await verifyAuth(f.request({ accessToken: token }), f.env)).id).toBe(ACCOUNT)
    expect((await verifyAuth(f.request({ accessToken: token }), f.env)).id).toBe(ACCOUNT)
    expect(f.transport).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-15T12:00:03Z'))
    f.state.authStatus = 401
    expect(await verifyAuth(f.request({ accessToken: token }), f.env)).toBeNull()
    expect(f.transport).toHaveBeenCalledTimes(2)
  })

  it('does not share verified token cache across Supabase projects', async () => {
    const f = await fixture()
    expect((await verifyAuth(f.request(), f.env)).id).toBe(ACCOUNT)
    const other = { ...f.env, SUPABASE_URL: 'https://other-auth-project.test' }
    vi.stubGlobal('fetch', vi.fn(async input => {
      expect(input).toBe(`${other.SUPABASE_URL}/auth/v1/user`)
      return Response.json({ error: 'Wrong project' }, { status: 401 })
    }))
    expect(await verifyAuth(f.request(), other)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache unknown-expiry credentials', async () => {
    const f = await fixture()
    const request = () => f.request({ accessToken: 'opaque-verified-account-token' })
    expect((await verifyAuth(request(), f.env)).id).toBe(ACCOUNT)
    expect((await verifyAuth(request(), f.env)).id).toBe(ACCOUNT)
    expect(f.transport).toHaveBeenCalledTimes(2)
  })

  it.each(['http', 'transport'])('fails closed for auth %s errors', async kind => {
    const f = await fixture()
    if (kind === 'http') f.state.authStatus = 503
    else f.state.throwPath = '/auth/v1/user'
    expect(await verifyAuth(f.request(), f.env)).toBeNull()
  })
})

describe('opaque per-browser operator sessions', () => {
  it('stores only SHA256 of a 32-byte random token for exactly twelve hours', async () => {
    const f = await fixture()
    const startedAt = Date.now()
    const issued = await f.session()
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/)
    expect(issued.id).toBe(digest(issued.token))
    expect(await sha256Hex(issued.token)).toBe(issued.id)
    expect(Date.parse(issued.expiresAt)).toBeGreaterThanOrEqual(startedAt + OPERATOR_SESSION_LIFETIME_MS)
    expect(Date.parse(issued.expiresAt)).toBeLessThanOrEqual(Date.now() + OPERATOR_SESSION_LIFETIME_MS)
    expect(f.sessions.get(issued.id)).toMatchObject({
      cuenta_id: ACCOUNT, operator_id: SELLER, virtual_developer: false,
      credential_hash: digest(`${f.operators.get(SELLER).pin_hash}:synthetic-salt`),
    })
    expect(JSON.stringify(f.writes)).not.toContain(issued.token)
  })

  it('resolves current tenant role without exposing PIN hashes', async () => {
    const f = await fixture()
    const issued = await f.session()
    const result = await validateOperator(f.request({ token: issued.token, operatorId: SELLER }), f.env)
    expect(result.error).toBeUndefined()
    expect(result.operador).toMatchObject({ id: SELLER, cuenta_id: ACCOUNT, rol: 'vendedor' })
    expect(result.user.operator_session_id).toBe(issued.id)
    expect(JSON.stringify(result)).not.toMatch(/pin_hash|pin_salt|credential_hash/)
  })

  it('rejects mismatched operator headers rather than overriding the session', async () => {
    const f = await fixture()
    const issued = await f.session()
    expect(await verifyAuth(f.request({ token: issued.token, operatorId: SUPERVISOR }), f.env)).toBeNull()
  })

  it.each(['wrong-token', 'a'.repeat(63), 'g'.repeat(64)])('rejects malformed session token %s', async token => {
    const f = await fixture()
    expect(await verifyAuth(f.request({ token }), f.env)).toBeNull()
    expect(f.transport.mock.calls.filter(([url]) => url.includes('/rest/v1/'))).toHaveLength(0)
  })

  it('rejects an unknown well-formed token', async () => {
    const f = await fixture()
    expect(await verifyAuth(f.request({ token: 'f'.repeat(64) }), f.env)).toBeNull()
  })

  it('rejects a session presented with a different verified business account', async () => {
    const f = await fixture()
    const issued = await f.session()
    f.state.account = OTHER_ACCOUNT
    expect(await verifyAuth(f.request({ token: issued.token, accessToken: jwt({ sub: OTHER_ACCOUNT }) }), f.env)).toBeNull()
  })

  it.each([
    ['wrong account', { cuenta_id: OTHER_ACCOUNT }],
    ['wrong token hash', { token_hash: 'e'.repeat(64) }],
    ['revocation', { revoked_at: '2026-01-01T00:00:00Z' }],
    ['expiration', { expires_at: '2000-01-01T00:00:00Z' }],
    ['invalid expiration', { expires_at: 'not-a-date' }],
    ['invalid operator ID', { operator_id: 'invalid' }],
  ])('defensively rejects returned session rows with %s', async (_name, override) => {
    const f = await fixture()
    const issued = await f.session()
    f.state.sessionResponse = [{ ...f.sessions.get(issued.id), ...override }]
    expect(await verifyAuth(f.request({ token: issued.token }), f.env)).toBeNull()
  })

  it.each([
    ['another account', { cuenta_id: OTHER_ACCOUNT }],
    ['another operator', { id: SUPERVISOR }],
    ['inactive operator', { activo: false }],
    ['changed PIN hash', { pin_hash: 'changed' }],
    ['changed PIN salt', { pin_salt: 'changed' }],
    ['removed credentials', { pin_hash: null }],
    ['unknown role', { rol: 'invalid-role' }],
  ])('rejects current operator rows with %s', async (_name, override) => {
    const f = await fixture()
    const issued = await f.session()
    f.state.operatorResponse = [{ ...f.operators.get(SELLER), ...override }]
    expect(await verifyAuth(f.request({ token: issued.token }), f.env)).toBeNull()
  })

  it('enforces demotion immediately even while the business auth token is cached', async () => {
    const f = await fixture()
    const issued = await f.session(SUPERVISOR)
    const request = () => f.request({ token: issued.token })
    expect((await validateOperator(request(), f.env, { requireSupervisor: true })).error).toBeUndefined()
    f.operators.get(SUPERVISOR).rol = 'vendedor'
    expect((await validateOperator(request(), f.env, { requireSupervisor: true })).error.status).toBe(403)
    expect((await validateOperator(request(), f.env)).operador.rol).toBe('vendedor')
    expect(f.transport.mock.calls.filter(([url]) => url.includes('/auth/v1/user'))).toHaveLength(1)
  })

  it('enforces operator deactivation after a previously successful request', async () => {
    const f = await fixture()
    const issued = await f.session()
    expect((await validateOperator(f.request({ token: issued.token }), f.env)).error).toBeUndefined()
    f.operators.get(SELLER).activo = false
    expect((await validateOperator(f.request({ token: issued.token }), f.env)).error.status).toBe(401)
  })

  it('keeps two simultaneous browser identities isolated on the same account JWT', async () => {
    const f = await fixture()
    const seller = await f.session()
    const supervisor = await f.session(SUPERVISOR)
    const [a, b] = await Promise.all([
      validateOperator(f.request({ token: seller.token }), f.env),
      validateOperator(f.request({ token: supervisor.token }), f.env),
    ])
    expect(a.operador.id).toBe(SELLER)
    expect(b.operador.id).toBe(SUPERVISOR)
    expect(a.user.operator_session_id).not.toBe(b.user.operator_session_id)
    await revokeOperatorSession(f.env, seller.token, ACCOUNT)
    expect(await verifyAuth(f.request({ token: seller.token }), f.env)).toBeNull()
    expect((await validateOperator(f.request({ token: supervisor.token }), f.env)).operador.id).toBe(SUPERVISOR)
  })

  it.each(['/rest/v1/operator_sessions', '/rest/v1/usuarios'])('fails closed when %s is unavailable', async path => {
    const f = await fixture()
    const issued = await f.session()
    f.state.failPath = path
    expect(await verifyAuth(f.request({ token: issued.token }), f.env)).toBeNull()
    f.state.failPath = null
    f.state.throwPath = path
    expect(await verifyAuth(f.request({ token: issued.token }), f.env)).toBeNull()
  })

  it('does not issue or revoke sessions after a storage error', async () => {
    const f = await fixture()
    f.state.failPath = '/rest/v1/operator_sessions'
    await expect(f.session()).rejects.toThrow('storage unavailable')
    await expect(revokeOperatorSession(f.env, 'a'.repeat(64), ACCOUNT)).rejects.toThrow('storage unavailable')
    expect(f.sessions.size).toBe(0)
  })

  it('repeats the tenant filter for compatible role-helper calls', async () => {
    const f = await fixture()
    expect(await getOperatorRole(SELLER, f.env, ACCOUNT)).toBe('vendedor')
    f.operators.get(SELLER).rol = 'supervisor'
    expect(await getOperatorRole(SELLER, f.env, ACCOUNT)).toBe('supervisor')
  })
})

describe('operator authentication handlers', () => {
  it('issues a session only after server PBKDF2 PIN verification without shared metadata writes', async () => {
    const f = await fixture()
    const { response, body } = await f.login()
    expect(response.status).toBe(200)
    expect(body.operator).toMatchObject({ id: SELLER, rol: 'vendedor' })
    expect(body.operatorSession.id).toBe(digest(body.operatorSession.token))
    expect(JSON.stringify(body)).not.toMatch(/pin_hash|pin_salt|credential_hash/)
    expect(f.transport.mock.calls.some(([url]) => url.includes('/auth/v1/admin/'))).toBe(false)
  })

  it.each(['expired', 'revoked'])('valid PIN can renew a %s previous session', async reason => {
    const f = await fixture()
    const previous = await f.session()
    if (reason === 'expired') f.sessions.get(previous.id).expires_at = new Date(Date.now() - 1000).toISOString()
    else f.sessions.get(previous.id).revoked_at = new Date().toISOString()
    const { response, body } = await f.login(SELLER, previous)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect((await resolveOperatorSession(f.env, body.operatorSession.token, ACCOUNT)).operator.id).toBe(SELLER)
  })

  it('unknown current role is denied even with a valid stored session', async () => {
    const f = await fixture()
    const previous = await f.session()
    f.operators.get(SELLER).rol = 'new-unreviewed-role'
    expect(await verifyAuth(f.request({ token: previous.token }), f.env)).toBeNull()
  })

  it('does not issue a session when the PIN is wrong', async () => {
    const f = await fixture()
    const { response, body } = await f.login(SELLER, null, '0000')
    expect(response.status).toBe(401)
    expect(body.operatorSession).toBeUndefined()
    expect(f.sessions.size).toBe(0)
  })

  it('rejects a cross-account PIN login even if storage returns an unrelated row', async () => {
    const f = await fixture()
    f.state.operatorResponse = [{ ...f.operators.get(SELLER), cuenta_id: OTHER_ACCOUNT }]
    expect((await f.login()).response.status).toBe(404)
    expect(f.sessions.size).toBe(0)
  })

  it('preserves the old session on a failed PIN and revokes it only after successful replacement', async () => {
    const f = await fixture()
    const previous = await f.session()
    expect((await f.login(SUPERVISOR, previous, '0000')).response.status).toBe(401)
    expect(f.sessions.get(previous.id).revoked_at).toBeNull()
    const { response, body } = await f.login(SUPERVISOR, previous)
    expect(response.status).toBe(200)
    expect(f.sessions.get(previous.id).revoked_at).not.toBeNull()
    expect(f.sessions.get(body.operatorSession.id).revoked_at).toBeNull()
    expect(f.writes.slice(-2).map(write => write.method)).toEqual(['POST', 'PATCH'])
    expect(f.writes.at(-1).hash).toBe(previous.id)
  })

  it('does not report successful login when issuing the replacement fails', async () => {
    const f = await fixture()
    const previous = await f.session()
    f.state.failPath = '/rest/v1/operator_sessions'
    f.state.failMethod = 'POST'
    const result = await f.login(SUPERVISOR, previous)
    expect(result.response.status).toBe(500)
    expect(result.body.operatorSession).toBeUndefined()
    expect(f.sessions.get(previous.id).revoked_at).toBeNull()
  })

  it('does not return a new session if revocation of the previous one fails', async () => {
    const f = await fixture()
    const previous = await f.session()
    f.state.failPath = '/rest/v1/operator_sessions'
    f.state.failMethod = 'PATCH'
    const result = await f.login(SUPERVISOR, previous)
    expect(result.response.status).toBe(500)
    expect(result.body.operatorSession).toBeUndefined()
  })

  it('returns login roster fields only, even if storage includes credentials', async () => {
    const f = await fixture()
    const response = await handleGetOperators(f.request(), f.env)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.operators).toHaveLength(2)
    expect(Object.keys(body.operators[0]).sort()).toEqual(['id', 'nombre', 'rol', 'codigo', 'color', 'es_externo'].sort())
    expect(JSON.stringify(body)).not.toMatch(/pin_hash|pin_salt|credential_hash|markup_pct|comision_pct/)
    const rosterUrl = f.transport.mock.calls.find(([url]) => url.includes('/rest/v1/usuarios'))[0]
    expect(rosterUrl).not.toMatch(/pin_hash|pin_salt/)
  })

  it('clear revokes only the presented browser session and leaves other sessions alive', async () => {
    const f = await fixture()
    const first = await f.session()
    const second = await f.session(SUPERVISOR)
    const response = await handleClearOperator(f.request({ token: first.token }), f.env)
    expect(response.status).toBe(200)
    expect(f.sessions.get(first.id).revoked_at).not.toBeNull()
    expect(f.sessions.get(second.id).revoked_at).toBeNull()
    expect(f.transport.mock.calls.some(([url]) => url.includes('/auth/v1/admin/'))).toBe(false)
  })

  it('account-only clear does not revoke sessions belonging to other browsers', async () => {
    const f = await fixture()
    const first = await f.session()
    expect((await handleClearOperator(f.request(), f.env)).status).toBe(200)
    expect(f.sessions.get(first.id).revoked_at).toBeNull()
    expect(f.writes.filter(write => write.method === 'PATCH')).toHaveLength(0)
  })

  it('requires the developer code before issuing a virtual session', async () => {
    const f = await fixture()
    const bad = await handleSuperAdmin(f.request({ body: { code: 'wrong' } }), f.env)
    expect(bad.status).toBe(403)
    expect(f.sessions.size).toBe(0)
    const response = await handleSuperAdmin(f.request({ body: { code: f.env.DEV_SUPER_CODE } }), f.env)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(f.sessions.get(body.operatorSession.id)).toMatchObject({
      operator_id: SUPER_ADMIN_UUID, cuenta_id: ACCOUNT, virtual_developer: true, credential_hash: null,
    })
    expect((await resolveOperatorSession(f.env, body.operatorSession.token, ACCOUNT)).operator.cuenta_id).toBe(ACCOUNT)
    expect(f.transport.mock.calls.some(([url]) => url.includes('/auth/v1/admin/'))).toBe(false)
  })

  it('does not authorize developer access without a valid business session', async () => {
    const f = await fixture()
    f.state.authStatus = 401
    const response = await handleSuperAdmin(f.request({ body: { code: f.env.DEV_SUPER_CODE } }), f.env)
    expect(response.status).toBe(401)
    expect(f.sessions.size).toBe(0)
  })
})
