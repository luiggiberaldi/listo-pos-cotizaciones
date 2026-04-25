// src/services/authFetch.js
// Fetch autenticado con retry automático en 401 (token expirado).
// Si la primera llamada falla con 401, refresca la sesión y reintenta una vez.
import supabase from './supabase/client'
import { apiUrl } from './apiBase'

const DEFAULT_TIMEOUT = 15000 // 15 segundos

/**
 * Hace una petición autenticada al Worker API.
 * Si recibe 401, refresca el token de Supabase y reintenta.
 *
 * @param {string} path - Ruta de la API (e.g. '/api/clientes')
 * @param {RequestInit & { timeout?: number }} [options={}] - Opciones adicionales de fetch
 * @returns {Promise<Response>}
 */
export async function authFetch(path, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOpts } = options

  // Obtener token actual
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No autenticado')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const headers = {
    ...fetchOpts.headers,
    Authorization: `Bearer ${session.access_token}`,
  }

  let res
  try {
    res = await fetch(apiUrl(path), { ...fetchOpts, headers, signal: controller.signal })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado')
    throw err
  }
  clearTimeout(timeoutId)

  // Si 401, intentar refrescar sesión y reintentar una vez
  if (res.status === 401) {
    const { data: refreshData } = await supabase.auth.refreshSession()
    const newToken = refreshData?.session?.access_token
    if (!newToken) throw new Error('No autenticado')

    const retryController = new AbortController()
    const retryTimeoutId = setTimeout(() => retryController.abort(), timeout)

    const retryHeaders = {
      ...fetchOpts.headers,
      Authorization: `Bearer ${newToken}`,
    }

    let retryRes
    try {
      retryRes = await fetch(apiUrl(path), { ...fetchOpts, headers: retryHeaders, signal: retryController.signal })
    } catch (err) {
      clearTimeout(retryTimeoutId)
      if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado')
      throw err
    }
    clearTimeout(retryTimeoutId)

    if (!retryRes.ok) {
      const err = await retryRes.json().catch(() => ({}))
      throw new Error(err.error || `Error ${retryRes.status}`)
    }
    return retryRes
  }

  return res
}
