import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCurrentOperator, handleGetTasaConfig, handleSwitchOperator } from '../auth-operators.js'
import { hashPinPBKDF2 } from '../../lib/crypto.js'
import { getOperatorCredentialHash, OPERATOR_SESSION_LIFETIME_MS, sha256Hex, SUPER_ADMIN_UUID } from '../../lib/operatorSession.js'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const SELLER = '33333333-3333-4333-8333-333333333333'
const EXT_SELLER = '44444444-4444-4444-8444-444444444444'
const ENV = {
  SUPABASE_URL: 'https://prod-test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_KEY: 'service-key',
}

function makeFakeJwt(expOffsetSec = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + expOffsetSec })).toString('base64url')
  return `jwt-ok:${header}.${payload}.sig`
}

function createHarness() {
  const sessions = new Map()
  const usuarios = []
  const configs = new Map()

  const fetchMock = vi.fn(async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (options.method || 'GET').toUpperCase()

    if (url.pathname === '/auth/v1/user') {
      const auth = options.headers?.Authorization || ''
      if (auth.startsWith('Bearer jwt-ok:')) {
        return Response.json({ id: ACCOUNT, email: 'empresa@test.local' })
      }
      return new Response('Unauthorized', { status: 401 })
    }

    if (url.pathname === '/rest/v1/operator_sessions') {
      if (method === 'POST') {
        const body = JSON.parse(options.body)
        sessions.set(body.token_hash, { ...body, revoked_at: null })
        return new Response(null, { status: 201 })
      }
      if (method === 'PATCH') {
        const hash = url.searchParams.get('token_hash')?.replace(/^eq\./, '')
        const existing = sessions.get(hash)
        if (existing) existing.revoked_at = new Date().toISOString()
        return new Response(null, { status: 204 })
      }
      const hash = url.searchParams.get('token_hash')?.replace(/^eq\./, '')
      const row = sessions.get(hash)
      if (!row || row.revoked_at !== null || Date.parse(row.expires_at) <= Date.now()) {
        return Response.json([])
      }
      return Response.json([row])
    }

    if (url.pathname === '/rest/v1/usuarios') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      const activo = url.searchParams.get('activo')?.replace(/^eq\./, '')
      const matches = usuarios.filter(u => u.id === id && (!activo || String(u.activo) === activo))
      return Response.json(matches)
    }

    if (url.pathname === '/rest/v1/configuracion_negocio') {
      const cuentaId = url.searchParams.get('cuenta_id')?.replace(/^eq\./, '')
      const row = configs.get(cuentaId)
      return Response.json(row ? [row] : [])
    }

    if (url.pathname === '/rest/v1/auditoria') {
      return new Response(null, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${method} ${url.pathname}${url.search}`)
  })

  return { getJwt: () => makeFakeJwt(3600), validJwt: makeFakeJwt(3600), sessions, usuarios, configs, fetchMock }
}

let harness

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
  harness = createHarness()
  vi.stubGlobal('fetch', harness.fetchMock)

  const pinHash = await hashPinPBKDF2('1357', 'salt1')
  const extPinHash = await hashPinPBKDF2('2468', 'salt2')
  harness.usuarios.push(
    {
      id: SELLER, cuenta_id: ACCOUNT, activo: true, nombre: 'Pedro Perez', rol: 'vendedor',
      codigo: 'V1', pin_hash: pinHash, pin_salt: 'salt1', color: '#14b8a6',
      markup_pct: null, comision_pct: 5, comision_pct_cabilla: 2, es_externo: false,
    },
    {
      id: EXT_SELLER, cuenta_id: ACCOUNT, activo: true, nombre: 'Externo', rol: 'vendedor',
      codigo: 'V2', pin_hash: extPinHash, pin_salt: 'salt2', color: '#D97706',
      markup_pct: 10, comision_pct: 4, comision_pct_cabilla: 1, es_externo: true,
    },
  )
  harness.configs.set(ACCOUNT, {
    cuenta_id: ACCOUNT,
    tasa_bcv_manual: 58.5,
    actualizado_en: '2026-11-24T11:55:00Z',
    markup_pct_externo: 18,
    gate_password_hash: 'secret-never-expose',
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('auth-operators — sesión de 12h y tasa pre-PIN (producción)', () => {
  it('handleCurrentOperator restaura el perfil dentro de las 12 horas (con y sin X-Operator-Id) y rechaza al cambiar PIN', async () => {
    const loginRes = await handleSwitchOperator(new Request('https://prod.test/api/auth/switch-operator', {
      method: 'POST',
      headers: { Authorization: `Bearer ${harness.validJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator_id: EXT_SELLER, pin: '2468' }),
    }), ENV)
    expect(loginRes.status).toBe(200)
    const loginData = await loginRes.json()
    const token = loginData.operatorSession.token
    expect(Date.parse(loginData.operatorSession.expiresAt) - Date.now()).toBe(OPERATOR_SESSION_LIFETIME_MS)

    // 11 horas después: la sesión sigue válida (probando ruta paralela con X-Operator-Id y secuencial sin él)
    await vi.advanceTimersByTimeAsync(11 * 60 * 60 * 1000)
    const freshJwt = harness.getJwt()
    const checkWithHint = await handleCurrentOperator(new Request('https://prod.test/api/auth/current-operator', {
      headers: { Authorization: `Bearer ${freshJwt}`, 'X-Operator-Session': token, 'X-Operator-Id': EXT_SELLER },
    }), ENV)
    expect(checkWithHint.status).toBe(200)
    expect((await checkWithHint.json()).operator).toMatchObject({ id: EXT_SELLER, rol: 'vendedor', markup_pct: 18, es_externo: true })

    const checkNoHint = await handleCurrentOperator(new Request('https://prod.test/api/auth/current-operator', {
      headers: { Authorization: `Bearer ${freshJwt}`, 'X-Operator-Session': token },
    }), ENV)
    expect(checkNoHint.status).toBe(200)
    expect((await checkNoHint.json()).operator.id).toBe(EXT_SELLER)

    // Si cambian el PIN del operador, la sesión de 12h queda inválida de inmediato (403)
    harness.usuarios[1].pin_hash = await hashPinPBKDF2('9999', 'salt2')
    const checkChangedPin = await handleCurrentOperator(new Request('https://prod.test/api/auth/current-operator', {
      headers: { Authorization: `Bearer ${freshJwt}`, 'X-Operator-Session': token, 'X-Operator-Id': EXT_SELLER },
    }), ENV)
    expect(checkChangedPin.status).toBe(403)
    expect((await checkChangedPin.json()).code).toBe('OPERATOR_SESSION_INVALID')
  })

  it('handleCurrentOperator devuelve 403 al pasar las 12 horas exactas y 401 si falta JWT de cuenta', async () => {
    const token = 'a'.repeat(64)
    const hash = await sha256Hex(token)
    const credHash = await getOperatorCredentialHash(harness.usuarios[0])
    harness.sessions.set(hash, {
      token_hash: hash, cuenta_id: ACCOUNT, operator_id: SELLER,
      credential_hash: credHash, virtual_developer: false,
      expires_at: new Date(Date.now() + OPERATOR_SESSION_LIFETIME_MS).toISOString(),
      revoked_at: null,
    })

    const noJwt = await handleCurrentOperator(new Request('https://prod.test/api/auth/current-operator', {
      headers: { 'X-Operator-Session': token },
    }), ENV)
    expect(noJwt.status).toBe(401)

    await vi.advanceTimersByTimeAsync(OPERATOR_SESSION_LIFETIME_MS + 1000)
    const expired = await handleCurrentOperator(new Request('https://prod.test/api/auth/current-operator', {
      headers: { Authorization: `Bearer ${harness.getJwt()}`, 'X-Operator-Session': token, 'X-Operator-Id': SELLER },
    }), ENV)
    expect(expired.status).toBe(403)
  })

  it('handleCurrentOperator soporta desarrollador virtual', async () => {
    const token = 'b'.repeat(64)
    const hash = await sha256Hex(token)
    harness.sessions.set(hash, {
      token_hash: hash, cuenta_id: ACCOUNT, operator_id: SUPER_ADMIN_UUID,
      credential_hash: null, virtual_developer: true,
      expires_at: new Date(Date.now() + OPERATOR_SESSION_LIFETIME_MS).toISOString(),
      revoked_at: null,
    })
    const res = await handleCurrentOperator(new Request('https://prod.test/api/auth/current-operator', {
      headers: { Authorization: `Bearer ${harness.validJwt}`, 'X-Operator-Session': token, 'X-Operator-Id': SUPER_ADMIN_UUID },
    }), ENV)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.operator).toMatchObject({ id: SUPER_ADMIN_UUID, rol: 'desarrollador' })
  })

  it('handleGetTasaConfig entrega solo tasa_bcv_manual sin requerir PIN ni exponer secretos', async () => {
    const unauth = await handleGetTasaConfig(new Request('https://prod.test/api/auth/tasa-config'), ENV)
    expect(unauth.status).toBe(401)

    const ok = await handleGetTasaConfig(new Request('https://prod.test/api/auth/tasa-config', {
      headers: { Authorization: `Bearer ${harness.validJwt}` },
    }), ENV)
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body).toEqual({ tasa_bcv_manual: 58.5, actualizado_en: '2026-11-24T11:55:00Z' })
    expect(body.gate_password_hash).toBeUndefined()
    expect(body.markup_pct_externo).toBeUndefined()
  })
})
