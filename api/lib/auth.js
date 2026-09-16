// api/lib/auth.js
import { jsonError, isValidUuid } from './utils.js'
import { resolveOperatorSession, SUPER_ADMIN_UUID } from './operatorSession.js'

export { SUPER_ADMIN_UUID }

const AUTH_CACHE_TTL_MS = 60_000
const AUTH_CACHE_MAX = 500
const userCache = new Map()

// Kept for existing callers; operator permissions are never cached.
export function invalidateOperatorCache() {}

export function supaServiceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

// Read expiry only after the auth server has verified the complete token.
function verifiedTokenExpiry(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

export async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token) return null
  const cacheKey = `${env.SUPABASE_URL}\n${token}`
  const cached = userCache.get(cacheKey)
  let rawUser = cached?.expiresAt > Date.now() ? cached.user : null
  if (!rawUser) {
    userCache.delete(cacheKey)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY,
        },
        signal: controller.signal,
      })
      if (!response.ok) return null
      rawUser = await response.json()
      if (!isValidUuid(rawUser?.id)) return null
      const expiry = verifiedTokenExpiry(token)
      if (expiry !== null && expiry <= Date.now()) return null
      // Unknown-expiry tokens remain uncached rather than extending their lifetime.
      if (expiry !== null) {
        if (userCache.size >= AUTH_CACHE_MAX) userCache.delete(userCache.keys().next().value)
        userCache.set(cacheKey, {
          user: rawUser,
          expiresAt: Math.min(Date.now() + AUTH_CACHE_TTL_MS, expiry),
        })
      }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  // Shared account metadata is deliberately not an operator authority.
  const user = {
    ...rawUser,
    operator_id: null,
    operator_rol: null,
    operator_nombre: null,
    operator_es_externo: null,
    operator_session_id: null,
    operator_session_expires_at: null,
    operator_virtual_developer: false,
    operador: null,
  }
  const tokenHeader = request.headers.get('X-Operator-Session')
  const operatorHeader = request.headers.get('X-Operator-Id')
  if (!tokenHeader) return operatorHeader ? null : user

  try {
    const session = await resolveOperatorSession(env, tokenHeader, user.id)
    if (!session || (operatorHeader && operatorHeader !== session.operator.id)) return null
    user.operator_id = session.operator.id
    user.operator_rol = session.operator.rol
    user.operator_nombre = session.operator.nombre
    user.operator_es_externo = session.operator.es_externo
    user.operator_session_id = session.id
    user.operator_session_expires_at = session.expiresAt
    user.operator_virtual_developer = session.virtualDeveloper
    user.operador = session.operator
    return user
  } catch {
    return null
  }
}

// Legacy role helpers accept IDs only from a successfully verified session context.
// An optional account ID lets newer callers repeat the tenant constraint explicitly.
export async function getOperatorRole(operatorId, env, accountId = null) {
  if (!isValidUuid(operatorId)) return null
  if (operatorId === SUPER_ADMIN_UUID) return 'desarrollador'
  if (accountId !== null && !isValidUuid(accountId)) return null
  const tenantFilter = accountId ? `&cuenta_id=eq.${accountId}` : ''
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operatorId}&activo=eq.true${tenantFilter}&select=rol`,
      { headers: supaServiceHeaders(env) },
    )
    if (!response.ok) return null
    const rows = await response.json()
    return Array.isArray(rows) && rows.length === 1 ? rows[0].rol ?? null : null
  } catch {
    return null
  }
}

export async function verifySupervisor(operatorId, env, accountId = null) {
  const role = await getOperatorRole(operatorId, env, accountId)
  return ['supervisor', 'jefe', 'administracion', 'desarrollador'].includes(role)
}

export async function verifyPrivileged(operatorId, env, accountId = null) {
  return verifySupervisor(operatorId, env, accountId)
}

export async function validateOperator(request, env, { requireSupervisor = false } = {}) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return { error: jsonError('No autenticado', 401, request) }
  if (!user.operator_session_id || !user.operador) {
    return { error: jsonError('No hay una sesión de operador activa', 403, request) }
  }
  const operador = user.operador
  if (operador.cuenta_id !== user.id ||
      (operador.id === SUPER_ADMIN_UUID && !user.operator_virtual_developer)) {
    return { error: jsonError('Operador no autorizado', 403, request) }
  }
  if (requireSupervisor && !['supervisor', 'jefe', 'logistica', 'administracion', 'desarrollador'].includes(operador.rol)) {
    return { error: jsonError('Solo supervisores, logistica o administracion pueden realizar esta acción', 403, request) }
  }
  return {
    user,
    operador,
    headers: supaServiceHeaders(env),
    ip: request.headers.get('CF-Connecting-IP') || null,
  }
}
