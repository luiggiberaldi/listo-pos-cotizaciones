// src/services/supabase/adminClient.js
// Cliente para operaciones admin — llama al Worker backend en /api/admin/
// El service_role key NUNCA se expone al frontend.
import supabase from './client'

async function getAuthToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

async function adminFetch(path, method = 'POST', body = null) {
  const token = await getAuthToken()
  if (!token) throw new Error('No autenticado')

  const res = await fetch(`/api/admin/${path}`, {
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

    const res = await fetch('/api/admin/backup', {
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
}
