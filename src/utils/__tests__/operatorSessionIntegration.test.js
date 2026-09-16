import { build } from 'esbuild'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222'
const SELLER = '33333333-3333-4333-8333-333333333333'
const SUPERVISOR = '44444444-4444-4444-8444-444444444444'
let source
const contexts = []
const require = createRequire(import.meta.url)
const defer = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

beforeAll(async () => {
  const root = fs.realpathSync.native(process.cwd())
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `export { default as store } from './src/store/useAuthStore.js';
        export { default as queryClient } from './src/lib/queryClient.js';
        export * from './src/services/operatorSession.js';
        export * from './src/services/apiBase.js';
        export * from './src/services/authFetch.js';`,
      resolveDir: root,
    },
    platform: 'node', format: 'cjs', bundle: true, write: false,
    define: {
      'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_SUPABASE_URL': '"https://supabase.integration.test"',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '"synthetic-anon"',
      'import.meta.env.VITE_WORKER_ORIGIN': '""',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [{ name: 'synthetic-io-only', setup(plugin) {
      plugin.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'supabase-transport', namespace: 'test-io' }))
      plugin.onResolve({ filter: /queryPersister$/ }, () => ({ path: 'persister', namespace: 'test-io' }))
      plugin.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({ contents: args.path === 'persister'
        ? 'export const indexedDbPersister = fixture.persister;'
        : 'export function createClient(url, key, options) { fixture.customFetch = options.global.fetch; return fixture.client; }', loader: 'js' }))
    } }],
  })
  source = result.outputFiles[0].text
})

function storage() {
  const value = {}
  Object.defineProperties(value, {
    getItem: { value: key => Object.hasOwn(value, key) ? value[key] : null },
    setItem: { value: (key, data) => { value[key] = String(data) } },
    removeItem: { value: key => { delete value[key] } },
  })
  return value
}

function fixture() {
  const user = { id: ACCOUNT, email: 'synthetic@integration.test' }
  const f = {
    business: { user, access_token: 'synthetic-business-token', expires_at: Math.floor(Date.now() / 1000) + 3600 },
    persister: { removeClient: vi.fn(async () => {}) },
    cleanups: [],
  }
  f.client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: f.business } })),
      refreshSession: vi.fn(async () => ({ data: { session: f.business, user: f.business?.user } })),
      signInWithPassword: vi.fn(async () => ({ data: { session: f.business, user: f.business?.user }, error: null })),
      signOut: vi.fn(async () => { if (f.authEvent) await f.authEvent('SIGNED_OUT', null); return { error: null } }),
      onAuthStateChange: vi.fn(callback => { f.authEvent = callback; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    },
    realtime: { setAuth: vi.fn() },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'fixture', `${source}\n//# sourceURL=operator-session-production-bundle.cjs`)(require, module, module.exports, f)
  Object.assign(f, module.exports)
  f.store.setState({ user, initialized: true })
  f.activate = (operatorId = SELLER, accountId = ACCOUNT, duration = 60_000) => {
    const token = operatorId === SELLER ? 'a'.repeat(64) : 'b'.repeat(64)
    const id = operatorId === SELLER ? 'c'.repeat(64) : 'd'.repeat(64)
    f.setOperatorSession({ token, id, expiresAt: new Date(Date.now() + duration).toISOString() }, { accountId, operatorId })
    f.store.setState({ perfil: { id: operatorId, rol: operatorId === SELLER ? 'vendedor' : 'supervisor' } })
    return f.getOperatorSession()
  }
  f.initialize = () => f.cleanups.push(f.store.getState().initialize())
  contexts.push(f)
  return f
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('window', new EventTarget())
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/api/auth/operators')) return Response.json({ operators: [] })
    if (url.includes('/api/auth/clear-operator')) return Response.json({ ok: true })
    throw new Error(`Unmocked network request prohibited: ${url}`)
  }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  for (const f of contexts.splice(0)) {
    for (const cleanup of f.cleanups) cleanup()
    f.clearOperatorSession()
    f.queryClient.clear()
  }
  await flush()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('per-tab session expiry and account transitions', () => {
  it('purges only profile/query caches at expiry without recursive notifications', async () => {
    const f = fixture()
    f.activate(SELLER, ACCOUNT, 1000)
    f.queryClient.setQueryData(['private-sales'], { amount: 900 })
    localStorage.setItem('offline-business-drafts', 'preserve')
    const changed = vi.fn()
    f.subscribeOperatorSession(changed)
    await vi.advanceTimersByTimeAsync(1001)
    expect(f.getOperatorSession()).toBeNull()
    expect(f.store.getState().perfil).toBeNull()
    expect(f.queryClient.getQueryData(['private-sales'])).toBeUndefined()
    expect(f.persister.removeClient).toHaveBeenCalled()
    expect(localStorage.getItem('offline-business-drafts')).toBe('preserve')
    expect(changed).toHaveBeenCalledTimes(1)
    f.clearOperatorSession()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it.each(['focus', 'visibilitychange'])('cleans a suspended tab on %s without waiting for overdue timers', event => {
    const f = fixture()
    f.initialize()
    f.activate(SELLER, ACCOUNT, 1000)
    f.queryClient.setQueryData(['private-sales'], 90)
    vi.setSystemTime(new Date(Date.now() + 2000))
    expect(f.getOperatorSession()).toBeNull()
    ;(event === 'focus' ? window : document).dispatchEvent(new Event(event))
    expect(f.store.getState().perfil).toBeNull()
    expect(f.queryClient.getQueryData(['private-sales'])).toBeUndefined()
  })

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'])('purges the old operator before adopting another account through %s', async event => {
    const f = fixture()
    f.initialize()
    f.activate()
    f.queryClient.setQueryData(['private-sales'], 90)
    await f.authEvent(event, { access_token: 'other-token', user: { id: OTHER_ACCOUNT } })
    expect(f.store.getState().user.id).toBe(OTHER_ACCOUNT)
    expect(f.store.getState().perfil).toBeNull()
    expect(f.getOperatorSession()).toBeNull()
    expect(f.queryClient.getQueryData(['private-sales'])).toBeUndefined()
  })

  it('captures the previous account before signInWithPassword emits SIGNED_IN', async () => {
    const f = fixture()
    f.initialize()
    f.activate()
    f.queryClient.setQueryData(['private-sales'], 90)
    f.client.auth.signInWithPassword.mockImplementation(async () => {
      f.business = { access_token: 'other-token', user: { id: OTHER_ACCOUNT } }
      await f.authEvent('SIGNED_IN', f.business)
      return { data: { user: f.business.user, session: f.business }, error: null }
    })
    expect(await f.store.getState().login('other@integration.test', 'synthetic')).toEqual({ ok: true })
    expect(f.store.getState().user.id).toBe(OTHER_ACCOUNT)
    expect(f.getOperatorSession()).toBeNull()
    expect(f.store.getState().perfil).toBeNull()
    expect(f.queryClient.getQueryData(['private-sales'])).toBeUndefined()
  })

  it('does not restore operator authority after a business SIGNED_OUT/SIGNED_IN sequence', async () => {
    const f = fixture()
    f.initialize()
    f.activate()
    await f.authEvent('SIGNED_OUT', null)
    await f.authEvent('SIGNED_IN', f.business)
    expect(f.store.getState().user.id).toBe(ACCOUNT)
    expect(f.store.getState().perfil).toBeNull()
    expect(f.getOperatorSession()).toBeNull()
  })

  it('logout immediately clears authority and query caches but preserves business drafts', async () => {
    const f = fixture()
    f.initialize()
    f.activate()
    f.queryClient.setQueryData(['private-sales'], 90)
    localStorage.setItem('offline-business-drafts', 'keep')
    await f.store.getState().logout()
    expect(f.store.getState().user).toBeNull()
    expect(f.store.getState().perfil).toBeNull()
    expect(f.getOperatorSession()).toBeNull()
    expect(f.queryClient.getQueryData(['private-sales'])).toBeUndefined()
    expect(localStorage.getItem('offline-business-drafts')).toBe('keep')
    await flush()
    expect(fetch.mock.calls.some(([url, options]) => String(url).includes('clear-operator') && new Headers(options.headers).get('X-Operator-Session') === 'a'.repeat(64))).toBe(true)
  })

  it('keeps independent operator identities in two browser module contexts', async () => {
    const a = fixture()
    const b = fixture()
    a.initialize()
    b.initialize()
    a.activate(SELLER)
    b.activate(SUPERVISOR)
    a.queryClient.setQueryData(['private-sales'], 1)
    b.queryClient.setQueryData(['private-sales'], 2)
    a.clearOperatorSession()
    expect(a.store.getState().perfil).toBeNull()
    expect(b.store.getState().perfil.id).toBe(SUPERVISOR)
    expect(b.getOperatorSession().operatorId).toBe(SUPERVISOR)
    expect(b.queryClient.getQueryData(['private-sales'])).toBe(2)
    await b.authEvent('SIGNED_OUT', null)
    expect(b.getOperatorSession()).toBeNull()
  })
})

describe('captured identity in Worker request helpers', () => {
  it.each(['getAuthHeaders', 'authFetch'])('%s refuses a missing operator session before I/O', async method => {
    const f = fixture()
    await expect(f[method]('/api/test')).rejects.toThrow('PIN')
    expect(f.client.auth.getSession).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['getAuthHeaders', 'authFetch'])('%s refuses an expired operator session and clears its profile', async method => {
    const f = fixture()
    f.activate(SELLER, ACCOUNT, 1000)
    vi.setSystemTime(new Date(Date.now() + 2000))
    await expect(f[method]('/api/test')).rejects.toThrow('PIN')
    expect(f.store.getState().perfil).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['getAuthHeaders', 'authFetch'])('%s refuses a different business account', async method => {
    const f = fixture()
    f.activate()
    f.business = { access_token: 'other-token', user: { id: OTHER_ACCOUNT } }
    await expect(f[method]('/api/test')).rejects.toThrow('No autenticado')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['getAuthHeaders', 'authFetch'])('%s rejects switching while getSession is pending', async method => {
    const f = fixture()
    f.activate()
    const pending = defer()
    f.client.auth.getSession.mockReturnValueOnce(pending.promise)
    const result = f[method]('/api/test')
    const assertion = expect(result).rejects.toThrow('cambió')
    f.activate(SUPERVISOR)
    pending.resolve({ data: { session: f.business } })
    await assertion
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([new Headers({ 'X-Test': 'headers' }), [['X-Test', 'tuple']], { 'X-Test': 'object' }])('normalizes HeadersInit without allowing caller identity overrides', async extra => {
    const f = fixture()
    f.activate()
    const result = new Headers(await f.getAuthHeaders(extra))
    expect(result.get('X-Test')).toBeTruthy()
    expect(result.get('Authorization')).toBe('Bearer synthetic-business-token')
    expect(result.get('X-Operator-Id')).toBe(SELLER)
    expect(result.get('X-Operator-Session')).toBe('a'.repeat(64))
  })

  it('does not use persisted tokens after getSession returns null', async () => {
    const f = fixture()
    f.activate()
    localStorage.setItem('sb-synthetic-auth-token', JSON.stringify({ access_token: 'old-token' }))
    f.business = null
    await expect(f.getAuthHeaders()).rejects.toThrow('No autenticado')
  })

  it('does not retry a 401 under another operator or account', async () => {
    const f = fixture()
    f.activate()
    fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    const refresh = defer()
    f.client.auth.refreshSession.mockReturnValueOnce(refresh.promise)
    const result = f.authFetch('/api/test')
    const assertion = expect(result).rejects.toThrow('cambió')
    await flush()
    f.activate(SUPERVISOR)
    refresh.resolve({ data: { session: f.business } })
    await assertion
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retains caller cancellation without depending on AbortSignal.any', async () => {
    const f = fixture()
    f.activate()
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => { throw new Error('Unavailable API') })
    const cancellation = new AbortController()
    fetch.mockImplementationOnce(async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    const result = f.authFetch('/api/test', { signal: cancellation.signal, headers: new Headers({ 'X-Test': 'retained' }) })
    const assertion = expect(result).rejects.toThrow('cancelled')
    await flush()
    cancellation.abort(new Error('cancelled'))
    await assertion
    expect(new Headers(fetch.mock.calls[0][1].headers).get('X-Test')).toBe('retained')
  })
})

describe('late Response bodies and native semantics', () => {
  it.each(['json', 'text', 'arrayBuffer', 'blob', 'formData'])('rejects a late %s body after switching operators', async reader => {
    const f = fixture()
    f.activate()
    let stream
    const isForm = reader === 'formData'
    const response = new Response(new ReadableStream({ start(controller) { stream = controller } }), {
      status: 201, headers: { 'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json', 'X-Test': 'native' },
    })
    fetch.mockResolvedValueOnce(response)
    const guarded = await f.authFetch('/api/test')
    expect(guarded).toBeInstanceOf(Response)
    expect(guarded.status).toBe(201)
    expect(guarded.headers.get('X-Test')).toBe('native')
    expect(guarded.body).toBe(response.body)
    const reading = guarded[reader]()
    const assertion = expect(reading).rejects.toThrow('cambió')
    f.activate(SUPERVISOR)
    stream.enqueue(new TextEncoder().encode(isForm ? 'key=value' : '{"private":1}'))
    stream.close()
    await assertion
    expect(guarded.bodyUsed).toBe(true)
  })

  it('guards response clones and preserves one-use body behavior', async () => {
    const f = fixture()
    f.activate()
    fetch.mockResolvedValueOnce(Response.json({ value: 1 }))
    const response = await f.authFetch('/api/test')
    const clone = response.clone()
    expect(await response.json()).toEqual({ value: 1 })
    await expect(response.text()).rejects.toThrow()
    f.activate(SUPERVISOR)
    expect(() => clone.clone()).toThrow('cambió')
    await expect(clone.json()).rejects.toThrow('cambió')
  })

  it('rejects delayed response headers after session expiry', async () => {
    const f = fixture()
    f.activate(SELLER, ACCOUNT, 1000)
    const pending = defer()
    fetch.mockReturnValueOnce(pending.promise)
    const result = f.authFetch('/api/test')
    const assertion = expect(result).rejects.toThrow('cambió')
    await flush()
    vi.setSystemTime(new Date(Date.now() + 2000))
    pending.resolve(Response.json({ old: true }))
    await assertion
  })
})

describe('Supabase fetch adapter preserves Request semantics', () => {
  it('preserves Request headers, method and body while adding only verified REST identity', async () => {
    const f = fixture()
    f.activate()
    const req = new Request('https://supabase.integration.test/rest/v1/items', {
      method: 'POST', headers: { Authorization: 'Bearer native', apikey: 'synthetic-anon', 'Content-Type': 'application/json' }, body: '{"value":1}',
    })
    let forwarded
    fetch.mockImplementationOnce(async (input, options) => {
      forwarded = new Request(input, options)
      return Response.json({ ok: true })
    })
    const response = await f.customFetch(req)
    expect(forwarded.method).toBe('POST')
    expect(forwarded.headers.get('Authorization')).toBe('Bearer native')
    expect(forwarded.headers.get('apikey')).toBe('synthetic-anon')
    expect(forwarded.headers.get('X-Operator-Id')).toBe(SELLER)
    expect(await forwarded.text()).toBe('{"value":1}')
    expect(await response.json()).toEqual({ ok: true })
  })

  it('honors Request.signal when no init signal is supplied', async () => {
    const f = fixture()
    f.activate()
    const cancellation = new AbortController()
    const req = new Request('https://supabase.integration.test/rest/v1/items', { signal: cancellation.signal })
    fetch.mockImplementationOnce(async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    const result = f.customFetch(req)
    const assertion = expect(result).rejects.toThrow('Request cancelled')
    cancellation.abort(new Error('Request cancelled'))
    await assertion
  })

  it('keeps Request cancellation linked after response headers arrive', async () => {
    const f = fixture()
    f.activate()
    const cancellation = new AbortController()
    const req = new Request('https://supabase.integration.test/rest/v1/items', { signal: cancellation.signal })
    let forwardedSignal
    fetch.mockImplementationOnce(async (_url, options) => {
      forwardedSignal = options.signal
      return new Response(new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
      } }))
    })
    const response = await f.customFetch(req)
    const reading = response.text()
    const assertion = expect(reading).rejects.toThrow('body cancelled')
    cancellation.abort(new Error('body cancelled'))
    expect(forwardedSignal.aborted).toBe(true)
    await assertion
  })

  it('honors explicit RequestInit headers and signal overrides', async () => {
    const f = fixture()
    f.activate()
    const original = new AbortController()
    const overriding = new AbortController()
    const req = new Request('https://supabase.integration.test/rest/v1/items', {
      headers: { 'X-Original': 'discarded' }, signal: original.signal,
    })
    let captured
    fetch.mockImplementationOnce(async (_url, options) => { captured = options; return Response.json({ ok: true }) })
    await f.customFetch(req, { headers: new Headers({ 'X-Override': 'retained' }), signal: overriding.signal })
    expect(new Headers(captured.headers).has('X-Original')).toBe(false)
    expect(new Headers(captured.headers).get('X-Override')).toBe('retained')
    original.abort()
    expect(captured.signal.aborted).toBe(false)
    overriding.abort()
    expect(captured.signal.aborted).toBe(true)
  })

  it.each(['https://supabase.integration.test/auth/v1/user', 'https://external.integration.test/rest/v1/items'])('does not inject operator credentials into %s', async url => {
    const f = fixture()
    f.activate()
    const native = Response.json({ ok: true })
    fetch.mockResolvedValueOnce(native)
    const result = await f.customFetch(new Request(url, { headers: { Authorization: 'Bearer retained' } }))
    const headers = new Headers(fetch.mock.calls[0][1].headers)
    expect(headers.get('X-Operator-Session')).toBeNull()
    expect(headers.get('Authorization')).toBe('Bearer retained')
    expect(result).toBe(native)
  })

  it('allows account-only Auth but refuses REST without a live operator', async () => {
    const f = fixture()
    fetch.mockResolvedValueOnce(Response.json({ user: ACCOUNT }))
    await f.customFetch('https://supabase.integration.test/auth/v1/user')
    await expect(f.customFetch('https://supabase.integration.test/rest/v1/items')).rejects.toThrow('PIN')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not deliver a pending REST response after the operator changed', async () => {
    const f = fixture()
    f.activate()
    const pending = defer()
    fetch.mockReturnValueOnce(pending.promise)
    const result = f.customFetch('https://supabase.integration.test/rest/v1/items')
    const assertion = expect(result).rejects.toThrow('cambió')
    f.activate(SUPERVISOR)
    pending.resolve(Response.json({ private: true }))
    await assertion
  })
})

function operatorResult(operatorId) {
  return {
    ok: true,
    operator: { id: operatorId, nombre: 'Synthetic', rol: operatorId === SELLER ? 'vendedor' : 'supervisor' },
    operatorSession: {
      token: operatorId === SELLER ? 'a'.repeat(64) : 'b'.repeat(64),
      id: operatorId === SELLER ? 'c'.repeat(64) : 'd'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  }
}

describe('PIN attempts cannot publish stale state', () => {
  it('publishes a replacement profile only after installing its verified session', async () => {
    const f = fixture()
    f.activate()
    f.queryClient.setQueryData(['private-sales'], 90)
    fetch.mockResolvedValueOnce(Response.json(operatorResult(SUPERVISOR)))
    const seen = []
    const unsubscribe = f.store.subscribe(state => {
      if (state.perfil) seen.push({ profile: state.perfil.id, session: f.getOperatorSession()?.operatorId })
    })
    expect((await f.store.getState().switchOperator(SUPERVISOR, '4321')).ok).toBe(true)
    unsubscribe()
    expect(seen).toEqual([{ profile: SUPERVISOR, session: SUPERVISOR }])
    expect(f.queryClient.getQueryData(['private-sales'])).toBeUndefined()
    expect(new Headers(fetch.mock.calls[0][1].headers).get('X-Operator-Session')).toBe('a'.repeat(64))
  })

  it('rejects a late PIN success after full logout without restoring user or profile', async () => {
    const f = fixture()
    const pending = defer()
    fetch.mockImplementation(input => String(input).includes('switch-operator') ? pending.promise : Promise.resolve(Response.json({ ok: true })))
    const oldAttempt = f.store.getState().switchOperator(SELLER, '1234')
    await flush()
    await f.store.getState().logout()
    pending.resolve(Response.json(operatorResult(SELLER)))
    expect((await oldAttempt).ok).toBe(false)
    expect(f.store.getState().user).toBeNull()
    expect(f.store.getState().perfil).toBeNull()
    expect(f.getOperatorSession()).toBeNull()
  })

  it.each([401, 500])('ignores a late PIN HTTP %s error after a newer selection started', async status => {
    const f = fixture()
    const first = defer()
    const second = defer()
    fetch.mockImplementation(input => {
      if (String(input).includes('switch-operator')) return fetch.mock.calls.filter(([url]) => String(url).includes('switch-operator')).length === 1 ? first.promise : second.promise
      return Promise.resolve(Response.json({ ok: true }))
    })
    const oldAttempt = f.store.getState().switchOperator(SELLER, '1234')
    await flush()
    await f.store.getState().switchOut()
    const newAttempt = f.store.getState().switchOperator(SUPERVISOR, '4321')
    await flush()
    first.resolve(Response.json({ error: status === 401 ? 'PIN incorrecto' : 'Failure' }, { status }))
    expect((await oldAttempt).ok).toBe(false)
    expect(f.store.getState().loading).toBe(true)
    expect(f.store.getState().error).toBeNull()
    second.resolve(Response.json(operatorResult(SUPERVISOR)))
    expect((await newAttempt).ok).toBe(true)
    expect(f.store.getState().perfil.id).toBe(SUPERVISOR)
    expect(f.getOperatorSession().operatorId).toBe(SUPERVISOR)
  })

  it('revokes a late successful session without replacing the newer operator', async () => {
    const f = fixture()
    const first = defer()
    fetch.mockImplementation(input => String(input).includes('switch-operator') ? first.promise : Promise.resolve(Response.json({ ok: true })))
    const oldAttempt = f.store.getState().switchOperator(SELLER, '1234')
    await flush()
    await f.store.getState().switchOut()
    f.activate(SUPERVISOR)
    first.resolve(Response.json(operatorResult(SELLER)))
    expect((await oldAttempt).ok).toBe(false)
    expect(f.store.getState().perfil.id).toBe(SUPERVISOR)
    const revoked = fetch.mock.calls.filter(([url, options]) => String(url).includes('clear-operator') && new Headers(options.headers).get('X-Operator-Session') === 'a'.repeat(64))
    expect(revoked).toHaveLength(1)
  })

  it('does not replace the account from a stale refresh completion', async () => {
    const f = fixture()
    f.initialize()
    fetch.mockResolvedValueOnce(Response.json({ error: 'No autenticado' }, { status: 401 }))
    const pending = defer()
    f.client.auth.refreshSession.mockReturnValueOnce(pending.promise)
    const oldAttempt = f.store.getState().switchOperator(SELLER, '1234')
    await flush()
    f.business = { access_token: 'other-business', user: { id: OTHER_ACCOUNT } }
    await f.authEvent('SIGNED_IN', f.business)
    f.activate(SUPERVISOR, OTHER_ACCOUNT)
    pending.resolve({ data: { session: { access_token: 'old-refresh', user: { id: ACCOUNT } }, user: { id: ACCOUNT } } })
    expect((await oldAttempt).ok).toBe(false)
    expect(f.store.getState().user.id).toBe(OTHER_ACCOUNT)
    expect(f.store.getState().perfil.id).toBe(SUPERVISOR)
    expect(f.getOperatorSession().accountId).toBe(OTHER_ACCOUNT)
  })

  it('does not clear a new loading state when an old token lookup finishes empty', async () => {
    const f = fixture()
    const token = defer()
    f.client.auth.getSession.mockReturnValueOnce(token.promise)
    const oldAttempt = f.store.getState().switchOperator(SELLER, '1234')
    await f.store.getState().switchOut()
    f.store.setState({ loading: true, error: null })
    token.resolve({ data: { session: null } })
    expect((await oldAttempt).ok).toBe(false)
    expect(f.store.getState().loading).toBe(true)
    expect(f.store.getState().error).toBeNull()
  })
})
