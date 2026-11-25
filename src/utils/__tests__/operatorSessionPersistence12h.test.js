import { build } from 'esbuild'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222'
const SELLER = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'a'.repeat(64)
const SESSION_ID = 'c'.repeat(64)

let source
const contexts = []
const require = createRequire(import.meta.url)
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

beforeAll(async () => {
  const root = fs.realpathSync.native(process.cwd())
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `export { default as store } from './src/store/useAuthStore.js';
        export { default as queryClient } from './src/lib/queryClient.js';
        export * from './src/services/operatorSession.js';`,
      resolveDir: root,
    },
    platform: 'node',
    format: 'cjs',
    bundle: true,
    write: false,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_SUPABASE_URL': '"https://prod-test.supabase.co"',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '"synthetic-anon"',
      'import.meta.env.VITE_WORKER_ORIGIN': '""',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [{
      name: 'synthetic-io-only',
      setup(plugin) {
        plugin.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'supabase-transport', namespace: 'test-io' }))
        plugin.onResolve({ filter: /queryPersister$/ }, () => ({ path: 'persister', namespace: 'test-io' }))
        plugin.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({
          contents: args.path === 'persister'
            ? 'export const indexedDbPersister = fixture.persister;'
            : 'export function createClient(url, key, options) { fixture.customFetch = options.global.fetch; return fixture.client; }',
          loader: 'js',
        }))
      },
    }],
  })
  source = result.outputFiles[0].text
})

function makeStorage() {
  const data = {}
  Object.defineProperties(data, {
    getItem: { value: k => (Object.hasOwn(data, k) ? data[k] : null) },
    setItem: { value: (k, v) => { data[k] = String(v) } },
    removeItem: { value: k => { delete data[k] } },
    key: { value: i => Object.keys(data)[i] ?? null },
  })
  return data
}

function createFixture({ sharedStorage } = {}) {
  const user = { id: ACCOUNT, email: 'empresa@test.local' }
  const f = {
    business: { user, access_token: 'jwt-valid', expires_at: Math.floor(Date.now() / 1000) + 3600 },
    persister: { removeClient: vi.fn(async () => {}) },
    cleanups: [],
    sharedStorage,
  }
  f.client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: f.business } })),
      refreshSession: vi.fn(async () => ({ data: { session: f.business, user: f.business?.user } })),
      signInWithPassword: vi.fn(async () => ({ data: { session: f.business, user: f.business?.user }, error: null })),
      signOut: vi.fn(async () => { if (f.authEvent) await f.authEvent('SIGNED_OUT', null); return { error: null } }),
      onAuthStateChange: vi.fn(cb => { f.authEvent = cb; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    },
    realtime: { setAuth: vi.fn() },
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'fixture', source)(require, mod, mod.exports, f)
  Object.assign(f, mod.exports)
  f.initialize = () => f.cleanups.push(f.store.getState().initialize())
  contexts.push(f)
  return f
}

let sharedStorage
let winTarget

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
  sharedStorage = makeStorage()
  winTarget = new EventTarget()
  vi.stubGlobal('localStorage', sharedStorage)
  vi.stubGlobal('window', winTarget)
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/auth/current-operator')) {
      return Response.json({
        ok: true,
        operator: { id: SELLER, nombre: 'Pedro Perez', rol: 'vendedor', color: '#14b8a6', es_externo: false },
        operatorSession: { id: SESSION_ID, expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString() },
      })
    }
    if (url.includes('/api/auth/clear-operator')) return Response.json({ ok: true })
    throw new Error(`Unexpected fetch: ${url}`)
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

describe('Persistencia de sesión con PIN de 12 horas en producción', () => {
  it('persiste la sesión al recargar (nuevo contexto) y restaura el perfil tras validar con el Worker', async () => {
    const tab1 = createFixture()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    tab1.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: ACCOUNT, operatorId: SELLER })
    expect(sharedStorage.getItem(tab1.OPERATOR_STORAGE_KEY)).toBeTruthy()

    // Simular recarga completa (nueva instancia del store y del módulo operatorSession)
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    const reloaded = createFixture()
    reloaded.initialize()
    await reloaded.authEvent('INITIAL_SESSION', reloaded.business)
    await flush()

    expect(reloaded.getOperatorSession()?.operatorId).toBe(SELLER)
    expect(reloaded.store.getState().perfil).toMatchObject({ id: SELLER, nombre: 'Pedro Perez', rol: 'vendedor' })
    expect(reloaded.store.getState().initialized).toBe(true)
  })

  it('vence automáticamente tras 12 horas y limpia almacenamiento y perfil', async () => {
    const tab1 = createFixture()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    tab1.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: ACCOUNT, operatorId: SELLER })

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000 + 1000)
    const reopened = createFixture()
    reopened.initialize()
    await reopened.authEvent('INITIAL_SESSION', reopened.business)
    await flush()

    expect(reopened.getOperatorSession()).toBeNull()
    expect(reopened.store.getState().perfil).toBeNull()
    expect(sharedStorage.getItem(reopened.OPERATOR_STORAGE_KEY)).toBeNull()
  })

  it('limpia la sesión guardada si el servidor responde 403 OPERATOR_SESSION_INVALID al reabrir', async () => {
    const tab1 = createFixture()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    tab1.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: ACCOUNT, operatorId: SELLER })

    fetch.mockResolvedValueOnce(Response.json({ error: 'Revocada', code: 'OPERATOR_SESSION_INVALID' }, { status: 403 }))

    const reopened = createFixture()
    reopened.initialize()
    await reopened.authEvent('INITIAL_SESSION', reopened.business)
    await flush()

    expect(reopened.getOperatorSession()).toBeNull()
    expect(reopened.store.getState().perfil).toBeNull()
    expect(sharedStorage.getItem(reopened.OPERATOR_STORAGE_KEY)).toBeNull()
  })

  it('no restaura una sesión de otra cuenta de negocio', async () => {
    const tab1 = createFixture()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    tab1.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: OTHER_ACCOUNT, operatorId: SELLER })

    const reopened = createFixture()
    reopened.initialize()
    await reopened.authEvent('INITIAL_SESSION', reopened.business)
    await flush()

    expect(reopened.getOperatorSession()).toBeNull()
    expect(reopened.store.getState().perfil).toBeNull()
  })

  it('en modo sin internet restaura perfil cacheado solo si hay sesión válida dentro de las 12 horas', async () => {
    const tab1 = createFixture()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    tab1.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: ACCOUNT, operatorId: SELLER })
    sharedStorage.setItem(`listo_perfil_cache-${ACCOUNT}`, JSON.stringify({
      id: SELLER, nombre: 'Pedro Offline', rol: 'vendedor', activo: true, _cachedAt: Date.now(),
    }))

    vi.stubGlobal('navigator', { onLine: false })
    const reopened = createFixture()
    reopened.initialize()
    await reopened.authEvent('INITIAL_SESSION', reopened.business)
    await flush()

    expect(reopened.getOperatorSession()?.operatorId).toBe(SELLER)
    expect(reopened.store.getState().perfil).toMatchObject({ id: SELLER, nombre: 'Pedro Offline' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('switchOut cierra la sesión de operador, borra localStorage y avisa a otras pestañas vía storage', async () => {
    const f = createFixture()
    f.initialize()
    await f.authEvent('INITIAL_SESSION', f.business)
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    f.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: ACCOUNT, operatorId: SELLER })
    f.store.setState({ perfil: { id: SELLER, nombre: 'Pedro Perez', rol: 'vendedor' } })

    await f.store.getState().switchOut()
    expect(f.getOperatorSession()).toBeNull()
    expect(f.store.getState().perfil).toBeNull()
    expect(sharedStorage.getItem(f.OPERATOR_STORAGE_KEY)).toBeNull()

    // Simular otra pestaña recibiendo evento storage de borrado
    const tab2 = createFixture()
    tab2.initialize()
    await tab2.authEvent('INITIAL_SESSION', tab2.business)
    tab2.setOperatorSession({ token: TOKEN, id: SESSION_ID, expiresAt }, { accountId: ACCOUNT, operatorId: SELLER })
    tab2.store.setState({ perfil: { id: SELLER, nombre: 'Pedro Perez', rol: 'vendedor' } })

    const ev = new Event('storage')
    ev.key = tab2.OPERATOR_STORAGE_KEY
    ev.newValue = null
    winTarget.dispatchEvent(ev)
    expect(tab2.getOperatorSession()).toBeNull()
    expect(tab2.store.getState().perfil).toBeNull()
  })

  it('LoginPage conserva diseño OP-2026-031, comparte HeaderTasas y AppLayout dice "Cerrar sesión"', () => {
    const loginCode = fs.readFileSync(new URL('../../modules/auth/LoginPage.jsx', import.meta.url), 'utf8')
    const appLayoutCode = fs.readFileSync(new URL('../../components/layout/AppLayout.jsx', import.meta.url), 'utf8')
    const headerTasasCode = fs.readFileSync(new URL('../../components/layout/HeaderTasas.jsx', import.meta.url), 'utf8')
    const avisoCode = fs.readFileSync(new URL('../../components/ui/AvisoVersionNueva.jsx', import.meta.url), 'utf8')

    expect(loginCode).toContain('<HeaderTasas soloLectura />')
    expect(loginCode).toContain('<BuscarPorInicial')
    expect(loginCode).toContain('window.confirm')
    expect(appLayoutCode).toContain('<HeaderTasas soloLectura={!esPrivilegiado} />')
    expect(appLayoutCode).toContain('Cerrar sesión')
    expect(appLayoutCode).not.toContain('Cambiar usuario')
    expect(headerTasasCode).toContain('BCV:')
    expect(headerTasasCode).toContain('EUR:')
    expect(headerTasasCode).toContain('USDT:')
    expect(headerTasasCode).toContain('<BcvWidget soloLectura={soloLectura} />')
    expect(avisoCode).toContain('sesión de 12 horas')
  })
})
