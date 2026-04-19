// src/hooks/useTasaCambio.js
// Hook de tasa de cambio BCV — auto-fetch + modo manual
// Construacero Carabobo
import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'construacero_tasa_v1'
const UPDATE_INTERVAL = 15 * 60 * 1000 // 15 minutos

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
  // Tasa BCV auto
  const [tasaBcv, setTasaBcv] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (saved?.precio > 0) return saved
    } catch {}
    return DEFAULT_RATE
  })

  // Modo auto vs manual
  const [modoAuto, setModoAuto] = useState(() => {
    const saved = localStorage.getItem('construacero_tasa_modo_auto')
    return saved !== null ? JSON.parse(saved) : true
  })

  // Tasa manual
  const [tasaManual, setTasaManual] = useState(() => {
    const saved = localStorage.getItem('construacero_tasa_manual')
    return saved && parseFloat(saved) > 0 ? saved : ''
  })

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const tasaRef = useRef(tasaBcv)

  // Persistir cambios
  useEffect(() => {
    tasaRef.current = tasaBcv
    if (tasaBcv.precio > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasaBcv))
  }, [tasaBcv])

  useEffect(() => {
    localStorage.setItem('construacero_tasa_modo_auto', JSON.stringify(modoAuto))
  }, [modoAuto])

  useEffect(() => {
    localStorage.setItem('construacero_tasa_manual', tasaManual)
  }, [tasaManual])

  // Tasa efectiva
  const tasaEfectiva = modoAuto
    ? tasaBcv.precio
    : (parseFloat(tasaManual) > 0 ? parseFloat(tasaManual) : tasaBcv.precio)

  // Fetch tasa BCV
  const fetchTasa = useCallback(async (esAutoUpdate = false) => {
    if (!esAutoUpdate) setCargando(true)
    setError('')

    const fetchConTimeout = async (url, timeout = 5000) => {
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
    }

    try {
      // Fuente primaria: DolarAPI Venezuela
      const data = await fetchConTimeout('https://ve.dolarapi.com/v1/dolares')

      if (data && Array.isArray(data)) {
        const oficial = data.find(d =>
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
            if (!esAutoUpdate) setCargando(false)
            return
          }
        }
      }

      // Fallback: ExchangeRate API (USD→VES)
      const fallback = await fetchConTimeout(
        'https://v6.exchangerate-api.com/v6/F1a3af26247a97a33ee5ad90/pair/USD/VES'
      )
      if (fallback?.result === 'success' && fallback.conversion_rate > 0) {
        setTasaBcv({
          precio: parseSafeFloat(fallback.conversion_rate),
          fuente: 'ExchangeRate (Respaldo)',
          ultimaActualizacion: new Date().toISOString(),
        })
        if (!esAutoUpdate) setCargando(false)
        return
      }

      if (!esAutoUpdate) setError('No se pudo obtener la tasa BCV')
    } catch (err) {
      console.error('Error al obtener tasa:', err)
      if (!esAutoUpdate) setError('Error de conexión')
    } finally {
      if (!esAutoUpdate) setCargando(false)
    }
  }, [])

  // Auto-fetch al montar + intervalo de 15 min
  // Si ya hay tasa en cache (localStorage), hacer el primer fetch en background
  // para no bloquear la UI con el spinner
  useEffect(() => {
    const hasCachedRate = tasaRef.current?.precio > 0
    fetchTasa(hasCachedRate) // esAutoUpdate=true si hay cache → no muestra spinner
    const intervalId = setInterval(() => fetchTasa(true), UPDATE_INTERVAL)
    return () => clearInterval(intervalId)
  }, [fetchTasa])

  return {
    tasaBcv,          // { precio, fuente, ultimaActualizacion }
    tasaEfectiva,     // número: la tasa a usar (auto o manual)
    modoAuto,         // boolean
    setModoAuto,
    tasaManual,       // string (input value)
    setTasaManual,
    cargando,
    error,
    refrescar: () => fetchTasa(false),
  }
}
