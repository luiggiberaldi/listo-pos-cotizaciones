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

/**
 * Trae TODAS las filas de una consulta (OP-2026-025). La base entrega como máximo
 * 1000 filas por pedido; si una tanda llega llena se pide la siguiente.
 * `crear` arma la consulta desde cero en cada tanda y debe incluir un orden estable
 * (por ejemplo .order('id')) para que las tandas no se pisen ni dejen huecos.
 */
export async function traerTodo(crear, tanda = 1000) {
  const filas = []
  for (let desde = 0; ; desde += tanda) {
    const { data, error } = await crear().range(desde, desde + tanda - 1)
    if (error) throw error
    filas.push(...(data || []))
    if (!data || data.length < tanda) return filas
  }
}

/**
 * Ejecuta `fn` sobre cada elemento con como máximo `limite` llamadas a la vez y
 * devuelve los resultados en el mismo orden (OP-2026-025). Evita lanzar cientos
 * de consultas simultáneas cuando una búsqueda trae muchos resultados.
 */
export async function mapConLimite(items, limite, fn) {
  const lista = items || []
  const resultados = new Array(lista.length)
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < lista.length) {
      const i = siguiente++
      resultados[i] = await fn(lista[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limite), lista.length) }, trabajador))
  return resultados
}

/** Máximo de ids que acepta /api/clientes/lookup por pedido (api/handlers/clientes.js). */
export const LOOKUP_CLIENTES_MAX = 200

/**
 * Busca clientes por id vía /api/clientes/lookup en tandas de 200 (el servidor
 * rechaza más de 200). Si una tanda falla, esa tanda queda vacía y el resto se
 * muestra igual (la lista enseña "cliente: —" en vez de fallar completa).
 */
export async function lookupClientesPorIds(ids, headers) {
  const tandas = chunkIds(ids, LOOKUP_CLIENTES_MAX)
  if (!tandas.length) return []
  const res = await mapConLimite(tandas, 4, tanda =>
    fetch(apiUrl('/api/clientes/lookup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ids: tanda }),
    }).then(r => (r.ok ? r.json() : [])).catch(() => [])
  )
  return res.flat()
}
