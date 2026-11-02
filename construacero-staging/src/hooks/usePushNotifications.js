// src/hooks/usePushNotifications.js
// Maneja suscripción/desuscripción a Web Push Notifications
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../services/authFetch'
import { apiUrl } from '../services/apiBase'

const SW_PATH = '/sw.js'

export function usePushNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

  // Obtener la clave pública VAPID del servidor
  async function getVapidKey() {
    const res = await fetch(apiUrl('/api/push/vapid-public-key'))
    if (!res.ok) throw new Error('No se pudo obtener la clave VAPID')
    const { key } = await res.json()
    return key
  }

  // Convertir base64url a Uint8Array (necesario para applicationServerKey)
  function urlBase64ToUint8Array(base64String) {
    if (!base64String) return new Uint8Array()
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
  }

  // Verificar si ya hay suscripción activa al montar
  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setSubscribed(!!sub)
      })
    }).catch(() => {})
  }, [supported])

  // Suscribirse a push notifications
  const subscribe = useCallback(async () => {
    if (!supported) return { ok: false, error: 'Push no soportado en este navegador' }
    setLoading(true)

    try {
      // Solicitar permiso
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') {
        return { ok: false, error: 'Permiso denegado' }
      }

      // Registrar service worker
      const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
      await navigator.serviceWorker.ready

      // Obtener clave VAPID con fallback robusto
      let vapidKey = null
      try {
        vapidKey = await getVapidKey()
      } catch (e) {
        console.warn('No se pudo cargar VAPID del backend, usando fallback:', e)
      }

      const keyToUse = vapidKey || 'BBtDi5JNFg-JiIwE3ImrimyyiwcRY0-H8K7Q8PnvnOOHTAGBU5gpnU6SXjHN6MVg6tai7cmiGhpjHOsgFMWs5mc'

      // Crear suscripción push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyToUse),
      })

      // Enviar suscripción al servidor con la sesión del operador (PIN)
      const res = await authFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (!res.ok) throw new Error('Error al guardar suscripción en el servidor')

      setSubscribed(true)
      return { ok: true }
    } catch (err) {
      const isPushServiceError = 
        err.message?.includes('push service error') || 
        err.message?.includes('Registration failed') || 
        err.name === 'AbortError'
      return { 
        ok: false, 
        error: isPushServiceError ? 'push-service-error' : err.message,
        rawError: err.message 
      }
    } finally {
      setLoading(false)
    }
  }, [supported])

  // Desuscribirse
  const unsubscribe = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await authFetch('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch {
      // Error al desuscribirse — se ignora
    } finally {
      setLoading(false)
    }
  }, [supported])

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}

// ─── Función global para disparar push desde cualquier parte ─────────────────
// targetRole: 'supervisor' | 'vendedor' — enviar solo a usuarios con ese rol
// targetUserId: UUID — enviar solo a un usuario específico
export async function sendPushNotification({ title, message, url = '/', tag, targetRole, targetUserId }) {
  try {
    await authFetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message, url, tag, targetRole, targetUserId }),
    })
  } catch {
    // Error al enviar notificación — se ignora
  }
}
