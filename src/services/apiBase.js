// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son same-origin.
// En Vercel, vercel.json proxy /api/* al Worker de Cloudflare.
// En otros hosts, VITE_WORKER_ORIGIN permite apuntar manualmente.

import supabase from './supabase/client'
import useAuthStore from '../store/useAuthStore'

const WORKER_ORIGIN = import.meta.env.VITE_WORKER_ORIGIN || ''

export function apiUrl(path) {
  if (!WORKER_ORIGIN) return path
  return `${WORKER_ORIGIN}${path}`
}

/** Returns auth headers including X-Operator-Id to avoid JWT refresh delay issues */
export async function getAuthHeaders(extra = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const perfil = useAuthStore.getState().perfil
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
    ...(perfil?.id ? { 'X-Operator-Id': perfil.id } : {}),
    ...extra,
  }
}
