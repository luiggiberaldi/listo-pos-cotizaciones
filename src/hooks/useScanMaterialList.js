import { useState } from 'react'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'

export function useScanMaterialList() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)

  async function scan(base64, mimeType = 'image/jpeg') {
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No hay sesión activa')

      const res = await fetch(apiUrl('/api/scan-material-list'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image: base64, mimeType }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error procesando imagen')
      setResults(data)
      return data
    } catch (e) {
      setError(e.message)
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

  return { scan, loading, error, results, reset }
}
