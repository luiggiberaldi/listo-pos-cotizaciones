// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Cuenta única de negocio en auth.users — operadores se identifican con PIN
// Cada pestaña usa una sesión de operador validada; app_metadata no concede permisos.
import { create } from 'zustand'
import supabase from '../services/supabase/client'
import { apiUrl, fetchConTimeout } from '../services/apiBase'
import { getValidAccessToken, refreshSessionSingleFlight, resetSessionState } from '../services/sessionManager'
import queryClient from '../lib/queryClient'
import { indexedDbPersister } from '../lib/queryPersister'
import { setOperatorSession, getOperatorSession, getOperatorSessionHeaders, clearOperatorSession, subscribeOperatorSession, checkOperatorSessionExpiry } from '../services/operatorSession'

let operatorAttempt = 0

// ─── Mapear mensajes de error de Supabase a español ───────────────────────────
function traducirError(mensaje) {
  if (!mensaje) return 'Ocurrió un error inesperado'
  if (mensaje.includes('Invalid login credentials'))
    return 'Email o contraseña incorrectos'
  if (mensaje.includes('Email not confirmed'))
    return 'Debes confirmar tu email antes de entrar'
  if (mensaje.includes('Too many requests'))
    return 'Demasiados intentos. Espera unos minutos e intenta de nuevo'
  if (mensaje.includes('abort') || mensaje.includes('AbortError') || mensaje.includes('TimeoutError') || mensaje.includes('Tiempo de espera') || mensaje.includes('timeout'))
    return 'La conexión tardó demasiado tiempo. Verifica tu internet e intenta de nuevo'
  if (mensaje.includes('fetch') || mensaje.includes('network') || mensaje.includes('NetworkError'))
    return 'Error de conexión. Verifica tu internet e intenta de nuevo'
  return 'Error al iniciar sesión. Intenta de nuevo'
}

// ─── Helper: token best-effort (cache offline, logout, switchOut) ────────────
// Delega en el coordinador global (sessionManager). El camino crítico del PIN
// usa getValidAccessToken() directo: estricto, nunca devuelve silenciosamente
// un JWT vencido (causa del ciclo 401 → refresh → 400 → "Verificando…").
async function getAccessToken() {
  try {
    return await getValidAccessToken({ timeoutMs: 8000, allowStale: true })
  } catch {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  }
}

// ─── Cache por usuario en localStorage ────────────────────────────────────────
function getStorageKeys(userId) {
  const suffix = userId ? `-${userId}` : ''
  return {
    perfilKey: `listo_perfil_cache${suffix}`,
    operatorsKey: `listo_operators_cache${suffix}`
  }
}

const AUTH_CACHE_VERSION = 'v3_20260915_server_sessions'
const CACHE_MAX_AGE_PERFIL = 1000 * 60 * 60 * 24 // 24h

function guardarPerfilCache(perfil, userId) {
  try {
    const { perfilKey } = getStorageKeys(userId)
    if (perfil) {
      localStorage.setItem(perfilKey, JSON.stringify({ ...perfil, _cachedAt: Date.now() }))
    } else {
      localStorage.removeItem(perfilKey)
    }
  } catch { /* ignorar */ }
}

function leerPerfilCache(userId) {
  try {
    const { perfilKey } = getStorageKeys(userId)
    const raw = localStorage.getItem(perfilKey)
    if (!raw) return null
    const cached = JSON.parse(raw)
    // Invalidar si tiene más de 24h
    if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_MAX_AGE_PERFIL) {
      localStorage.removeItem(perfilKey)
      return null
    }
    return cached
  } catch { return null }
}

function guardarOperadoresCache(operators, userId) {
  try {
    const { operatorsKey } = getStorageKeys(userId)
    if (Array.isArray(operators) && operators.length > 0) {
      localStorage.setItem(operatorsKey, JSON.stringify({
        version: AUTH_CACHE_VERSION,
        operators: operators.map(({ id, nombre, rol, color, codigo, es_externo }) => ({ id, nombre, rol, color, codigo, es_externo })),
        _cachedAt: Date.now()
      }))
    }
  } catch { /* ignorar */ }
}

// Las credenciales de otros operadores nunca se descargan para validación offline.
// Un cambio de operador requiere verificar el PIN en el servidor.

// ─── Descargar y cachear operadores en background ────────────────────────────
async function fetchAndCacheOperators(token, userId) {
  try {
    const endpoints = import.meta.env.DEV
      ? ['http://localhost:8787/api/auth/operators', apiUrl('/api/auth/operators')]
      : [apiUrl('/api/auth/operators'), 'https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/auth/operators']
    for (const url of endpoints) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer))
        if (!res.ok) continue
        const { operators } = await res.json()
        if (Array.isArray(operators) && operators.length > 0) {
          guardarOperadoresCache(operators, userId)
          console.log('[AUTH] Operadores cacheados para uso offline (v2):', operators.length)
          return
        }
      } catch { /* intentar siguiente */ }
    }
  } catch { /* ignorar — no crítico */ }
}

// Purge only authentication/query caches, never offline business records.
function purgeOperatorState() {
  operatorAttempt++
  guardarPerfilCache(null, useAuthStore.getState().user?.id)
  useAuthStore.setState({ perfil: null, loading: false, _cargandoPerfil: false })
  clearOperatorSession()
  void queryClient.cancelQueries().catch(() => {})
  queryClient.clear()
  void indexedDbPersister.removeClient().catch(() => {})
}

function adoptAccount(authUser) {
  const previousAccountId = useAuthStore.getState().user?.id
  const sessionAccountId = getOperatorSession()?.accountId
  if (previousAccountId !== authUser?.id || (sessionAccountId && sessionAccountId !== authUser?.id)) {
    purgeOperatorState()
  }
  useAuthStore.setState({ user: authUser || null })
}

// ─── Store ────────────────────────────────────────────────────────────────────
const useAuthStore = create((set, get) => ({
  // Estado
  user: null,          // Objeto auth.user de Supabase (cuenta del negocio)
  perfil: null,        // { id, nombre, email, rol, activo, color } del operador activo
  loading: false,
  error: null,
  initialized: false,  // true una vez que se verificó la sesión inicial
  offline: !navigator.onLine, // estado de conectividad
  _cargandoPerfil: false,
  _logoutManual: false,
  _refreshingToken: false, // guard para evitar múltiples refreshSession concurrentes

  // ─── Inicializar: suscribirse a cambios de auth ────────────────────────────
  initialize: () => {
    // Eliminar solo el antiguo caché de operadores que podía contener hashes de PIN.
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('listo_operators_cache')) {
          const cached = JSON.parse(localStorage.getItem(key) || '{}')
          if (cached.version !== AUTH_CACHE_VERSION) localStorage.removeItem(key)
        }
      }
    } catch { /* la falta de storage nunca concede permisos */ }
    console.log('[AUTH] initialize() llamado')
    // Detectar si hay sesión guardada para dar más tiempo
    let haySession = false
    try {
      const keys = Object.keys(localStorage)
      const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (sbKey && localStorage.getItem(sbKey)) haySession = true
    } catch { /* ignorar */ }
    console.log('[AUTH] haySession:', haySession)

    // ── Offline awareness ──
    // Obtener userId de la sesión (si existe) para leer cache correcto
    let currentUserId = null
    try {
      const keys = Object.keys(localStorage)
      const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (sbKey) {
        const sbData = JSON.parse(localStorage.getItem(sbKey))
        currentUserId = sbData?.user?.id
      }
    } catch { /* ignorar */ }

    const estaOffline = !navigator.onLine
    const perfilCacheado = leerPerfilCache(currentUserId)
    set({ offline: estaOffline })

    if (estaOffline && perfilCacheado) {
      console.log('[AUTH] offline detectado con perfil cacheado — modo sin conexión activado')
      // No limpiar el cache — se restaurará en INITIAL_SESSION
    }
    // El cache NO se borra online: persiste hasta logout/switchOut explícito.
    // Esto permite el fallback en switchOperator cuando la red falla.

    // Listeners de conectividad
    // Debounce: en redes inestables el evento 'online' se dispara en ráfagas;
    // solo invalidar una vez que la conexión se estabilice (3s sin cortes)
    let onlineDebounceId = null
    const handleOnline = () => {
      console.log('[AUTH] conexión restaurada — refrescando datos')
      set({ offline: false, error: null })
      if (onlineDebounceId) clearTimeout(onlineDebounceId)
      onlineDebounceId = setTimeout(() => {
        onlineDebounceId = null
        // Solo refetch de queries ACTIVAS (visibles en pantalla).
        // Las inactivas quedan stale y se refrescan solas al montar su vista.
        queryClient.invalidateQueries({ refetchType: 'active' })
      }, 3000)
    }
    const handleOffline = () => {
      console.log('[AUTH] conexión perdida')
      set({ offline: true })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Precalentar token al recuperar foco: en producción el tab/tablet queda
    // suspendida horas, el token expira y el refresh terminaba DENTRO del
    // camino crítico del PIN (causa del cuelgue "Verificando…"). Aquí ocurre
    // apenas la app vuelve a ser visible, antes de que el usuario llegue al PIN.
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        checkOperatorSessionExpiry()
        get().precalentarToken()
      }
    }
    const handleFocus = () => checkOperatorSessionExpiry()
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleFocus)
    checkOperatorSessionExpiry()

    const timeoutId = setTimeout(() => {
      const state = get()
      console.log('[AUTH] timeout principal disparado — initialized:', state.initialized, 'user:', !!state.user, 'perfil:', !!state.perfil)
      if (!state.initialized) {
        console.log('[AUTH] forzando initialized=true por timeout')
        set({ initialized: true })
      }
    }, haySession ? 3000 : 1500)

    // Segundo timeout: si hay user pero no perfil después de 12s, limpiar para evitar loop
    const safetyTimeoutId = setTimeout(() => {
      const { user, perfil, initialized } = get()
      console.log('[AUTH] safety timeout — initialized:', initialized, 'user:', !!user, 'perfil:', !!perfil)
      if (user && !perfil) {
        console.log('[AUTH] safety: user sin perfil, forzando perfil=null')
        set({ initialized: true, perfil: null })
      }
    }, 6000)

    console.log('[AUTH] registrando onAuthStateChange...')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        checkOperatorSessionExpiry()
        if (event === 'SIGNED_OUT') {
          const wasLoggedIn = Boolean(get().user) && !get()._logoutManual
          purgeOperatorState()
          set({ user: null, error: wasLoggedIn ? 'Tu sesión ha expirado. Inicia sesión nuevamente.' : null, _logoutManual: false })
          return
        }
        if (session?.user && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
          adoptAccount(session.user)
        } else if (event === 'INITIAL_SESSION' && !session) {
          adoptAccount(null)
        }
        console.log('[AUTH] evento:', event, 'session:', !!session, 'user:', session?.user?.email)
        // Evento positivo (login, sync entre pestañas, refresh OK) → revertir
        // el estado de sesión muerta del coordinador global.
        if (session) resetSessionState()
        // Mantener el canal Realtime autenticado con el token actual —
        // necesario para que postgres_changes sobre tablas con RLS entregue eventos
        if (session?.access_token) {
          try { supabase.realtime.setAuth(session.access_token) } catch { /* noop */ }
        }

        if (event === 'INITIAL_SESSION') {
          try {
            if (session?.user) {
              console.log('[AUTH] INITIAL_SESSION con user, seteando user...')
              // Si estamos offline y hay perfil cacheado válido, restaurarlo
              // El usuario ya se autentricó con PIN antes — puede continuar offline
              const offline = !navigator.onLine
              const cached = leerPerfilCache(session.user.id)
              if (offline && cached && getOperatorSession()?.accountId === session.user.id && getOperatorSession()?.operatorId === cached.id) {
                set({ user: session.user, perfil: cached, _cargandoPerfil: false })
              } else {
                // Online: solo setear user, NO cargar perfil automáticamente (requiere PIN)
                set({ user: session.user, _cargandoPerfil: false })
              }
            } else {
              console.log('[AUTH] INITIAL_SESSION sin user (no hay sesión)')
            }
          } catch (err) {
            console.log('[AUTH] error en INITIAL_SESSION:', err.message)
          } finally {
            clearTimeout(timeoutId)
            clearTimeout(safetyTimeoutId)
            console.log('[AUTH] seteando initialized=true')
            set({ initialized: true, _cargandoPerfil: false })
          }
        }

        if (event === 'SIGNED_IN' && session?.user) {
          // Solo actualizar user si cambió (evitar re-renders innecesarios)
          const currentUser = get().user
          if (!currentUser || currentUser.id !== session.user.id) {
            set({ user: session.user })
          }
          // SEGURIDAD: NO cargar perfil automáticamente desde metadata.
          // El perfil solo se establece a través de switchOperator() (PIN).
        }

        if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Solo actualizar user si realmente cambió (evitar re-renders innecesarios)
          const currentUser = get().user
          if (!currentUser || currentUser.id !== session.user.id || currentUser.email !== session.user.email) {
            set({ user: session.user })
          }
          // SEGURIDAD: NO cargar perfil automáticamente.
          // Si el perfil ya está seteado (por switchOperator), se mantiene.
        }
      }
    )

    return () => {
      clearTimeout(timeoutId)
      clearTimeout(safetyTimeoutId)
      if (onlineDebounceId) clearTimeout(onlineDebounceId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleFocus)
      subscription.unsubscribe()
    }
  },

  // ─── Cargar perfil del operador desde public.usuarios ──────────────────────
  // Solo con una sesión de operador verificada para esta pestaña.
  _cargarPerfil: async (authUser) => {
    const operatorSession = getOperatorSession()
    const operatorId = operatorSession?.accountId === authUser.id ? operatorSession.operatorId : null
    if (!operatorId) {
      // Hay sesión de negocio pero no se ha seleccionado operador
      set({ user: authUser, perfil: null, error: null })
      return
    }

    // Desarrollador — no existe en tabla usuarios, perfil sintético
    if (operatorId === '00000000-0000-0000-0000-000000000000') {
      const perfilDev = {
        id: operatorId,
        nombre: 'Desarrollador',
        email: authUser.email,
        rol: 'desarrollador',
        activo: true,
        color: '#8b5cf6',
        _isSuperAdmin: true,
      }
      guardarPerfilCache(perfilDev, authUser.id)
      set({ user: authUser, perfil: perfilDev, error: null })
      return
    }

    const queryPromise = supabase
      .from('usuarios')
      .select('id, nombre, rol, activo, color, markup_pct, comision_pct, comision_pct_cabilla, es_externo')
      .eq('id', operatorId)
      .single()

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout_perfil')), 5000)
    )

    const { data, error } = await Promise.race([queryPromise, timeoutPromise])
      .catch(err => ({ data: null, error: err }))

    if (getOperatorSession() !== operatorSession || get().user?.id !== authUser.id) return
    if (error || !data) {
      purgeOperatorState()
      guardarPerfilCache(null, authUser.id)
      set({
        user: authUser,
        perfil: null,
        error: 'Operador no encontrado. Selecciona otro operador.',
      })
      return
    }

    if (!data.activo) {
      purgeOperatorState()
      set({ error: 'Este operador está desactivado. Contacta al supervisor.' })
      return
    }

    const perfilNuevo = {
      id: data.id,
      nombre: data.nombre,
      email: authUser.email,
      rol: data.rol,
      activo: data.activo,
      color: data.color ?? null,
      markup_pct: data.markup_pct ?? null,
      comision_pct: data.comision_pct ?? null,
      comision_pct_cabilla: data.comision_pct_cabilla ?? null,
      es_externo: !!data.es_externo,
    }
    // Solo actualizar si el perfil realmente cambió (evitar re-renders innecesarios)
    const perfilActual = get().perfil
    if (
      perfilActual &&
      perfilActual.id === perfilNuevo.id &&
      perfilActual.rol === perfilNuevo.rol &&
      perfilActual.nombre === perfilNuevo.nombre &&
      perfilActual.color === perfilNuevo.color &&
      perfilActual.markup_pct === perfilNuevo.markup_pct &&
      perfilActual.comision_pct === perfilNuevo.comision_pct &&
      perfilActual.es_externo === perfilNuevo.es_externo
    ) {
      return // perfil idéntico, no disparar re-render
    }
    guardarPerfilCache(perfilNuevo, authUser.id)
    set({ user: authUser, perfil: perfilNuevo, error: null })
  },

  // ─── Login del negocio (email + contraseña) ───────────────────────────────
  login: async (email, password) => {
    if (get().loading) return { ok: false }

    const previousAccountId = get().user?.id
    purgeOperatorState()
    set({ loading: true, error: null, _cargandoPerfil: true })

    let data, error
    try {
      ({ data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      }))
    } catch (err) {
      set({ loading: false, error: traducirError(err?.message), _cargandoPerfil: false })
      return { ok: false }
    }

    if (error) {
      set({ loading: false, error: traducirError(error.message), _cargandoPerfil: false })
      return { ok: false }
    }

    // Capture the old account before signInWithPassword emits SIGNED_IN.
    if (previousAccountId && previousAccountId !== data.user.id) purgeOperatorState()
    adoptAccount(data.user)
    set({ loading: false, _cargandoPerfil: false, error: null })

    // Descargar operadores en background para cache offline
    const userId = data.user.id
    getAccessToken()
      .then(token => { if (token) fetchAndCacheOperators(token, userId) })
      .catch(() => { /* ignorar */ })

    return { ok: true }
  },

  // ─── Seleccionar operador con PIN ─────────────────────────────────────────
  switchOperator: async (operatorId, pin) => {
    // Intento anterior aún en curso (red lentísima): avisar en vez de fallar en silencio
    if (get().loading) return { ok: false, busy: true }

    const attempt = ++operatorAttempt
    const accountId = get().user?.id
    const isCurrentAttempt = () => attempt === operatorAttempt && get().user?.id === accountId
    const assertAttempt = () => {
      if (!isCurrentAttempt()) throw new Error('Selección cancelada.')
    }
    set({ perfil: null, loading: true, error: null })
    const previousSessionHeaders = getOperatorSessionHeaders()
    clearOperatorSession()
    void queryClient.cancelQueries().catch(() => {})
    queryClient.clear()
    void indexedDbPersister.removeClient().catch(() => {})

    // Helper: acotar cualquier promesa con un timeout duro.
    // Sin esto, un fetch estancado en red inestable deja el modal
    // "Verificando…" congelado indefinidamente.
    const conLimite = (promesa, ms, etiqueta) => {
      let timer
      return Promise.race([
        promesa,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(etiqueta)), ms) }),
      ]).finally(() => clearTimeout(timer))
    }

    console.log(`[AUTH-PIN] 🚀 Paso 1: switchOperator iniciado para operador ${operatorId}`)

    // Helper para hacer la llamada al worker con multi-endpoint y timeout resiliente
    const callWorker = async (token) => {
      const endpoints = import.meta.env.DEV
        ? ['http://localhost:8787/api/auth/switch-operator', 'http://127.0.0.1:8787/api/auth/switch-operator', apiUrl('/api/auth/switch-operator')]
        : [
            apiUrl('/api/auth/switch-operator'),
            'https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/auth/switch-operator',
          ]
      const uniqueEndpoints = [...new Set(endpoints)]

      let lastError = null
      for (const url of uniqueEndpoints) {
        assertAttempt()
        console.log(`[AUTH-PIN] 📡 Paso 3: Enviando POST a ${url} (timeout 10s)...`)
        const tw0 = Date.now()
        try {
          const response = await fetchConTimeout(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-Request-Id': `auth-${crypto.randomUUID()}`,
              ...previousSessionHeaders,
            },
            body: JSON.stringify({ operator_id: operatorId, pin }),
          }, 10000)
          console.log(`[AUTH-PIN] 📥 Paso 4: Respuesta del Worker recibida en ${Date.now() - tw0}ms con status ${response.status}`)
          return response
        } catch (workerErr) {
          console.warn(`[AUTH-PIN] ⚠️ Endpoint ${url} falló tras ${Date.now() - tw0}ms (${workerErr.message}), intentando siguiente...`)
          lastError = workerErr
        }
      }
      throw lastError
    }

    // Vite/Wrangler puede devolver una respuesta 500 vacía cuando el Worker
    // local no está levantado; no asumir que toda respuesta es JSON.
    const readResponseJson = async (response) => {
      const text = await response.text()
      // La respuesta contiene una credencial de sesión: no registrar su contenido.
      if (!text) return {}
      try { return JSON.parse(text) } catch { return { rawText: text } }
    }

    try {
      // Tope de 8s y ESTRICTO: si Supabase Auth no entrega un token válido,
      // NO se envía el JWT vencido al Worker (evita 401→refresh→400);
      // caemos directo al catch donde el fallback offline PBKDF2 resuelve.
      console.log('[AUTH-PIN] 🔑 Paso 2: Obteniendo token válido de Supabase...')
      let token = await getValidAccessToken({ timeoutMs: 8000, allowStale: false })
      assertAttempt()
      // No registrar tokens, ni siquiera parcialmente.
      if (!token) {
        set({ loading: false, error: 'No hay sesión activa. Inicia sesión primero.' })
        return { ok: false, error: 'No hay sesión activa. Inicia sesión primero.' }
      }

      let res = await callWorker(token)
      let result = await readResponseJson(res)

      if (!isCurrentAttempt()) {
        if (result.operatorSession?.token) {
          void fetchConTimeout(apiUrl('/api/auth/clear-operator'), { method: 'POST', headers: {
            Authorization: `Bearer ${token}`, 'X-Operator-Session': result.operatorSession.token,
          } }, 5000).catch(() => {})
        }
        return { ok: false, error: 'La selección de operador fue cancelada.' }
      }

      // Si el worker responde 401 "No autenticado" → sesión expirada
      // Intentar refrescar el token y reintentar una vez
      if (!res.ok && res.status === 401 && result?.error === 'No autenticado') {
        console.log('[AUTH-PIN] 🔄 Worker respondió 401 (token expirado). Refrescando sesión...')
        try {
          const { data: refreshData } = await conLimite(refreshSessionSingleFlight(), 8000, 'refresh_timeout')
          assertAttempt()
          const freshToken = refreshData?.session?.access_token
          const refreshedUser = refreshData?.session?.user || refreshData?.user
          if (freshToken && refreshedUser?.id === accountId) {
            token = freshToken
            set({ user: refreshedUser })
            try { supabase.realtime.setAuth(freshToken) } catch { /* Realtime failure cannot change login authority. */ }
            res = await callWorker(freshToken)
            result = await readResponseJson(res)
          } else {
            console.warn('[AUTH-PIN] ⚠️ Refresh no entregó nuevo token.')
            throw new Error('refresh_failed_offline_fallback')
          }
        } catch (e) {
          console.warn('[AUTH-PIN] ⚠️ Error durante refresh:', e.message)
          throw new Error(e.message || 'refresh_failed_offline_fallback')
        }
      }

      if (!isCurrentAttempt()) {
        if (result.operatorSession?.token) {
          void fetchConTimeout(apiUrl('/api/auth/clear-operator'), { method: 'POST', headers: {
            Authorization: `Bearer ${token}`, 'X-Operator-Session': result.operatorSession.token,
          } }, 5000).catch(() => {})
        }
        return { ok: false, error: 'La selección de operador fue cancelada.' }
      }
      if (!res.ok) {
        console.warn(`[AUTH-PIN] ⚠️ Worker respondió con error status: ${res.status}`, result)
        // PIN incorrecto: devolver de inmediato sin intentar reautenticación
        if (result?.error === 'PIN incorrecto') {
          set({ loading: false, error: 'PIN incorrecto' })
          return { ok: false, error: 'PIN incorrecto' }
        }

        // Un 401 confirmado después del refresh
        if (res.status === 401) {
          set({ loading: false, error: 'La sesión no fue aceptada. Vuelve a iniciar sesión.' })
          return { ok: false, sessionExpired: true, error: 'La sesión no fue aceptada. Vuelve a iniciar sesión.' }
        }

        // Si el worker está caído (500) → intentar validación offline con cache
        if (res.status >= 500) {
          throw new Error('worker_unavailable')
        }
        if (res.status === 401 && result.error === 'No autenticado') {
          throw new Error('auth_session_invalid')
        }
        set({ loading: false, error: result.error || 'PIN incorrecto' })
        return { ok: false, error: result.error || 'PIN incorrecto' }
      }

      const op = result.operator
      if (!op || op.id !== operatorId) throw new Error('Respuesta de operador inválida')
      if (op) {
        // No await entre la comprobación del intento, la credencial y el perfil publicado.
        queryClient.clear()
        setOperatorSession(result.operatorSession, { accountId, operatorId: op.id })

        const perfilOp = {
          id: op.id,
          nombre: op.nombre,
          email: get().user?.email,
          rol: op.rol,
          activo: true,
          color: op.color ?? null,
          markup_pct: op.markup_pct ?? null,
          comision_pct: op.comision_pct ?? null,
          comision_pct_cabilla: op.comision_pct_cabilla ?? null,
          es_externo: !!op.es_externo,
        }
        guardarPerfilCache(perfilOp, get().user?.id)
        set({ perfil: perfilOp, loading: false, error: null })
      }

      return { ok: true }
    } catch (err) {
      if (attempt !== operatorAttempt || get().user?.id !== accountId) return { ok: false, error: 'Selección cancelada.' }
      clearOperatorSession()
      guardarPerfilCache(null, get().user?.id)
      // Sin prueba del servidor no se reutilizan privilegios ni hashes cacheados.
      // El usuario puede reintentar cuando haya conexión.
      const sesionExpirada = err.code === 'SESSION_EXPIRED' || err.message === 'auth_session_invalid'
      const esTimeout = err.code === 'SESSION_REFRESH_TIMEOUT'
        || ['timeout_red', 'token_timeout', 'refresh_timeout'].includes(err.message)
      const errorMsg = sesionExpirada
        ? 'Tu sesión expiró. Inicia sesión nuevamente con tu correo.'
        : (esTimeout
          ? 'El servidor tardó más de 15 segundos en responder (timeout_red). Revisa que el Worker esté corriendo.'
          : (err.message === 'worker_unavailable'
            ? 'El servidor local (Worker) devolvió un error 500 o no está disponible.'
            : (!navigator.onLine
              ? 'Sin conexión a internet.'
              : `Error de conexión: ${err.message}`)))

      console.error(`[AUTH-PIN] ❌ switchOperator terminado con error final:`, errorMsg)
      set({ loading: false, error: errorMsg })
      return { ok: false, sessionExpired: sesionExpirada, error: errorMsg }
    }
  },

  // ─── Cambiar de operador (volver a selección) ─────────────────────────────
  switchOut: async () => {
    const previousSessionHeaders = getOperatorSessionHeaders()
    purgeOperatorState()
    set({ error: null })

    // 2. Limpieza en el backend en background (no bloquea la UI)
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (token) {
          const endpoints = import.meta.env.DEV
            ? ['http://localhost:8787/api/auth/clear-operator', 'http://127.0.0.1:8787/api/auth/clear-operator', apiUrl('/api/auth/clear-operator')]
            : [apiUrl('/api/auth/clear-operator'), 'https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/auth/clear-operator']
          for (const url of endpoints) {
            try {
              const controller = new AbortController()
              const timer = setTimeout(() => controller.abort(), 6000)
              await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, ...previousSessionHeaders },
                signal: controller.signal,
              }).finally(() => clearTimeout(timer))
              break
            } catch { /* intentar siguiente */ }
          }
        }
        await refreshSessionSingleFlight().catch(() => {})
      } catch { /* best-effort background */ }
    })()
  },

  // ─── Reset de contraseña (email) ───────────────────────────────────────────
  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { ok: !error, error: error?.message }
  },

  // ─── Logout completo ─────────────────────────────────────────────────────
  logout: async () => {
    const previousSessionHeaders = getOperatorSessionHeaders()
    const businessToken = getAccessToken()
    purgeOperatorState()
    void businessToken.then(token => token && previousSessionHeaders['X-Operator-Session']
      ? fetchConTimeout(apiUrl('/api/auth/clear-operator'), {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, ...previousSessionHeaders },
      }, 5000) : null).catch(() => {})
    // 1. Limpieza síncrona e inmediata del estado local y storage
    set({ user: null, perfil: null, error: null, _logoutManual: true })
    resetSessionState()

    try {
      const keys = Object.keys(localStorage)
      for (const k of keys) {
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
          localStorage.removeItem(k)
        }
        if (k.startsWith('listo_perfil_cache')) {
          localStorage.removeItem(k)
        }
      }
    } catch { /* ignorar */ }

    // 2. Limpieza en background (no bloquea la UI)
    ;(async () => {
      try {
        await Promise.race([
          supabase.auth.signOut(),
          new Promise(r => setTimeout(r, 1000))
        ])
      } catch { /* ignorar */ }
      set({ _logoutManual: false })
    })()
  },

  // ─── Precalentar token en background ──────────────────────────────────
  // Refresca el JWT si está por vencer SIN bloquear la UI. Se invoca al abrir
  // el modal de PIN y al recuperar foco, para que switchOperator nunca espere
  // un refresh síncrono (la causa del cuelgue "Verificando…" en producción).
  precalentarToken: async () => {
    try {
      if (!get().user) return
      await getValidAccessToken({ timeoutMs: 4000, allowStale: false })
    } catch { /* no crítico — switchOperator tiene tope propio + fallback offline */ }
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

subscribeOperatorSession(() => {
  if (!getOperatorSession() && useAuthStore.getState().perfil) purgeOperatorState()
})

export default useAuthStore
