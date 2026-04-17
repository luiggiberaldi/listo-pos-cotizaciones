// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son locales (same-origin).
// En otros hosts se redirige al worker de Cloudflare via env var.

const WORKER_ORIGIN = import.meta.env.VITE_WORKER_ORIGIN || ''

function isSameOriginWorker() {
  const host = window.location.hostname
  return host.includes('camelai.app') || host.includes('camelai.dev') || host === 'localhost'
}

export function apiUrl(path) {
  if (isSameOriginWorker() || !WORKER_ORIGIN) return path
  return `${WORKER_ORIGIN}${path}`
}
