// Per-tab credentials are never persisted in profiles or browser storage.
let current = null
const listeners = new Set()
let expiryTimer = null
const emit = () => { for (const listener of listeners) listener() }

export function clearOperatorSession() {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  if (!current) return
  current = null
  emit()
}

export function setOperatorSession(session, { accountId, operatorId }) {
  if (!/^[a-f0-9]{64}$/.test(session?.token || '') || !/^[a-f0-9]{64}$/.test(session?.id || '')
    || !accountId || !operatorId || !(Date.parse(session.expiresAt) > Date.now())) {
    clearOperatorSession()
    throw new Error('La sesión del operador no es válida. Vuelve a introducir tu PIN.')
  }
  if (expiryTimer) clearTimeout(expiryTimer)
  current = Object.freeze({ token: session.token, id: session.id, expiresAt: session.expiresAt, accountId, operatorId })
  expiryTimer = setTimeout(checkOperatorSessionExpiry, Math.min(Date.parse(session.expiresAt) - Date.now(), 2147483647))
  emit()
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
