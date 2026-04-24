// src/services/authFetch.js
// Fetch autenticado con retry automático en 401 (token expirado).
// Si la primera llamada falla con 401, refresca la sesión y reintenta una vez.
import supabase from './supabase/client'
import { apiUrl } from './apiBase'

/**
 * Hace una petición autenticada al Worker API.
 * Si recibe 401, refresca el token de Supabase y reintenta.
 *
 * @param {string} path - Ruta de la API (e.g. '/api/clientes')
 * @param {RequestInit} [options={}] - Opciones adicionales de fetch (method, body, etc.)
 * @returns {Promise<Response>}
 */
export async function authFetch(path, options = {}) {
  // Obtener token actual
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No autenticado')

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${session.access_token}`,
  }

  const res = await fetch(apiUrl(path), { ...options, headers })

  // Si 401, intentar refrescar sesión y reintentar una vez
  if (res.status === 401) {
    const { data: refreshData } = await supabase.auth.refreshSession()
    const newToken = refreshData?.session?.access_token
    if (!newToken) throw new Error('No autenticado')

    const retryHeaders = {
      ...options.headers,
      Authorization: `Bearer ${newToken}`,
    }
    const retryRes = await fetch(apiUrl(path), { ...options, headers: retryHeaders })
    if (!retryRes.ok) {
      const err = await retryRes.json().catch(() => ({}))
      throw new Error(err.error || `Error ${retryRes.status}`)
    }
    return retryRes
  }

  return res
}
