// Requests and deferred response bodies remain bound to their original operator.
import supabase from './supabase/client'
import { apiUrl } from './apiBase'
import { refreshSessionSingleFlight } from './sessionManager'
import { requireOperatorSession, assertOperatorSession, guardOperatorResponse } from './operatorSession'

const DEFAULT_TIMEOUT = 15000

export async function authFetch(path, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOpts } = options
  const operatorSession = requireOperatorSession()
  const { data: { session } } = await supabase.auth.getSession()
  assertOperatorSession(operatorSession)
  if (!session?.access_token || session.user?.id !== operatorSession.accountId) throw new Error('No autenticado')
  const send = async token => {
    assertOperatorSession(operatorSession)
    const controller = new AbortController()
    const upstreamSignal = fetchOpts.signal
    const onAbort = () => controller.abort(upstreamSignal.reason)
    if (upstreamSignal?.aborted) onAbort()
    else upstreamSignal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const headers = new Headers(fetchOpts.headers)
      headers.set('Authorization', `Bearer ${token}`)
      headers.set('X-Operator-Id', operatorSession.operatorId)
      headers.set('X-Operator-Session', operatorSession.token)
      const response = await fetch(apiUrl(path), { ...fetchOpts, headers, signal: controller.signal })
      assertOperatorSession(operatorSession)
      return guardOperatorResponse(response, operatorSession)
    } finally {
      clearTimeout(timer)
      // Keep forwarding cancellation while the response body is still streaming.
    }
  }
  let response = await send(session.access_token)
  if (response.status === 401) {
    fetchOpts.signal?.throwIfAborted()
    const { data } = await refreshSessionSingleFlight()
    assertOperatorSession(operatorSession)
    if (!data?.session?.access_token || data.session.user?.id !== operatorSession.accountId) {
      throw new Error('Tu sesión expiró. Inicia sesión nuevamente.')
    }
    response = await send(data.session.access_token)
  }
  return response
}
