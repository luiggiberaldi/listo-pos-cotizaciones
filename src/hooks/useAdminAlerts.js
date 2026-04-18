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
    clearAll: () => { clearNotifications(); refresh() },
  }
}
