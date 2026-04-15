// src/hooks/usePushNotifications.js
// Maneja suscripción/desuscripción a Web Push Notifications
import { useState, useEffect, useCallback } from 'react'
import supabase from '../services/supabase/client'

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
    const res = await fetch('/api/push/vapid-public-key')
    if (!res.ok) throw new Error('No se pudo obtener la clave VAPID')
    const { key } = await res.json()
    return key
  }

  // Convertir base64url a Uint8Array (necesario para applicationServerKey)
  function urlBase64ToUint8Array(base64String) {
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

      // Obtener clave VAPID
      const vapidKey = await getVapidKey()

      // Crear suscripción push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      // Obtener token de sesión para autenticar la petición
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No hay sesión activa')

      // Enviar suscripción al servidor
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (!res.ok) throw new Error('Error al guardar suscripción en el servidor')

      setSubscribed(true)
      return { ok: true }
    } catch (err) {
      console.error('[Push] Error al suscribirse:', err)
      return { ok: false, error: err.message }
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
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          await fetch('/api/push/unsubscribe', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (err) {
      console.error('[Push] Error al desuscribirse:', err)
    } finally {
      setLoading(false)
    }
  }, [supported])

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}

// ─── Función global para disparar push desde cualquier parte ─────────────────
// Llama al endpoint del worker para enviar push a todos los suscritos
export async function sendPushNotification({ title, message, url = '/', tag }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    await fetch('/api/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ title, message, url, tag }),
    })
  } catch (err) {
    console.warn('[Push] Error al enviar notificación:', err)
  }
}
