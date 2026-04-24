import { useState } from 'react'
import supabase from '../services/supabase/client'

const WORKER_BASE = 'https://listo-pos-cotizaciones-s8kixx.camelai.app'

export function useScanMaterialList() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('No hay sesión activa')
    return token
  }

  async function fetchWithTimeout(url, body, timeoutMs = 90000) {
    const token = await getToken()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error procesando solicitud')
    return data
  }

  async function scan(base64, mimeType = 'image/jpeg') {
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const data = await fetchWithTimeout(
        `${WORKER_BASE}/api/scan-material-list`,
        { image: base64, mimeType }
      )
      setResults(data)
      return data
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Tiempo agotado. Intenta de nuevo.' : e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function parseText(text) {
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const data = await fetchWithTimeout(
        `${WORKER_BASE}/api/parse-material-text`,
        { text }
      )
      setResults(data)
      return data
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Tiempo agotado. Intenta de nuevo.' : e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setLoading(false)
    setError(null)
    setResults(null)
  }

  return { scan, parseText, loading, error, results, reset }
}
