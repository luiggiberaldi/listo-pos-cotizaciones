// src/sw.js — Service Worker
// Precachea el app shell (HTML/JS/CSS) para carga rápida.
// El caché de datos de Supabase fue eliminado para evitar datos stale tras mutaciones.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { get, set, del, keys } from 'idb-keyval'

// ─── Precache: app shell (HTML, JS, CSS, images) ────────────────────────────
// __WB_MANIFEST es reemplazado en build por la lista de assets compilados
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ─── Activar nuevo SW inmediatamente al instalar ────────────────────────────
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  // Limpiar caches viejos (de versiones anteriores del SW) al activar
  event.waitUntil(self.clients.claim())
})

// ═══════════════════════════════════════════════════════════════════════════════
// Background Sync — procesa cola de mutaciones offline al recuperar conexión
// ═══════════════════════════════════════════════════════════════════════════════

const QUEUE_PREFIX = 'mq_'
const MAX_ATTEMPTS = 3

// Procesa todos los items pendientes en la cola IDB
async function processMutationQueueInSW() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = (await Promise.all(allKeys.map((k) => get(k))))
    .filter((i) => i?.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)

  let done = 0
  let failed = 0

  for (const item of items) {
    try {
      // Leer JWT del IndexedDB de Supabase (clave estándar de supabase-js)
      const sbKey = Object.keys(self).find((k) => k.startsWith('sb-')) ||
        `sb-${self.location.hostname.split('.')[0]}-auth-token`
      const authRaw = await get(sbKey)
      const accessToken = authRaw?.access_token || authRaw?.session?.access_token

      if (!accessToken) {
        // Sin token — posponer, el usuario necesita iniciar sesión
        failed++
        continue
      }

      if (item.type === 'VENTA_RAPIDA') {
        const res = await fetch('/api/ventas-rapidas/crear', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(item.payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }

        await del(item.id)
        done++
      }

      if (item.type === 'GUARDAR_COTIZACION') {
        const payload = { ...item.payload }
        if (payload.cotizacionId?.startsWith?.('local_')) payload.cotizacionId = null

        const res = await fetch('/api/cotizaciones/guardar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }

        await del(item.id)
        done++
      }
    } catch (err) {
      const attempts = (item.attempts || 0) + 1
      await set(item.id, {
        ...item,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: err.message,
        attempts,
        lastAttemptAt: Date.now(),
      })
      failed++
    }
  }

  // Notificar a los clientes abiertos para que refresquen su UI
  if (done > 0) {
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach((client) =>
      client.postMessage({ type: 'MUTATION_QUEUE_SYNCED', done, failed })
    )
  }

  return { done, failed }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-mutations') {
    event.waitUntil(processMutationQueueInSW())
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Push Notification handlers (preserved from original public/sw.js)
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Construacero', body: event.data.text() }
  }

  const options = {
    body: payload.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag || 'listo-notif',
    data: payload.url || '/',
    requireInteraction: payload.requireInteraction || false,
    vibrate: [100, 50, 100],
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Construacero', options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
