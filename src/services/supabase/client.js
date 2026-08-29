// src/services/supabase/client.js
// Singleton del cliente Supabase — importar desde aquí en toda la app
import { createClient } from '@supabase/supabase-js'

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
    fetch: (url, options = {}) => {
      // No reemplazar la señal de Supabase: GoTrue usa su propio AbortSignal
      // y su navigator lock. Sobrescribirla podía abortar login/refresh durante
      // StrictMode o al desmontar una vista.
      const timeoutController = new AbortController()
      const timeout = setTimeout(() => {
        try {
          timeoutController.abort(new DOMException('Tiempo de espera agotado (8s)', 'TimeoutError'))
        } catch {
          timeoutController.abort()
        }
      }, 8000)

      const upstreamSignal = options.signal
      let signal = timeoutController.signal

      if (upstreamSignal) {
        if (typeof AbortSignal.any === 'function') {
          signal = AbortSignal.any([upstreamSignal, timeoutController.signal])
        } else if (upstreamSignal.aborted) {
          timeoutController.abort(upstreamSignal.reason)
        } else {
          upstreamSignal.addEventListener('abort', () => timeoutController.abort(upstreamSignal.reason), { once: true })
        }
      }

      return fetch(url, { ...options, signal })
        .finally(() => clearTimeout(timeout))
    },
  },
})

export default supabase
