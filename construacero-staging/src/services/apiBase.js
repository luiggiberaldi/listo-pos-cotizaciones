// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son same-origin.
// En Vercel, vercel.json proxy /api/* al Worker de Cloudflare.
// En otros hosts, VITE_WORKER_ORIGIN permite apuntar manualmente.

import supabase from './supabase/client'
import { requireOperatorSession, assertOperatorSession } from './operatorSession'

const WORKER_ORIGIN = import.meta.env.PROD ? '' : (import.meta.env.VITE_WORKER_ORIGIN || '')

export function apiUrl(path) {
  if (!WORKER_ORIGIN) return path
  return `${WORKER_ORIGIN}${path}`
}

/**
 * fetch con timeout duro vía AbortController.
 * Sin esto, una conexión estancada (red móvil inestable) deja la promesa
 * colgada minutos y la UI se congela en estado de carga.
 * Lanza Error con name 'TimeoutError' al expirar.
 */
export async function fetchConTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const upstreamSignal = options.signal === undefined && url instanceof Request ? url.signal : options.signal
  const onAbort = () => controller.abort(upstreamSignal.reason)
  if (upstreamSignal?.aborted) onAbort()
  else upstreamSignal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError' && !upstreamSignal?.aborted) {
      const e = new Error('timeout_red')
      e.name = 'TimeoutError'
      throw e
    }
    throw err
  } finally {
    clearTimeout(timer)
    // The caller signal must also be able to cancel a body read after headers.
  }
}

/** Capture operator identity before waiting for business authentication. */
export async function getAuthHeaders(extra = {}) {
  const operatorSession = requireOperatorSession()
  let timer
  let sessionRes
  try {
    sessionRes = await Promise.race([
      supabase.auth.getSession(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No autenticado')), 1500) }),
    ])
  } finally {
    clearTimeout(timer)
  }
  assertOperatorSession(operatorSession)
  const session = sessionRes?.data?.session
  if (!session?.access_token || session.user?.id !== operatorSession.accountId) throw new Error('No autenticado')
  const headers = new Headers(extra)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${session.access_token}`)
  headers.set('X-Operator-Id', operatorSession.operatorId)
  headers.set('X-Operator-Session', operatorSession.token)
  return Object.fromEntries(headers)
}

/** Divide identificadores para evitar URLs .in() excesivamente grandes. */
export function chunkIds(ids, size = 50) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const chunks = []
  for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size))
  return chunks
}
