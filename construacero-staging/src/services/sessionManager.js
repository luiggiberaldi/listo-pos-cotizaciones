// src/services/sessionManager.js
// Coordinador GLOBAL de la sesión de Supabase Auth.
//
// Problema que resuelve: cada módulo (store, authFetch) tenía su propio
// "single-flight" duplicado y el camino del PIN devolvía silenciosamente el
// JWT vencido cuando el refresh fallaba → ciclo 401 → refresh → 400 →
// "Verificando…" congelado.
//
// Aquí existe UNA sola promesa de refresh compartida por toda la app y
// errores tipados (SESSION_EXPIRED / SESSION_REFRESH_TIMEOUT) para que el
// login por PIN nunca intente validarse con un token muerto.
import supabase from './supabase/client'

let refreshInFlight = null
let sessionDead = false // refresh token inválido/rotado confirmado por Supabase

export function isSessionDead() {
  return sessionDead
}

export function markSessionDead() {
  sessionDead = true
}

// Se reactiva la sesión ante eventos positivos (login, sync entre pestañas,
// TOKEN_REFRESHED exitoso en otro contexto) — lo invoca onAuthStateChange.
export function resetSessionState() {
  sessionDead = false
}

export function refreshSessionSingleFlight() {
  // Sesión confirmada como muerta: no martillar /auth/v1/token con 400s.
  if (sessionDead) {
    return Promise.resolve({ data: { session: null }, error: new Error('SESSION_EXPIRED') })
  }

  if (!refreshInFlight) {
    let timer
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ data: { session: null }, error: new Error('refresh_timeout') }), 3000)
    })

    refreshInFlight = Promise.race([supabase.auth.refreshSession(), timeoutPromise])
      .then((result) => {
        const err = result?.error
        const msg = String(err?.message || '').toLowerCase()
        const status = err?.status
        if (!result?.data?.session && err && (status === 400 || status === 401 || status === 403 || msg.includes('invalid') || msg.includes('refresh token'))) {
          sessionDead = true
        }
        return result
      })
      .finally(() => {
        clearTimeout(timer)
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

function errorTipado(code, mensaje) {
  const e = new Error(mensaje || code)
  e.code = code
  return e
}

/**
 * Devuelve un access_token VÁLIDO o lanza error tipado:
 * - SESSION_EXPIRED: no hay sesión o el refresh fue rechazado por Supabase.
 * - SESSION_REFRESH_TIMEOUT: Supabase Auth no respondió dentro del tope.
 *
 * allowStale=true (solo usos best-effort: cache de operadores, logout,
 * switchOut) devuelve el token viejo como último recurso. El camino crítico
 * del PIN usa allowStale=false — NUNCA recibe un JWT vencido como si fuera
 * válido.
 */
export async function getValidAccessToken({ timeoutMs = 4000, allowStale = true } = {}) {
  let session = null
  try {
    let timer
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout_get_session')), 2000)
    })
    const res = await Promise.race([supabase.auth.getSession(), timeoutPromise]).finally(() => clearTimeout(timer))
    session = res?.data?.session
  } catch {
    // Si getSession se traba por refresh bloqueante de Supabase SDK, leer token de localStorage
    try {
      const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (storageKey) {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          session = parsed?.currentSession || parsed?.session || parsed
        }
      }
    } catch { /* ignorar */ }
  }

  const token = session?.access_token
  if (!token) throw errorTipado('SESSION_EXPIRED', 'No hay sesión activa')

  // Token con vida útil → usarlo directamente (umbral de 120s para renovar con margen)
  const exp = session.expires_at // epoch en segundos
  const fresco = !exp || exp - Math.floor(Date.now() / 1000) >= 120
  if (fresco || allowStale) return token

  let timer
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(errorTipado('SESSION_REFRESH_TIMEOUT', 'El refresh de sesión no respondió a tiempo')), timeoutMs)
    })
    const { data: refreshed } = await Promise.race([refreshSessionSingleFlight(), timeoutPromise])
    const newToken = refreshed?.session?.access_token
    if (newToken) return newToken
    return token
  } catch (err) {
    if (token) return token
    throw err
  } finally {
    clearTimeout(timer)
  }
}
