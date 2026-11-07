// src/utils/errorLogger.js
// Logger de errores que envía al backend para persistencia
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import { getOperatorSessionHeaders } from '../services/operatorSession'

let _logQueue = []
let _flushTimer = null

async function getToken() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch { return null }
}

async function flush() {
  if (!_logQueue.length) return
  const batch = _logQueue.splice(0, 10)
  const token = await getToken()
  if (!token) return // no logueado, descartar

  const base = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const operador = getOperatorSessionHeaders()
  for (const entry of batch) {
    try {
      const body = JSON.stringify(entry)
      // Con la sesión del PIN el log queda a nombre del operador (no de la cuenta compartida).
      const res = await fetch(apiUrl('/api/logs'), { method: 'POST', headers: { ...base, ...operador }, body })
      // Si la sesión del PIN venció, se reenvía sin ella para no perder el log.
      if (res.status === 401 && operador['X-Operator-Session']) {
        await fetch(apiUrl('/api/logs'), { method: 'POST', headers: base, body })
      }
    } catch { /* silencioso */ }
  }
}

function scheduleFlush() {
  if (_flushTimer) return
  _flushTimer = setTimeout(() => {
    _flushTimer = null
    flush()
  }, 2000) // batch cada 2 segundos
}

/**
 * Registra un error del frontend en el sistema de logs
 * @param {{ mensaje: string, stack?: string, categoria?: string, meta?: object, nivel?: string }} entry
 */
export function logClientError({ mensaje, stack, categoria, meta, nivel = 'error' }) {
  _logQueue.push({
    nivel,
    origen: 'frontend',
    categoria: categoria || 'FRONTEND',
    mensaje: String(mensaje).slice(0, 2000),
    stack: stack ? String(stack).slice(0, 5000) : undefined,
    meta: meta || {},
  })
  scheduleFlush()
}

/**
 * Log de warning (no crítico)
 */
export function logClientWarn(mensaje, meta) {
  logClientError({ mensaje, nivel: 'warn', meta })
}

/**
 * Log informativo (para tracking de uso)
 */
export function logClientInfo(mensaje, categoria, meta) {
  logClientError({ mensaje, nivel: 'info', categoria, meta })
}
