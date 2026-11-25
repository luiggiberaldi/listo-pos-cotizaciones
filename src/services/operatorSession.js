// Session credentials persist across reloads/reopens for up to 12 hours (matching server TTL)
// until explicit logout/switchOut or server revocation/PIN change.
const OPERATOR_STORAGE_KEY = (() => {
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL
    const ref = url ? new URL(url).hostname.split('.')[0] : ''
    return ref ? `construacero_operator_session_${ref}` : 'construacero_operator_session'
  } catch {
    return 'construacero_operator_session'
  }
})()

let current = null
const listeners = new Set()
let expiryTimer = null
const emit = () => { for (const listener of listeners) listener() }

function isValidHex64(value) {
  return /^[a-f0-9]{64}$/.test(value || '')
}

function parseStoredSession(raw, expectedAccountId = null) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!isValidHex64(parsed?.token) || !isValidHex64(parsed?.id)
      || !parsed?.accountId || !parsed?.operatorId
      || !(Date.parse(parsed.expiresAt) > Date.now())) {
      return null
    }
    if (expectedAccountId && parsed.accountId !== expectedAccountId) return null
    return Object.freeze({
      token: parsed.token,
      id: parsed.id,
      expiresAt: parsed.expiresAt,
      accountId: parsed.accountId,
      operatorId: parsed.operatorId,
    })
  } catch {
    return null
  }
}

function readStoredSession(expectedAccountId = null) {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(OPERATOR_STORAGE_KEY)
    if (!raw) return null
    const parsed = parseStoredSession(raw, expectedAccountId)
    if (!parsed) {
      localStorage.removeItem(OPERATOR_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStoredSession(session) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(OPERATOR_STORAGE_KEY, JSON.stringify({
      token: session.token,
      id: session.id,
      expiresAt: session.expiresAt,
      accountId: session.accountId,
      operatorId: session.operatorId,
    }))
  } catch { /* Storage no disponible */ }
}

function removeStoredSession() {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(OPERATOR_STORAGE_KEY)
  } catch { /* Storage no disponible */ }
}

function scheduleExpiryTimer(expiresAt) {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = setTimeout(checkOperatorSessionExpiry, Math.min(Math.max(0, Date.parse(expiresAt) - Date.now()), 2147483647))
}

export function clearOperatorSession({ removeStorage = true } = {}) {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  if (removeStorage) removeStoredSession()
  if (!current) return
  current = null
  emit()
}

export function setOperatorSession(session, { accountId, operatorId }) {
  if (!isValidHex64(session?.token) || !isValidHex64(session?.id)
    || !accountId || !operatorId || !(Date.parse(session.expiresAt) > Date.now())) {
    clearOperatorSession()
    throw new Error('La sesión del operador no es válida. Vuelve a introducir tu PIN.')
  }
  current = Object.freeze({ token: session.token, id: session.id, expiresAt: session.expiresAt, accountId, operatorId })
  writeStoredSession(current)
  scheduleExpiryTimer(current.expiresAt)
  emit()
}

export function restoreOperatorSession(expectedAccountId = null) {
  const active = getOperatorSession()
  if (active) {
    if (expectedAccountId && active.accountId !== expectedAccountId) {
      clearOperatorSession()
      return null
    }
    return active
  }
  const stored = readStoredSession(expectedAccountId)
  if (!stored) return null
  current = stored
  scheduleExpiryTimer(current.expiresAt)
  return current
}

export function getOperatorSession() {
  return current && Date.parse(current.expiresAt) > Date.now() ? current : null
}

// Called on focus/visibility as browser suspension can delay the expiry timer.
export function checkOperatorSessionExpiry() {
  if (current && !getOperatorSession()) clearOperatorSession()
}

export function subscribeOperatorSession(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getOperatorSessionHeaders() {
  const session = getOperatorSession()
  return session ? { 'X-Operator-Session': session.token, 'X-Operator-Id': session.operatorId } : {}
}

export function requireOperatorSession() {
  checkOperatorSessionExpiry()
  const session = getOperatorSession()
  if (!session) throw new Error('Vuelve a introducir tu PIN para continuar.')
  return session
}

export function assertOperatorSession(session) {
  checkOperatorSessionExpiry()
  if (!session || getOperatorSession() !== session) {
    const error = new Error('La sesión del operador cambió; se canceló la operación.')
    error.code = 'OPERATOR_SESSION_CHANGED'
    throw error
  }
}

// Keep the native Response/body intact while guarding deferred body readers and clones.
export function guardOperatorResponse(response, session) {
  const readers = new Set(['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes'])
  return new Proxy(response, {
    get(target, property) {
      if (property === 'clone') return () => {
        assertOperatorSession(session)
        return guardOperatorResponse(target.clone(), session)
      }
      const value = Reflect.get(target, property, target)
      if (readers.has(property) && typeof value === 'function') return async (...args) => {
        assertOperatorSession(session)
        const result = await value.apply(target, args)
        assertOperatorSession(session)
        return result
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== OPERATOR_STORAGE_KEY) return
    if (!event.newValue) {
      clearOperatorSession({ removeStorage: false })
      return
    }
    const next = parseStoredSession(event.newValue)
    if (!next || !current || next.id !== current.id || next.operatorId !== current.operatorId || next.accountId !== current.accountId) {
      clearOperatorSession({ removeStorage: false })
    }
  })
}

export { OPERATOR_STORAGE_KEY }
