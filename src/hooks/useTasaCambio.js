// src/hooks/useTasaCambio.js
// Hook de tasas de cambio — BCV + USDT (Binance P2P) + Manual
// Construacero Carabobo
import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'construacero_tasa_v1'
const STORAGE_KEY_USDT = 'construacero_tasa_usdt_v1'
const STORAGE_KEY_MODO = 'construacero_tasa_modo_v2'
const UPDATE_INTERVAL = 15 * 60 * 1000 // 15 minutos

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

  // Modo: 'bcv' | 'usdt' | 'manual'
  const [modoTasa, setModoTasa] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_MODO)
    if (saved && MODOS_VALIDOS.includes(saved)) return saved
    // Migrar legacy: si tenía modo_auto=true → bcv, si false → manual
    const legacy = localStorage.getItem('construacero_tasa_modo_auto')
    if (legacy !== null) {
      localStorage.removeItem('construacero_tasa_modo_auto')
      return JSON.parse(legacy) ? 'bcv' : 'manual'
    }
    return 'bcv'
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

  // Persistir cambios
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

  // Fetch tasa BCV + USDT en paralelo
  const fetchTasa = useCallback(async (esAutoUpdate = false) => {
    if (!esAutoUpdate) setCargando(true)
    setError('')

    try {
      const [dolarApiData, usdtData] = await Promise.all([
        fetchConTimeout('https://ve.dolarapi.com/v1/dolares'),
        fetchUsdt(),
      ])

      // Procesar BCV
      if (dolarApiData && Array.isArray(dolarApiData)) {
        const oficial = dolarApiData.find(d =>
          d.fuente === 'oficial' || d.nombre === 'Oficial' || d.casa === 'oficial'
        )
        if (oficial?.promedio > 0) {
          const precio = parseSafeFloat(oficial.promedio)
          if (precio > 0) {
            setTasaBcv({
              precio,
              fuente: 'BCV Oficial',
              ultimaActualizacion: new Date().toISOString(),
            })
          }
        }
      }

      // Procesar USDT
      if (usdtData && usdtData.precio > 0) {
        setTasaUsdt({
          precio: Math.round(usdtData.precio * 100) / 100,
          fuente: usdtData.fuente,
          ultimaActualizacion: new Date().toISOString(),
        })
      }

      if (!dolarApiData && tasaRef.current?.precio <= 0) {
        if (!esAutoUpdate) setError('No se pudo obtener la tasa BCV')
      }
    } catch {
      if (!esAutoUpdate) setError('Error de conexión')
    } finally {
      if (!esAutoUpdate) setCargando(false)
    }
  }, [fetchConTimeout, fetchUsdt])

  // Auto-fetch al montar + intervalo de 15 min
  useEffect(() => {
    const hasCachedRate = tasaRef.current?.precio > 0
    fetchTasa(hasCachedRate)
    const intervalId = setInterval(() => fetchTasa(true), UPDATE_INTERVAL)
    return () => clearInterval(intervalId)
  }, [fetchTasa])

  return {
    tasaBcv,          // { precio, fuente, ultimaActualizacion }
    tasaUsdt,         // { precio, fuente, ultimaActualizacion }
    tasaEfectiva,     // número: la tasa activa según modo
    modoTasa,         // 'bcv' | 'usdt' | 'manual'
    setModoTasa,      // setter para cambiar modo
    modoAuto,         // backward compat: true si no es manual
    tasaManual,       // string (input value)
    setTasaManual,
    cargando,
    error,
    refrescar: () => fetchTasa(false),
  }
}
