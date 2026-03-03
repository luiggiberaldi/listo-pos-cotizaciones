import { useCallback, useRef } from 'react';

/**
 * Hook de sonidos sintéticos con Web Audio API.
 * Cero archivos de audio — todo generado programáticamente.
 */
export function useSounds() {
    const ctxRef = useRef(null);

    const getCtx = useCallback(() => {
        if (!ctxRef.current) {
            ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Resume si está suspendido (política de autoplay del navegador)
        if (ctxRef.current.state === 'suspended') {
            ctxRef.current.resume();
        }
        return ctxRef.current;
    }, []);

    // ── Helpers ──
    const beep = useCallback((freq, duration = 0.08, type = 'sine', vol = 0.15) => {
        try {
            const ctx = getCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(vol, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration);
        } catch (_) { /* silent fail if audio not available */ }
    }, [getCtx]);

    // ── Sonidos públicos ──

    /** Agregar producto al carrito — tono ascendente rápido */
    const playAdd = useCallback(() => {
        beep(800, 0.06, 'sine', 0.12);
        setTimeout(() => beep(1200, 0.08, 'sine', 0.1), 50);
    }, [beep]);

    /** Quitar producto del carrito — tono descendente */
    const playRemove = useCallback(() => {
        beep(600, 0.06, 'sine', 0.1);
        setTimeout(() => beep(400, 0.08, 'sine', 0.08), 50);
    }, [beep]);

    /** Checkout exitoso — ka-ching! */
    const playCheckout = useCallback(() => {
        beep(523, 0.08, 'sine', 0.12);
        setTimeout(() => beep(659, 0.08, 'sine', 0.12), 80);
        setTimeout(() => beep(784, 0.1, 'sine', 0.14), 160);
        setTimeout(() => beep(1047, 0.15, 'sine', 0.16), 260);
    }, [beep]);

    /** Error — buzzer corto */
    const playError = useCallback(() => {
        beep(200, 0.15, 'square', 0.08);
        setTimeout(() => beep(180, 0.15, 'square', 0.06), 120);
    }, [beep]);

    /** Éxito genérico — doble beep */
    const playSuccess = useCallback(() => {
        beep(880, 0.08, 'sine', 0.1);
        setTimeout(() => beep(1100, 0.1, 'sine', 0.12), 100);
    }, [beep]);

    /** Toque de botón/navegación — click sutil */
    const playTap = useCallback(() => {
        beep(1000, 0.03, 'sine', 0.06);
    }, [beep]);

    return { playAdd, playRemove, playCheckout, playError, playSuccess, playTap };
}
