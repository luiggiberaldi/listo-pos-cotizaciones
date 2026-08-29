// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Cuenta única de negocio en auth.users — operadores se identifican con PIN
// El JWT lleva operator_id y operator_rol en app_metadata
import { create } from 'zustand'
import supabase from '../services/supabase/client'
import { apiUrl, fetchConTimeout } from '../services/apiBase'
import { getValidAccessToken, refreshSessionSingleFlight, resetSessionState } from '../services/sessionManager'
import queryClient from '../lib/queryClient'
import { indexedDbPersister } from '../lib/queryPersister'

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

const CACHE_MAX_AGE_PERFIL = 1000 * 60 * 60 * 24 // 24h
const CACHE_MAX_AGE_OPERATORS = 1000 * 60 * 60 * 24 * 7 // 7 días

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
      localStorage.setItem(operatorsKey, JSON.stringify({ operators, _cachedAt: Date.now() }))
    }
  } catch { /* ignorar */ }
}

function leerOperadoresCache(userId) {
  try {
    const { operatorsKey } = getStorageKeys(userId)
    const raw = localStorage.getItem(operatorsKey)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_MAX_AGE_OPERATORS) {
      localStorage.removeItem(operatorsKey)
      return null
    }
    return cached.operators ?? null
  } catch { return null }
}

// ─── Validación local de PIN con PBKDF2 (mismo algoritmo que el worker) ────────
// Usa WebCrypto API del browser — mismos parámetros: 10k iter, SHA-256, 256 bits
async function hashPinPBKDF2(pin, salt) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10_000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPinLocal(pin, storedHash, storedSalt) {
  try {
    const hash = await hashPinPBKDF2(pin, storedSalt)
    return hash === storedHash
  } catch { return false }
}

// ─── Descargar y cachear operadores en background ────────────────────────────
async function fetchAndCacheOperators(token, userId) {
  try {
    const res = await fetch(apiUrl('/api/auth/operators'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const { operators } = await res.json()
    if (Array.isArray(operators) && operators.length > 0) {
      guardarOperadoresCache(operators, userId)
      console.log('[AUTH] operadores cacheados para uso offline:', operators.length)
    }
  } catch { /* ignorar — no crítico */ }
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
      if (document.visibilityState === 'visible') get().precalentarToken()
    }
    document.addEventListener('visibilitychange', handleVisible)

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
        // SIGNED_IN puede emitirse varias veces durante el arranque, al
        // recuperar el foco de la pestaña o por múltiples reintentos. Si el
        // usuario ya está inicializado, no hay nada que reprocesar.
        if (event === 'SIGNED_IN' && session?.user) {
          const currentUser = get().user
          if (get().initialized && currentUser?.id === session.user.id) return
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
              if (offline && cached) {
                console.log('[AUTH] modo offline: restaurando perfil cacheado —', cached.nombre, '/', cached.rol)
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

        if (event === 'SIGNED_OUT') {
          // Si estamos offline y no fue un logout manual, ignorar el SIGNED_OUT.
          // Supabase puede disparar este evento cuando falla el refresco del token por red,
          // lo que borraría el cache y expulsaría al usuario innecesariamente.
          const esManual = get()._logoutManual
          if (!esManual) {
            console.log('[AUTH] SIGNED_OUT detectado de Supabase (sin logout manual). Verificando si podemos conservar la sesión...')
            
            // Si hay un perfil de operador activo en el store, ignoramos el deslogueo automático de Supabase.
            // Esto previene que micro-cortes de red o fallos momentáneos de Supabase expulsen al usuario.
            if (get().perfil) {
              console.log('[AUTH] micro-corte o refresh fallido detectado. Manteniendo sesión local activa.')
              set({ error: 'Conexión inestable detectada. Operando en modo de respaldo local.' })
              return
            }
          }

          // Si es manual, o si no hay perfil de operador activo (limpieza real)
          const wasLoggedIn = get().user !== null && !esManual
          const userId = get().user?.id
          guardarPerfilCache(null, userId)
          set({ user: null, perfil: null, error: null, _logoutManual: false })
          if (wasLoggedIn) {
            set({ error: 'Tu sesión ha expirado. Inicia sesión nuevamente para no perder tu trabajo.' })
          }
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
      subscription.unsubscribe()
    }
  },

  // ─── Cargar perfil del operador desde public.usuarios ──────────────────────
  // Lee operator_id de app_metadata. Si no hay → perfil queda null (requiere selección).
  _cargarPerfil: async (authUser) => {
    const operatorId = authUser.app_metadata?.operator_id
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

    if (error || !data) {
      guardarPerfilCache(null, authUser.id)
      set({
        user: authUser,
        perfil: null,
        error: 'Operador no encontrado. Selecciona otro operador.',
      })
      return
    }

    if (!data.activo) {
      // Operador desactivado — limpiar metadata y volver a selección
      try {
        const token = await getAccessToken()
        if (token) {
          await fetch(apiUrl('/api/auth/clear-operator'), {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
        }
      } catch { /* ignorar */ }
      guardarPerfilCache(null, authUser.id)
      set({
        user: authUser,
        perfil: null,
        error: 'Este operador está desactivado. Contacta al supervisor.',
      })
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

    // Si entra una cuenta de negocio distinta, purgar el cache persistido para
    // no arrastrar datos de la cuenta anterior (inventario/config son por cuenta)
    const prevUserId = get().user?.id
    if (prevUserId && prevUserId !== data.user.id) {
      queryClient.clear()
      indexedDbPersister.removeClient().catch(() => {})
    }

    // Setear user — el perfil SOLO se establece al seleccionar operador con PIN
    set({ user: data.user, loading: false, _cargandoPerfil: false, error: null })

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

    set({ loading: true, error: null })

    // Helper: acotar cualquier promesa con un timeout duro.
    // Sin esto, un fetch estancado en red inestable deja el modal
    // "Verificando…" congelado indefinidamente.
    const conLimite = (promesa, ms, etiqueta) =>
      Promise.race([
        promesa,
        new Promise((_, reject) => setTimeout(() => reject(new Error(etiqueta)), ms)),
      ])

    const opNombre = get().user?.nombre || operatorId
    const t0 = Date.now()
    console.log(`[AUTH-PIN] 🚀 Paso 1: switchOperator iniciado para operador ${operatorId}`)

    // Helper para hacer la llamada al worker (en DEV conecta directo a localhost:8787)
    const callWorker = async (token) => {
      const endpoints = import.meta.env.DEV
        ? ['http://localhost:8787/api/auth/switch-operator', 'http://127.0.0.1:8787/api/auth/switch-operator', apiUrl('/api/auth/switch-operator')]
        : [apiUrl('/api/auth/switch-operator')]
      const uniqueEndpoints = [...new Set(endpoints)]

      let lastError = null
      for (const url of uniqueEndpoints) {
        console.log(`[AUTH-PIN] 📡 Paso 3: Enviando POST a ${url} (timeout 4s)...`)
        const tw0 = Date.now()
        try {
          const response = await fetchConTimeout(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'X-Request-Id': `auth-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({ operator_id: operatorId, pin }),
          }, 4000)
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
      console.log(`[AUTH-PIN] 📄 Contenido crudo de respuesta (${text?.length || 0} bytes):`, text || '(vacío)')
      if (!text) return {}
      try { return JSON.parse(text) } catch { return { rawText: text } }
    }

    try {
      // Tope de 8s y ESTRICTO: si Supabase Auth no entrega un token válido,
      // NO se envía el JWT vencido al Worker (evita 401→refresh→400);
      // caemos directo al catch donde el fallback offline PBKDF2 resuelve.
      console.log('[AUTH-PIN] 🔑 Paso 2: Obteniendo token válido de Supabase...')
      let token = await getValidAccessToken({ timeoutMs: 8000 })
      console.log(`[AUTH-PIN] 🔑 Token: ${token ? `${token.slice(0, 20)}... (OK)` : 'NO DISPONIBLE'}`)
      if (!token) {
        set({ loading: false, error: 'No hay sesión activa. Inicia sesión primero.' })
        return { ok: false, error: 'No hay sesión activa. Inicia sesión primero.' }
      }

      let res = await callWorker(token)
      let result = await readResponseJson(res)

      // Si el worker responde 401 "No autenticado" → sesión expirada
      // Intentar refrescar el token y reintentar una vez
      if (!res.ok && res.status === 401 && result?.error === 'No autenticado') {
        console.log('[AUTH-PIN] 🔄 Worker respondió 401 (token expirado). Refrescando sesión...')
        try {
          const { data: refreshData } = await conLimite(refreshSessionSingleFlight(), 8000, 'refresh_timeout')
          const freshToken = refreshData?.session?.access_token
          if (freshToken) {
            console.log('[AUTH-PIN] 🔄 Sesión refrescada exitosamente. Reintentando llamada al Worker...')
            set({ user: refreshData.user })
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

      // Setear perfil inmediatamente con datos del worker (sin esperar refresh)
      const op = result.operator
      if (op) {
        console.log(`[AUTH-PIN] ✅ Login exitoso en ${Date.now() - t0}ms para ${op.nombre} (${op.rol})`)
        // Invalidar queries sensibles al operador (no borrar todo el cache)
        queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
        queryClient.invalidateQueries({ queryKey: ['despachos'] })
        queryClient.invalidateQueries({ queryKey: ['comisiones'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard_metricas'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard_metrics'] })
        queryClient.invalidateQueries({ queryKey: ['cuentas_por_cobrar'] })

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

      // Refrescar JWT en background — no bloquear al usuario
      if (!get()._refreshingToken) {
        set({ _refreshingToken: true })
        refreshSessionSingleFlight()
          .then(({ data }) => { if (data?.user) set({ user: data.user }) })
          .catch(() => { /* ignorar — perfil ya está seteado */ })
          .finally(() => set({ _refreshingToken: false }))
      }

      return { ok: true }
    } catch (err) {
      console.warn(`[AUTH-PIN] 🛡️ Fallo remoto (${err.name}: ${err.message}) en ${Date.now() - t0}ms. Intentando fallback offline...`);
      // Error de red — intentar validación local con PBKDF2 usando operadores cacheados
      const userId = get().user?.id
      const operators = leerOperadoresCache(userId)
      console.log(`[AUTH-PIN] 📦 Operadores en caché offline disponibles: ${operators?.length || 0}`)
      const op = operators?.find(o => o.id === operatorId)

      if (op && op.pin_hash && op.pin_salt) {
        console.log(`[AUTH-PIN] 🔐 Validando PIN localmente con PBKDF2 para ${op.nombre}...`)
        const pinValido = await verifyPinLocal(pin, op.pin_hash, op.pin_salt)
        if (pinValido) {
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
            _offline: true,
          }
          guardarPerfilCache(perfilOp, userId)
          set({ perfil: perfilOp, loading: false, error: null })
          console.log('[AUTH-PIN] ✅ PIN validado localmente (offline) con éxito —', op.nombre)
          return { ok: true, offline: true }
        }
        console.warn('[AUTH-PIN] ❌ PIN incorrecto en validación local')
        set({ loading: false, error: 'PIN incorrecto' })
        return { ok: false, error: 'PIN incorrecto' }
      }

      // No hay cache de operadores — no se puede validar offline
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
    // 1. Limpieza local inmediata e instantánea (0ms)
    const userId = get().user?.id
    guardarPerfilCache(null, userId)
    queryClient.clear()
    indexedDbPersister.removeClient().catch(() => {})
    set({ perfil: null, loading: false, error: null })

    // 2. Limpieza en el backend en background (no bloquea la UI)
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (token) {
          const endpoints = import.meta.env.DEV
            ? ['http://localhost:8787/api/auth/clear-operator', 'http://127.0.0.1:8787/api/auth/clear-operator', apiUrl('/api/auth/clear-operator')]
            : [apiUrl('/api/auth/clear-operator')]
          for (const url of endpoints) {
            try {
              const controller = new AbortController()
              const timer = setTimeout(() => controller.abort(), 3000)
              await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
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
    // Limpiar operador antes de cerrar sesión
    try {
      const token = await getAccessToken()
      if (token) {
        await fetch(apiUrl('/api/auth/clear-operator'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch { /* ignorar */ }

    set({ _logoutManual: true })
    const userId = get().user?.id
    await supabase.auth.signOut()
    resetSessionState()
    // Limpiar TODO el cache (memoria + persistido) — evita fugas entre cuentas de negocio
    queryClient.clear()
    indexedDbPersister.removeClient().catch(() => {})
    guardarPerfilCache(null, userId)
    set({ user: null, perfil: null, error: null, _logoutManual: false })
  },

  // ─── Precalentar token en background ──────────────────────────────────
  // Refresca el JWT si está por vencer SIN bloquear la UI. Se invoca al abrir
  // el modal de PIN y al recuperar foco, para que switchOperator nunca espere
  // un refresh síncrono (la causa del cuelgue "Verificando…" en producción).
  precalentarToken: async () => {
    try {
      if (!get().user) return
      await getAccessToken()
    } catch { /* no crítico — switchOperator tiene tope propio + fallback offline */ }
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
