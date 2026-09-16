// src/services/supabase/client.js
// Singleton del cliente Supabase — importar desde aquí en toda la app
import { createClient } from '@supabase/supabase-js'
import { requireOperatorSession, assertOperatorSession, guardOperatorResponse } from '../operatorSession'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. ' +
    'Copia .env.example a .env y configura las credenciales.'
  )
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: async (url, options = {}) => {
      const request = url instanceof Request ? url : null
      const requestUrl = new URL(request ? request.url : String(url))
      const isRest = requestUrl.origin === new URL(supabaseUrl).origin && requestUrl.pathname.startsWith('/rest/v1/')
      const operatorSession = isRest ? requireOperatorSession() : null
      const headers = new Headers(options.headers === undefined ? request?.headers : options.headers)
      if (operatorSession) {
        headers.set('X-Operator-Id', operatorSession.operatorId)
        headers.set('X-Operator-Session', operatorSession.token)
      }
      const timeoutController = new AbortController()
      const upstreamSignal = options.signal === undefined ? request?.signal : options.signal
      const onAbort = () => timeoutController.abort(upstreamSignal.reason)
      if (upstreamSignal?.aborted) onAbort()
      else upstreamSignal?.addEventListener('abort', onAbort, { once: true })
      const timeout = setTimeout(() => timeoutController.abort(
        new DOMException('Tiempo de espera agotado (25s)', 'TimeoutError'),
      ), 25000)
      try {
        const response = await fetch(url, { ...options, headers, signal: timeoutController.signal })
        if (!operatorSession) return response
        assertOperatorSession(operatorSession)
        return guardOperatorResponse(response, operatorSession)
      } finally {
        clearTimeout(timeout)
        // Request cancellation remains linked during deferred body consumption.
      }
    },
  },
})

export default supabase
