import { useState, useEffect, useCallback } from 'react';
import {
    getUnreadCount,
    getNotifications,
    markAllRead,
    markRead,
    clearNotifications,
} from '../services/notificationService';

/**
 * Hook para leer y gestionar las notificaciones admin en tiempo real.
 * Se actualiza automáticamente cuando se disparan custom events.
 */
export function useAdminAlerts() {
    const [unreadCount, setUnreadCount] = useState(() => getUnreadCount());
    const [notifications, setNotifications] = useState(() => getNotifications());

    const refresh = useCallback(() => {
        setUnreadCount(getUnreadCount());
        setNotifications(getNotifications());
    }, []);

    useEffect(() => {
        window.addEventListener('admin-notification', refresh);
        window.addEventListener('admin-notification-read', refresh);
        return () => {
            window.removeEventListener('admin-notification', refresh);
            window.removeEventListener('admin-notification-read', refresh);
        };
    }, [refresh]);

    return {
        unreadCount,
        notifications,
        markAllRead: () => { markAllRead(); refresh(); },
        markRead: (id) => { markRead(id); refresh(); },
        clearAll: () => { clearNotifications(); refresh(); },
    };
}
