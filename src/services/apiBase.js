// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son same-origin.
// En Vercel, vercel.json proxy /api/* al Worker de Cloudflare.
// En otros hosts, VITE_WORKER_ORIGIN permite apuntar manualmente.

import supabase from './supabase/client'
import useAuthStore from '../store/useAuthStore'

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
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('timeout_red')
      e.name = 'TimeoutError'
      throw e
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Returns auth headers including X-Operator-Id to avoid JWT refresh delay issues */
export async function getAuthHeaders(extra = {}) {
  let token = null
  try {
    const sessionRes = await Promise.race([
      supabase.auth.getSession(),
      new Promise(r => setTimeout(() => r({ data: { session: null } }), 1500))
    ])
    token = sessionRes?.data?.session?.access_token
  } catch { /* fallback */ }

  if (!token) {
    try {
      const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (storageKey) {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token
        }
      }
    } catch { /* fallback */ }
  }

  const perfil = useAuthStore.getState().perfil
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(perfil?.id ? { 'X-Operator-Id': perfil.id } : {}),
    ...extra,
  }
}

/** Divide identificadores para evitar URLs .in() excesivamente grandes. */
export function chunkIds(ids, size = 50) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const chunks = []
  for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size))
  return chunks
}
