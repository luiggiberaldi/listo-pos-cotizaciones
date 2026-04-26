// src/services/supabase/adminClient.js
// Cliente para operaciones admin — llama al Worker backend en /api/admin/
// El service_role key NUNCA se expone al frontend.
import supabase from './client'
import { apiUrl } from '../apiBase'

async function getAuthToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

async function adminFetch(path, method = 'POST', body = null) {
  const token = await getAuthToken()
  if (!token) throw new Error('No autenticado')

  const res = await fetch(apiUrl(`/api/admin/${path}`), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`)
  }
  return data
}

export const adminAPI = {
  createUser: (data) => adminFetch('users', 'POST', data),
  updateUser: (id, data) => adminFetch(`users/${id}`, 'PUT', data),
  deleteUser: (id) => adminFetch(`users/${id}`, 'DELETE'),

  async downloadBackup() {
    const token = await getAuthToken()
    if (!token) throw new Error('No autenticado')

    const res = await fetch(apiUrl('/api/admin/backup'), {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const text = await res.text()
      let data = {}
      try { data = JSON.parse(text) } catch { /* noop */ }
      throw new Error(data.error || `Error ${res.status}`)
    }

    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="([^"]+)"/)
    const filename = match ? match[1] : `backup-${new Date().toISOString().slice(0, 10)}.json`

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)

    return filename
  },

  async clearInventory() {
    return adminFetch('clear-inventory', 'DELETE')
  },

  async factoryReset() {
    return adminFetch('factory-reset', 'DELETE')
  },

  async resetOperacional() {
    return adminFetch('reset-operacional', 'DELETE')
  },

  async restoreBackup(file) {
    const token = await getAuthToken()
    if (!token) throw new Error('No autenticado')

    const text = await file.text()
    let backup
    try { backup = JSON.parse(text) } catch { throw new Error('El archivo no es un JSON válido') }

    const res = await fetch(apiUrl('/api/admin/restore'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(backup),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
    return data.resumen
  },

  // ── System Logs ──────────────────────────────────────────────────────
  getLogs: (params = {}) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set('page', params.page)
    if (params.limit) qs.set('limit', params.limit)
    if (params.nivel) qs.set('nivel', params.nivel)
    if (params.origen) qs.set('origen', params.origen)
    if (params.categoria) qs.set('categoria', params.categoria)
    if (params.desde) qs.set('desde', params.desde)
    if (params.hasta) qs.set('hasta', params.hasta)
    return adminFetch(`logs?${qs.toString()}`, 'GET')
  },

  getLogStats: () => adminFetch('logs/stats', 'GET'),

  async downloadLogs() {
    const token = await getAuthToken()
    if (!token) throw new Error('No autenticado')

    const res = await fetch(apiUrl('/api/admin/logs/download'), {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const text = await res.text()
      let data = {}
      try { data = JSON.parse(text) } catch {}
      throw new Error(data.error || `Error ${res.status}`)
    }

    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="([^"]+)"/)
    const filename = match ? match[1] : `system-logs-${new Date().toISOString().slice(0, 10)}.json`

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)

    return filename
  },

  analyzeLogs: (tipo) => adminFetch('logs/analyze', 'POST', { tipo }),

  purgeLogs: (dias = 0) => adminFetch('logs/purge', 'DELETE', { dias }),

  // ── Auditoría ──────────────────────────────────────────────────────
  getAudit: (params = {}) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set('page', params.page)
    if (params.limit) qs.set('limit', params.limit)
    if (params.categoria) qs.set('categoria', params.categoria)
    if (params.usuario_id) qs.set('usuario_id', params.usuario_id)
    if (params.accion) qs.set('accion', params.accion)
    if (params.desde) qs.set('desde', params.desde)
    if (params.hasta) qs.set('hasta', params.hasta)
    return adminFetch(`audit?${qs.toString()}`, 'GET')
  },

  getAuditStats: () => adminFetch('audit/stats', 'GET'),

  analyzeAudit: () => adminFetch('audit/analyze', 'POST'),
}

// ── Dev Tools API (solo desarrollador) ──────────────────────────────────
async function devFetch(path, method = 'GET') {
  const token = await getAuthToken()
  if (!token) throw new Error('No autenticado')
  const res = await fetch(apiUrl(`/api/dev/${path}`), {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
  return data
}

export const devAPI = {
  healthCheck: () => devFetch('health'),
  async getTestResults() {
    const res = await fetch(apiUrl('/test-results.json'))
    if (!res.ok) return null
    return res.json().catch(() => null)
  },
}
