import { isValidUuid } from './utils.js'

export const SUPER_ADMIN_UUID = '00000000-0000-0000-0000-000000000000'
export const OPERATOR_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000
const TOKEN_RE = /^[a-f0-9]{64}$/

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  }
}

async function sessionFetch(env, path, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: serviceHeaders(env),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Operator session storage unavailable')
    return response
  } finally {
    clearTimeout(timer)
  }
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function getOperatorCredentialHash(operator) {
  if (!operator?.pin_hash || !operator?.pin_salt) return null
  return sha256Hex(`${operator.pin_hash}:${operator.pin_salt}`)
}

export async function issueOperatorSession(env, { accountId, operator, virtualDeveloper = false }) {
  if (!isValidUuid(accountId) || !isValidUuid(operator?.id)) throw new Error('Invalid operator session identity')
  if ((operator.id === SUPER_ADMIN_UUID) !== virtualDeveloper) throw new Error('Invalid virtual operator session')
  const credentialHash = virtualDeveloper ? null : await getOperatorCredentialHash(operator)
  if (!virtualDeveloper && !credentialHash) throw new Error('Operator credentials unavailable')

  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  const id = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + OPERATOR_SESSION_LIFETIME_MS).toISOString()
  await sessionFetch(env, 'operator_sessions', {
    method: 'POST',
    body: JSON.stringify({
      token_hash: id,
      cuenta_id: accountId,
      operator_id: operator.id,
      credential_hash: credentialHash,
      virtual_developer: virtualDeveloper,
      expires_at: expiresAt,
    }),
  })
  return { token, id, expiresAt }
}

export async function revokeOperatorSession(env, token, accountId) {
  if (!token) return
  if (!TOKEN_RE.test(token) || !isValidUuid(accountId)) throw new Error('Invalid operator session')
  const hash = await sha256Hex(token)
  await sessionFetch(env, `operator_sessions?token_hash=eq.${hash}&cuenta_id=eq.${accountId}&revoked_at=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  })
}

export async function resolveOperatorSession(env, token, accountId) {
  if (!TOKEN_RE.test(token || '') || !isValidUuid(accountId)) return null
  const hash = await sha256Hex(token)
  const now = new Date().toISOString()
  const response = await sessionFetch(env,
    `operator_sessions?token_hash=eq.${hash}&cuenta_id=eq.${accountId}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=token_hash,cuenta_id,operator_id,credential_hash,virtual_developer,expires_at,revoked_at&limit=1`)
  const sessions = await response.json()
  if (!Array.isArray(sessions) || sessions.length !== 1) return null
  const session = sessions[0]
  const expiry = Date.parse(session.expires_at)
  if (session.token_hash !== hash || session.cuenta_id !== accountId || session.revoked_at != null ||
      !Number.isFinite(expiry) || expiry <= Date.now() || !isValidUuid(session.operator_id)) return null

  if (session.virtual_developer === true) {
    if (session.operator_id !== SUPER_ADMIN_UUID || session.credential_hash != null) return null
    return {
      id: hash,
      expiresAt: session.expires_at,
      virtualDeveloper: true,
      operator: {
        id: SUPER_ADMIN_UUID, cuenta_id: accountId, nombre: 'Desarrollador',
        rol: 'desarrollador', color: '#8b5cf6', markup_pct: null, es_externo: false,
      },
    }
  }
  if (session.operator_id === SUPER_ADMIN_UUID) return null

  const operatorResponse = await sessionFetch(env,
    `usuarios?id=eq.${session.operator_id}&cuenta_id=eq.${accountId}&activo=eq.true&select=id,cuenta_id,activo,nombre,rol,color,markup_pct,comision_pct,comision_pct_cabilla,es_externo,pin_hash,pin_salt`)
  const operators = await operatorResponse.json()
  if (!Array.isArray(operators) || operators.length !== 1) return null
  const operator = operators[0]
  if (operator.id !== session.operator_id || operator.cuenta_id !== accountId || operator.activo !== true
    || !['jefe', 'supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion', 'logistica', 'desarrollador'].includes(operator.rol)) return null
  const credentialHash = await getOperatorCredentialHash(operator)
  if (!credentialHash || credentialHash !== session.credential_hash) return null

  return {
    id: hash,
    expiresAt: session.expires_at,
    virtualDeveloper: false,
    operator: {
      id: operator.id, cuenta_id: operator.cuenta_id, nombre: operator.nombre,
      rol: operator.rol, color: operator.color, markup_pct: operator.markup_pct ?? null,
      comision_pct: operator.comision_pct ?? null, comision_pct_cabilla: operator.comision_pct_cabilla ?? null,
      es_externo: !!operator.es_externo,
    },
  }
}
