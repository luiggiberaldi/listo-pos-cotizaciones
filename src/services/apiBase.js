// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son locales.
// En Vercel (u otro host) se redirige al worker de Cloudflare.

const WORKER_ORIGIN = 'https://listo-pos-cotizaciones-6q2oib.camelai.app'

function isWorkerHost() {
  const host = window.location.hostname
  return host.includes('camelai.app') || host.includes('camelai.dev') || host === 'localhost'
}

export function apiUrl(path) {
  if (isWorkerHost()) return path
  return `${WORKER_ORIGIN}${path}`
}
