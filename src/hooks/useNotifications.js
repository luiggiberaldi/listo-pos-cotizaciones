import { useCallback, useRef } from 'react';

/**
 * Hook de notificaciones del navegador para PreciosAlDía.
 * 3 tipos: stock bajo, cierre de caja pendiente, venta completada.
 */
export function useNotifications() {
    const permissionRef = useRef(
        typeof window !== 'undefined' && 'Notification' in window
            ? Notification.permission
            : 'denied'
    );

    /** Solicitar permiso de notificaciones (call on user interaction) */
    const requestPermission = useCallback(async () => {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') {
            permissionRef.current = 'granted';
            return true;
        }
        const result = await Notification.requestPermission();
        permissionRef.current = result;
        return result === 'granted';
    }, []);

    /** Enviar notificación nativa */
    const send = useCallback((title, body, tag) => {
        if (permissionRef.current !== 'granted' && Notification.permission !== 'granted') return;
        try {
            new Notification(title, {
                body,
                icon: '/logodark.png',
                badge: '/logodark.png',
                tag, // Evita duplicados con el mismo tag
                vibrate: [100, 50, 100],
            });
        } catch (_) { /* SW-only env or unsupported */ }
    }, []);

    // ── Notificaciones específicas ──

    /** Stock bajo: se llama tras completar una venta, pasando los productos actualizados */
    const notifyLowStock = useCallback((products) => {
        const lowItems = products.filter(p => {
            const stock = p.stock ?? 0;
            const threshold = p.lowStockAlert ?? 5;
            return stock > 0 && stock <= threshold;
        });

        if (lowItems.length === 0) return;

        if (lowItems.length === 1) {
            const p = lowItems[0];
            send(
                '⚠️ Stock Bajo',
                `${p.name} tiene solo ${p.stock} ${p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : 'unidad(es)'}`,
                `low-stock-${p.id}`
            );
        } else {
            send(
                `⚠️ ${lowItems.length} Productos con Stock Bajo`,
                lowItems.slice(0, 3).map(p => `${p.name}: ${p.stock}`).join(', '),
                'low-stock-batch'
            );
        }
    }, [send]);

    /** Venta completada */
    const notifySaleComplete = useCallback((saleNumber, totalUsd, totalBs) => {
        send(
            '✅ Venta Completada',
            `Venta #${saleNumber} — $${totalUsd.toFixed(2)} (${Math.round(totalBs).toLocaleString()} Bs)`,
            `sale-${saleNumber}`
        );
    }, [send]);

    /** Cierre de caja pendiente: se chequea al montar el Dashboard */
    const notifyCierrePendiente = useCallback((todaySalesCount) => {
        if (todaySalesCount === 0) return;

        const now = new Date();
        const hour = now.getHours();

        // Solo notificar a partir de las 7pm
        if (hour < 19) return;

        // Evitar notificar más de una vez por día
        const lastNotified = localStorage.getItem('cierre_notified_date');
        const todayStr = now.toISOString().split('T')[0];
        if (lastNotified === todayStr) return;

        localStorage.setItem('cierre_notified_date', todayStr);
        send(
            '🔔 Cierre de Caja Pendiente',
            `Tienes ${todaySalesCount} venta(s) hoy. No olvides hacer el cierre de caja.`,
            'cierre-pendiente'
        );
    }, [send]);

    return {
        requestPermission,
        notifyLowStock,
        notifySaleComplete,
        notifyCierrePendiente,
    };
}
