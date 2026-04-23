// src/sw.js — Service Worker (compiled by vite-plugin-pwa injectManifest)
// Combines Workbox precaching (offline app shell) + push notification handlers
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

// ─── Activar nuevo SW inmediatamente al instalar ────────────────────────────
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ─── Precache: app shell (HTML, JS, CSS, images) ────────────────────────────
// __WB_MANIFEST is replaced at build time with the list of all built assets
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ─── Navigation: SPA fallback (serve cached index.html when offline) ─────────
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ cacheName: 'navigations', networkTimeoutSeconds: 3 })
  )
)

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
