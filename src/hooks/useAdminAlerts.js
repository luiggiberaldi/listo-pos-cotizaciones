// src/hooks/useAdminAlerts.js
import { useState, useEffect, useCallback } from 'react'
import {
  getUnreadCount,
  getNotifications,
  markAllRead,
  markRead,
  clearNotifications,
} from '../services/notificationService'

export function useAdminAlerts() {
  const [unreadCount, setUnreadCount] = useState(() => getUnreadCount())
  const [notifications, setNotifications] = useState(() => getNotifications())

  const refresh = useCallback(() => {
    setUnreadCount(getUnreadCount())
    setNotifications(getNotifications())
  }, [])

  useEffect(() => {
    window.addEventListener('listo-notification', refresh)
    window.addEventListener('listo-notification-read', refresh)
    return () => {
      window.removeEventListener('listo-notification', refresh)
      window.removeEventListener('listo-notification-read', refresh)
    }
  }, [refresh])

  return {
    unreadCount,
    notifications,
    markAllRead: () => { markAllRead(); refresh() },
    markRead: (id) => { markRead(id); refresh() },
    clearAll: () => { clearNotifications(); refresh() },
  }
}
