import { useState, useEffect, useCallback } from 'react';
import { storageService } from '../utils/storageService';

const APP_VERSION = '1.0.0';
const PRODUCT_ID = 'bodega';

const DEMO_DURATION_MS = 168 * 60 * 60 * 1000; // 168 horas (7 días)

// Basic obfuscation (XOR + btoa) for tokens in localStorage.
// WARNING: This is NOT encryption. It only deters casual inspection by employees.
// The server-side token validation is the real security boundary.
const OBFUSCATION_KEY = 'LPL_SEC_2026';

const encodeToken = (str) => {
    try {
        const xored = str.split('').map((c, i) =>
            String.fromCharCode(
                c.charCodeAt(0) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length)
            )
        ).join('');
        return btoa(unescape(encodeURIComponent(xored)));
    } catch { return str; }
};

const decodeToken = (encoded) => {
    try {
        const xored = decodeURIComponent(escape(atob(encoded)));
        return xored.split('').map((c, i) =>
            String.fromCharCode(
                c.charCodeAt(0) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length)
            )
        ).join('');
    } catch { return encoded; }
};



export function useSecurity() {
    const [deviceId, setDeviceId] = useState('');
    const [isPremium, setIsPremium] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isDemo, setIsDemo] = useState(false);
    const [demoExpires, setDemoExpires] = useState(null);
    const [demoExpiredMsg, setDemoExpiredMsg] = useState('');
    const [demoTimeLeft, setDemoTimeLeft] = useState('');
    const [demoUsed, setDemoUsed] = useState(false);

    // Calcular tiempo restante formateado
    const updateTimeLeft = useCallback((expiresAt) => {
        if (!expiresAt) { setDemoTimeLeft(''); return; }
        const diff = expiresAt - Date.now();
        if (diff <= 0) { setDemoTimeLeft(''); return; }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (days > 0) setDemoTimeLeft(`${days}d ${hours}h`);
        else if (hours > 0) setDemoTimeLeft(`${hours}h ${mins}m`);
        else setDemoTimeLeft(`${mins}m`);
    }, []);

    useEffect(() => {
        // 1. Obtener o Generar Device ID a través de fingerprinting
        const generateFingerprint = async () => {
            const nav = window.navigator;
            const screen = window.screen;

            const components = [
                nav.userAgent,
                nav.language,
                nav.hardwareConcurrency || 1,
                nav.deviceMemory || 1,
                screen.width,
                screen.height,
                screen.colorDepth,
                new Date().getTimezoneOffset()
            ].join('|');

            if (!window.crypto || !window.crypto.subtle) {
                // Fallback (solo en http sin SSL)
                let hash = 0;
                for (let i = 0; i < components.length; i++) {
                    hash = ((hash << 5) - hash) + components.charCodeAt(i);
                    hash |= 0;
                }
                const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
                return `LPL-${hex}`;
            }

            // Mismo hardware = mismo hash SHA-256
            const encoder = new TextEncoder();
            const data = encoder.encode(components);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().substring(0, 8);
            return `LPL-${hex}`;
        };

        const initDeviceId = async () => {
            let storedId = localStorage.getItem('pda_device_id');
            if (!storedId) {
                storedId = await generateFingerprint();
                localStorage.setItem('pda_device_id', storedId);
            }
            setDeviceId(storedId);

            checkLicense(storedId);
        };

        initDeviceId();

        // Leer demo flag desde IndexedDB
        storageService.getItem('pda_demo_flag_v1', null).then(r => {
            if (r?.used) setDemoUsed(true);
        });
    }, []);

    // Countdown timer para demo
    useEffect(() => {
        if (!isDemo || !demoExpires) return;
        updateTimeLeft(demoExpires);
        const interval = setInterval(() => {
            const diff = demoExpires - Date.now();
            if (diff <= 0) {
                // Demo expiró en tiempo real
                clearInterval(interval);
                localStorage.removeItem('pda_premium_token');
                setIsPremium(false);
                setIsDemo(false);
                setDemoTimeLeft('');
                setDemoExpiredMsg("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
            } else {
                updateTimeLeft(demoExpires);
            }
        }, 60000); // Cada minuto
        return () => clearInterval(interval);
    }, [isDemo, demoExpires, updateTimeLeft]);

    // Integrity check periódico cada 30 minutos (solo local, sin queries a Supabase)
    useEffect(() => {
        if (!deviceId) return;
        const interval = setInterval(async () => {
            const raw = localStorage.getItem('pda_premium_token');

            // Si localStorage fue borrado y estaba premium → revocar
            if (!raw) {
                if (isPremium) {
                    setIsPremium(false);
                    setIsDemo(false);
                    window.location.reload();
                }
                return;
            }

            // Verificar integridad del token almacenado
            try {
                const token = decodeToken(raw);
                const obj = JSON.parse(token);
                // Si es demo y ya expiró
                if (obj?.type === 'demo7' && obj?.expires && Date.now() >= obj.expires) {
                    localStorage.removeItem('pda_premium_token');
                    setIsPremium(false);
                    setIsDemo(false);
                    window.location.reload();
                }
            } catch {
                // Token corrupto → revocar
                if (isPremium) {
                    localStorage.removeItem('pda_premium_token');
                    setIsPremium(false);
                    setIsDemo(false);
                    window.location.reload();
                }
            }
        }, 30 * 60 * 1000); // 30 minutos

        return () => clearInterval(interval);
    }, [deviceId, isPremium]);

    const checkLicense = async (currentDeviceId) => {
        const rawStored = localStorage.getItem('pda_premium_token');
        const storedToken = rawStored ? decodeToken(rawStored) : null;

        if (!storedToken) {
            // Sin token local — la licencia cloud se gestiona en useCloudAuthLogic
            setIsPremium(false);
            setLoading(false);
            return;
        }

        try {
            const tokenObj = JSON.parse(storedToken);
            if (tokenObj && tokenObj.deviceId === currentDeviceId) {
                const isTimeLimited = tokenObj.type === 'demo7' || tokenObj.isDemo;

                if (isTimeLimited) {
                    if (Date.now() < tokenObj.expires) {
                        setIsPremium(true);
                        setIsDemo(true);
                        setDemoExpires(tokenObj.expires);
                    } else {
                        localStorage.removeItem('pda_premium_token');
                        setIsPremium(false);
                        setIsDemo(false);
                        setDemoExpiredMsg("Tu licencia temporal ha finalizado. Esperamos que hayas disfrutado la experiencia completa.");
                    }
                } else {
                    // Permanente
                    setIsPremium(true);
                    setIsDemo(false);
                }

                // Guardar backup en sessionStorage si licencia válida
                if (tokenObj.type !== 'demo7' || Date.now() < tokenObj.expires) {
                    try {
                        sessionStorage.setItem(
                            '_pda_s',
                            encodeToken('VALID_SESSION:' + currentDeviceId)
                        );
                    } catch { }
                }
            } else {
                setIsPremium(false);
            }
        } catch (e) {
            setIsPremium(false);
        }

        setLoading(false);
    };

    /**
     * Activa la demo de 7 días sin necesidad de código.
     * Solo puede usarse UNA VEZ por dispositivo.
     */
    const activateDemo = async () => {
        // Verificar demo en IndexedDB (local)
        const demoRecord = await storageService.getItem('pda_demo_flag_v1', null);
        if (demoRecord?.used) {
            return { success: false, status: 'DEMO_USED' };
        }

        const currentDeviceId = deviceId || localStorage.getItem('pda_device_id');

        const expires = Date.now() + DEMO_DURATION_MS;
        const demoToken = {
            deviceId: currentDeviceId,
            type: 'demo7',
            expires: expires,
        };

        // Guardar token ofuscado
        localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify(demoToken)));

        // Guardar flag en IndexedDB
        await storageService.setItem('pda_demo_flag_v1', {
            used: true,
            ts: Date.now(),
            deviceId: currentDeviceId,
        });

        setIsPremium(true);
        setIsDemo(true);
        setDemoExpires(expires);
        setDemoUsed(true);

        return { success: true, status: 'DEMO_ACTIVATED' };
    };

    /**
     * Desbloquea con código de activación.
     * Valida el token localmente — la gestión cloud está en useCloudAuthLogic.
     */
    const unlockApp = async (inputCode) => {
        try {
            const cleanCode = (inputCode || "").trim().toUpperCase().replace(/O/g, '0');

            // Verificar si ya existe un token local válido con este código
            const rawStored = localStorage.getItem('pda_premium_token');
            if (rawStored) {
                try {
                    const existing = JSON.parse(decodeToken(rawStored));
                    if (existing?.code === cleanCode && existing?.deviceId === deviceId) {
                        setIsPremium(true);
                        setIsDemo(existing.type === 'demo7');
                        return { success: true, status: 'PREMIUM_ACTIVATED' };
                    }
                } catch { }
            }

            // Sin validación server-side disponible — el código se valida via cloud auth
            return { success: false, status: 'INVALID_CODE' };

        } catch (err) {
            console.error('Error validating license:', err);
            return { success: false, status: 'SERVER_ERROR' };
        }
    };

    const generateCodeForClient = async () => null;

    // No-op: heartbeat ya no se usa (RPCs legacy eliminadas).
    // Se mantiene para no romper componentes que lo llaman.
    const forceHeartbeat = async () => {};

    return {
        deviceId,
        isPremium,
        loading,
        unlockApp,
        activateDemo,
        generateCodeForClient,
        isDemo,
        demoExpires,
        demoTimeLeft,
        demoExpiredMsg,
        dismissExpiredMsg: () => setDemoExpiredMsg(''),
        demoUsed,
        forceHeartbeat,
    };
}
