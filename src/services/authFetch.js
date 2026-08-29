// src/services/authFetch.js
// Fetch autenticado con retry automático en 401 (token expirado).
// Si la primera llamada falla con 401, refresca la sesión y reintenta una vez.
import supabase from './supabase/client'
import { apiUrl } from './apiBase'
import { refreshSessionSingleFlight } from './sessionManager'
import useAuthStore from '../store/useAuthStore'

const DEFAULT_TIMEOUT = 15000 // 15 segundos

function operatorHeader() {
  const perfil = useAuthStore.getState().perfil
  return perfil?.id ? { 'X-Operator-Id': perfil.id } : {}
}

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
    ...operatorHeader(),
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

  // Si 401, refrescar vía el coordinador global (tope 8s) y reintentar UNA vez.
  // Si el refresh es rechazado (SESSION_EXPIRED), no hay reintento en cascada.
  if (res.status === 401) {
    let newToken = null
    try {
      const { data: refreshData } = await Promise.race([
        refreshSessionSingleFlight(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SESSION_REFRESH_TIMEOUT')), 8000)),
      ])
      newToken = refreshData?.session?.access_token ?? null
    } catch { newToken = null }
    if (!newToken) {
      const e = new Error('Tu sesión expiró. Inicia sesión nuevamente.')
      e.code = 'SESSION_EXPIRED'
      throw e
    }

    const retryController = new AbortController()
    const retryTimeoutId = setTimeout(() => retryController.abort(), timeout)

    const retryHeaders = {
      ...fetchOpts.headers,
      Authorization: `Bearer ${newToken}`,
      ...operatorHeader(),
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
