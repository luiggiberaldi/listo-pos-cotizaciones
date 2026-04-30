// src/hooks/useAdminAlerts.js
import { useState, useEffect, useCallback } from 'react'
import {
  getUnreadCount,
  getNotifications,
  markAllRead,
  markRead,
  clearNotifications,
} from '../services/notificationService'
import { updateNotificationBadge, initFaviconBadge, clearNotificationBadge } from '../services/faviconBadge'

let _faviconInitialized = false

export function useAdminAlerts() {
  const [unreadCount, setUnreadCount] = useState(() => getUnreadCount())
  const [notifications, setNotifications] = useState(() => getNotifications())

  const refresh = useCallback(() => {
    const count = getUnreadCount()
    setUnreadCount(count)
    setNotifications(getNotifications())
    updateNotificationBadge(count)
  }, [])

  useEffect(() => {
    // Inicializar favicon badge una sola vez
    if (!_faviconInitialized) {
      initFaviconBadge()
      _faviconInitialized = true
    }
    // Sincronizar badge al montar
    updateNotificationBadge(getUnreadCount())

    window.addEventListener('construacero-notification', refresh)
    window.addEventListener('construacero-notification-read', refresh)
    return () => {
      window.removeEventListener('construacero-notification', refresh)
      window.removeEventListener('construacero-notification-read', refresh)
    }
  }, [refresh])

  return {
    unreadCount,
    notifications,
    markAllRead: () => { markAllRead(); refresh() },
    markRead: (id) => { markRead(id); refresh() },
    clearAll: () => { clearNotifications(); clearNotificationBadge(); refresh() },
  }
}
