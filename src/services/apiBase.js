// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son same-origin.
// En Vercel, vercel.json proxy /api/* al Worker de Cloudflare.
// En otros hosts, VITE_WORKER_ORIGIN permite apuntar manualmente.

const WORKER_ORIGIN = import.meta.env.VITE_WORKER_ORIGIN || ''

export function apiUrl(path) {
  if (!WORKER_ORIGIN) return path
  return `${WORKER_ORIGIN}${path}`
}
