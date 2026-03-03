import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para detectar estado online/offline y cachear tasas.
 * La app ya guarda ventas localmente con storageService (IndexedDB).
 * Este hook agrega:
 * - Detección online/offline reactiva
 * - Cache de última tasa conocida para usar offline
 * - Indicador visual controlado
 */
export function useOfflineQueue() {
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    /** Guardar tasa en cache para uso offline */
    const cacheRates = useCallback((rates) => {
        if (rates && rates.bcv?.price > 0) {
            localStorage.setItem('offline_cached_rates', JSON.stringify({
                ...rates,
                cachedAt: new Date().toISOString(),
            }));
        }
    }, []);

    /** Obtener tasa cacheada */
    const getCachedRates = useCallback(() => {
        try {
            const saved = localStorage.getItem('offline_cached_rates');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    }, []);

    return { isOnline, cacheRates, getCachedRates };
}
