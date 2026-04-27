// src/hooks/useTasaCambio.js
// Hook de tasas de cambio — BCV + USDT (Binance P2P) + Manual
// Sincronización en tiempo real via configuracion_negocio + Supabase Realtime
// Construacero Carabobo
import { useState, useEffect, useCallback, useRef } from 'react'
import supabase from '../services/supabase/client'
import { useConfigNegocio, useActualizarConfig } from './useConfigNegocio'

const STORAGE_KEY = 'construacero_tasa_v1'
const STORAGE_KEY_USDT = 'construacero_tasa_usdt_v1'
const STORAGE_KEY_MODO = 'construacero_tasa_modo_v2'
const UPDATE_INTERVAL = 5 * 60 * 1000 // 5 minutos
const MIN_REFRESH_INTERVAL = 60 * 1000 // no refrescar más de 1x/min al volver al foco

// Modos válidos: 'bcv' | 'usdt' | 'manual'
const MODOS_VALIDOS = ['bcv', 'usdt', 'manual']

const DEFAULT_RATE = {
  precio: 0,
  fuente: '',
  ultimaActualizacion: null,
}

function parseSafeFloat(val) {
  if (!val) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const clean = val.replace(/[^\d.,]/g, '')
    const lastDot = clean.lastIndexOf('.')
    const lastComma = clean.lastIndexOf(',')
    const lastSep = Math.max(lastDot, lastComma)
    if (lastSep === -1) return parseFloat(clean) || 0
    const integer = clean.slice(0, lastSep).replace(/[.,]/g, '')
    const decimals = clean.slice(lastSep + 1)
    return parseFloat(`${integer}.${decimals}`) || 0
  }
  return 0
}

export function useTasaCambio() {
  // Config de BD (fuente de verdad para modo + tasa manual)
  const { data: config } = useConfigNegocio()
  const actualizarConfig = useActualizarConfig()

  // Tasa BCV
  const [tasaBcv, setTasaBcv] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (saved?.precio > 0) return saved
    } catch {}
    return DEFAULT_RATE
  })

  // Tasa USDT (Binance P2P)
  const [tasaUsdt, setTasaUsdt] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_USDT))
      if (saved?.precio > 0) return saved
    } catch {}
    return DEFAULT_RATE
  })

  // Modo: 'usdt' | 'manual' (bcv se mantiene internamente pero no como modo visible)
  const [modoTasa, setModoTasa] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_MODO)
    if (saved && MODOS_VALIDOS.includes(saved)) {
      if (saved === 'bcv') {
        localStorage.setItem(STORAGE_KEY_MODO, 'usdt')
        return 'usdt'
      }
      return saved
    }
    const legacy = localStorage.getItem('construacero_tasa_modo_auto')
    if (legacy !== null) {
      localStorage.removeItem('construacero_tasa_modo_auto')
      return JSON.parse(legacy) ? 'usdt' : 'manual'
    }
    return 'usdt'
  })

  // Tasa manual
  const [tasaManual, setTasaManual] = useState(() => {
    const saved = localStorage.getItem('construacero_tasa_manual')
    return saved && parseFloat(saved) > 0 ? saved : ''
  })

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const tasaRef = useRef(tasaBcv)
  const tasaUsdtRef = useRef(tasaUsdt)

  // Timestamp del último cambio local (para evitar eco del realtime)
  const localChangeTsRef = useRef(0)

  // ─── Sincronizar desde config BD (fuente de verdad) ──────────────────────────
  // Cuando useRealtimeSync detecta cambio en configuracion_negocio, refetch config,
  // y este effect actualiza modo + tasa manual para TODOS los usuarios en tiempo real
  useEffect(() => {
    if (!config || config.tasa_bcv_manual === undefined) return
    // Ignorar si nosotros mismos hicimos el cambio (evitar eco)
    if (Date.now() - localChangeTsRef.current < 5000) return

    const dbManual = Number(config.tasa_bcv_manual) || 0
    if (dbManual > 0) {
      setModoTasa('manual')
      setTasaManual(String(dbManual))
    } else {
      // Solo cambiar a usdt si estábamos en manual (evitar override al cargar)
      setModoTasa(prev => prev === 'manual' ? 'usdt' : prev)
    }
  }, [config?.tasa_bcv_manual, config?.actualizado_en])

  // Persistir en localStorage (cache rápido para recargas)
  useEffect(() => {
    tasaRef.current = tasaBcv
    if (tasaBcv.precio > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasaBcv))
  }, [tasaBcv])

  useEffect(() => {
    tasaUsdtRef.current = tasaUsdt
    if (tasaUsdt.precio > 0) localStorage.setItem(STORAGE_KEY_USDT, JSON.stringify(tasaUsdt))
  }, [tasaUsdt])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MODO, modoTasa)
  }, [modoTasa])

  useEffect(() => {
    localStorage.setItem('construacero_tasa_manual', tasaManual)
  }, [tasaManual])

  // Tasa efectiva según modo seleccionado
  const tasaEfectiva = modoTasa === 'usdt'
    ? (tasaUsdt.precio > 0 ? tasaUsdt.precio : tasaBcv.precio)
    : modoTasa === 'manual'
      ? (parseFloat(tasaManual) > 0 ? parseFloat(tasaManual) : tasaBcv.precio)
      : tasaBcv.precio

  // Backward compat: modoAuto = true cuando NO es manual
  const modoAuto = modoTasa !== 'manual'

  // Helper: fetch con timeout
  const fetchConTimeout = useCallback(async (url, timeout = 8000) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(id)
      if (!res.ok) return null
      return await res.json()
    } catch {
      clearTimeout(id)
      return null
    }
  }, [])

  // Fetch USDT — Binance P2P via CriptoYa
  const fetchUsdt = useCallback(async () => {
    const result = await fetchConTimeout('https://criptoya.com/api/binancep2p/USDT/VES/1', 10000)
    if (!result) return null

    const avgAsk = typeof result.ask === 'number' ? result.ask
      : (Array.isArray(result.ask) && result.ask.length > 0
        ? result.ask.slice(0, 3).reduce((s, i) => s + (i.price ?? i), 0) / Math.min(3, result.ask.length)
        : 0)
    const avgBid = typeof result.bid === 'number' ? result.bid
      : (Array.isArray(result.bid) && result.bid.length > 0
        ? result.bid.slice(0, 3).reduce((s, i) => s + (i.price ?? i), 0) / Math.min(3, result.bid.length)
        : 0)

    if (avgAsk <= 0 && avgBid <= 0) return null
    const precio = (avgAsk > 0 && avgBid > 0) ? (avgAsk + avgBid) / 2 : (avgAsk || avgBid)
    return { precio, fuente: 'Binance P2P' }
  }, [fetchConTimeout])

  // Fetch tasa BCV — múltiples fuentes con fallback
  const fetchBcv = useCallback(async () => {
    try {
      const data = await fetchConTimeout('https://script.google.com/macros/s/AKfycbxT9sKz_XWRWuQx_XP-BJ33T0hoAgJsLwhZA00v6nPt4Ij4jRjq-90mDGLVCsS6FXwW9Q/exec?token=Lvbp1994', 8000)
      const precio = parseSafeFloat(data?.bcv?.price)
      if (precio > 0) return { precio, fuente: 'BCV Oficial' }
    } catch { /* intenta siguiente fuente */ }

    try {
      const data = await fetchConTimeout('https://ve.dolarapi.com/v1/dolares', 8000)
      if (data && Array.isArray(data)) {
        const oficial = data.find(d =>
          d.fuente === 'oficial' || d.nombre === 'Oficial' || d.casa === 'oficial'
        )
        const precio = parseSafeFloat(oficial?.promedio)
        if (precio > 0) return { precio, fuente: 'BCV Oficial' }
      }
    } catch { /* intenta siguiente fuente */ }

    try {
      const data = await fetchConTimeout('https://pydolarve.org/api/v1/dollar?monitor=bcv', 8000)
      const precio = parseSafeFloat(data?.price)
      if (precio > 0) return { precio, fuente: 'BCV Oficial' }
    } catch { /* intenta siguiente fuente */ }

    try {
      const data = await fetchConTimeout('https://api.exchangedynamics.com/rates/VES', 8000)
      const precio = parseSafeFloat(data?.USD)
      if (precio > 0) return { precio, fuente: 'BCV Oficial' }
    } catch { /* sin más fuentes */ }

    return null
  }, [fetchConTimeout])

  // Fetch tasa BCV + USDT en paralelo
  const fetchTasa = useCallback(async (esAutoUpdate = false) => {
    if (!esAutoUpdate) setCargando(true)
    setError('')

    try {
      const [bcvData, usdtData] = await Promise.all([fetchBcv(), fetchUsdt()])

      if (bcvData && bcvData.precio > 0) {
        setTasaBcv({
          precio: bcvData.precio,
          fuente: bcvData.fuente,
          ultimaActualizacion: new Date().toISOString(),
        })
      } else if (!esAutoUpdate && tasaRef.current?.precio <= 0) {
        setError('No se pudo obtener la tasa BCV')
      }

      if (usdtData && usdtData.precio > 0) {
        setTasaUsdt({
          precio: Math.ceil(usdtData.precio) + 2,
          fuente: usdtData.fuente,
          ultimaActualizacion: new Date().toISOString(),
        })
      }
    } catch {
      if (!esAutoUpdate) setError('Error de conexión')
    } finally {
      if (!esAutoUpdate) setCargando(false)
    }
  }, [fetchBcv, fetchUsdt])

  // Auto-fetch al montar + intervalo de 5 min + refresco al volver al foco
  useEffect(() => {
    const lastFetchRef = { ts: 0 }

    const hasCachedRate = tasaRef.current?.precio > 0
    fetchTasa(hasCachedRate)
    lastFetchRef.ts = Date.now()

    const intervalId = setInterval(() => {
      fetchTasa(true)
      lastFetchRef.ts = Date.now()
    }, UPDATE_INTERVAL)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchRef.ts > MIN_REFRESH_INTERVAL) {
        fetchTasa(true)
        lastFetchRef.ts = Date.now()
      }
    }
    const onFocus = () => {
      if (Date.now() - lastFetchRef.ts > MIN_REFRESH_INTERVAL) {
        fetchTasa(true)
        lastFetchRef.ts = Date.now()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchTasa])

  // ─── Realtime sync: broadcast + persistencia en BD ────────────────────────────
  const _ignoreNextBroadcast = useRef(false)
  const channelRef = useRef(null)

  // Guardar modo + valor en BD (dispara realtime a todos los clientes)
  const guardarTasaEnBD = useCallback((modo, valorManual) => {
    localChangeTsRef.current = Date.now()
    const tasa_bcv_manual = modo === 'manual' && parseFloat(valorManual) > 0
      ? parseFloat(valorManual)
      : 0
    actualizarConfig.mutate({ tasa_bcv_manual })
  }, [actualizarConfig])

  // Wrappers que persisten en BD + broadcast instantáneo
  const setModoTasaSync = useCallback((modo) => {
    setModoTasa(modo)
    // Guardar en BD (esto dispara realtime para otros usuarios)
    guardarTasaEnBD(modo, modo === 'manual' ? tasaManual : '0')
    // Broadcast instantáneo como backup rápido
    _ignoreNextBroadcast.current = true
    try {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'tasa_change',
        payload: { modoTasa: modo, tasaManual: modo === 'manual' ? tasaManual : null, ts: Date.now() },
      })
    } catch { /* silencioso */ }
  }, [tasaManual, guardarTasaEnBD])

  const setTasaManualSync = useCallback((val) => {
    setTasaManual(val)
    // Guardar en BD
    guardarTasaEnBD('manual', val)
    // Broadcast instantáneo como backup rápido
    _ignoreNextBroadcast.current = true
    try {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'tasa_change',
        payload: { modoTasa: 'manual', tasaManual: val, ts: Date.now() },
      })
    } catch { /* silencioso */ }
  }, [guardarTasaEnBD])

  // Escuchar broadcast de otros dispositivos (sync instantáneo)
  useEffect(() => {
    const channel = supabase
      .channel('tasa-sync')
      .on('broadcast', { event: 'tasa_change' }, ({ payload }) => {
        if (!payload || _ignoreNextBroadcast.current) {
          _ignoreNextBroadcast.current = false
          return
        }
        if (payload.modoTasa && MODOS_VALIDOS.includes(payload.modoTasa)) {
          setModoTasa(payload.modoTasa)
        }
        if (payload.tasaManual !== null && payload.tasaManual !== undefined) {
          setTasaManual(String(payload.tasaManual))
        }
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [])

  return {
    tasaBcv,
    tasaUsdt,
    tasaEfectiva,
    modoTasa,
    setModoTasa: setModoTasaSync,
    modoAuto,
    tasaManual,
    setTasaManual: setTasaManualSync,
    cargando,
    error,
    refrescar: () => fetchTasa(false),
  }
}
