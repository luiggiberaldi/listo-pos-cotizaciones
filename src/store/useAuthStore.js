// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Cuenta única de negocio en auth.users — operadores se identifican con PIN
// El JWT lleva operator_id y operator_rol en app_metadata
import { create } from 'zustand'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import queryClient from '../lib/queryClient'

// ─── Mapear mensajes de error de Supabase a español ───────────────────────────
function traducirError(mensaje) {
  if (!mensaje) return 'Ocurrió un error inesperado'
  if (mensaje.includes('Invalid login credentials'))
    return 'Email o contraseña incorrectos'
  if (mensaje.includes('Email not confirmed'))
    return 'Debes confirmar tu email antes de entrar'
  if (mensaje.includes('Too many requests'))
    return 'Demasiados intentos. Espera unos minutos e intenta de nuevo'
  if (mensaje.includes('fetch') || mensaje.includes('network') || mensaje.includes('NetworkError'))
    return 'Error de conexión. Verifica tu internet e intenta de nuevo'
  return 'Error al iniciar sesión. Intenta de nuevo'
}

// ─── Helper: obtener token de sesión actual (con refresh si está expirado) ────
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null

  // Verificar si el token está próximo a expirar (menos de 60s de vida)
  const exp = data.session.expires_at // epoch en segundos
  if (exp && exp - Math.floor(Date.now() / 1000) < 60) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      return refreshed?.session?.access_token ?? token
    } catch {
      return token // usar el que hay si falla el refresh
    }
  }
  return token
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
    const handleOnline = () => {
      console.log('[AUTH] conexión restaurada — refrescando datos')
      set({ offline: false, error: null })
      // Invalidar todas las queries para que se refresquen con datos frescos
      queryClient.invalidateQueries()
    }
    const handleOffline = () => {
      console.log('[AUTH] conexión perdida')
      set({ offline: true })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

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
        console.log('[AUTH] evento:', event, 'session:', !!session, 'user:', session?.user?.email)
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
          if (!navigator.onLine && !esManual) {
            console.log('[AUTH] SIGNED_OUT ignorado — offline y no fue logout manual')
            return
          }
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
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
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
      .select('id, nombre, rol, activo, color')
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
    }
    // Solo actualizar si el perfil realmente cambió (evitar re-renders innecesarios)
    const perfilActual = get().perfil
    if (perfilActual && perfilActual.id === perfilNuevo.id && perfilActual.rol === perfilNuevo.rol && perfilActual.nombre === perfilNuevo.nombre && perfilActual.color === perfilNuevo.color) {
      return // perfil idéntico, no disparar re-render
    }
    guardarPerfilCache(perfilNuevo, authUser.id)
    set({ user: authUser, perfil: perfilNuevo, error: null })
  },

  // ─── Login del negocio (email + contraseña) ───────────────────────────────
  login: async (email, password) => {
    if (get().loading) return { ok: false }

    set({ loading: true, error: null, _cargandoPerfil: true })

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      set({ loading: false, error: traducirError(error.message), _cargandoPerfil: false })
      return { ok: false }
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
    if (get().loading) return { ok: false }

    set({ loading: true, error: null })

    // Helper para hacer la llamada al worker
    const callWorker = async (token) => {
      return fetch(apiUrl('/api/auth/switch-operator'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ operator_id: operatorId, pin }),
      })
    }

    try {
      let token = await getAccessToken()
      if (!token) {
        set({ loading: false, error: 'No hay sesión activa. Inicia sesión primero.' })
        return { ok: false }
      }

      let res = await callWorker(token)
      let result = await res.json()

      // Si el worker responde 401 "No autenticado" → sesión expirada
      // Intentar refrescar el token y reintentar una vez
      if (!res.ok && res.status === 401 && result.error?.includes('autenticado')) {
        console.log('[AUTH] switchOperator: sesión expirada, intentando refresh...')
        try {
          const { data: refreshData } = await supabase.auth.refreshSession()
          const freshToken = refreshData?.session?.access_token
          if (freshToken) {
            set({ user: refreshData.user })
            res = await callWorker(freshToken)
            result = await res.json()
          } else {
            // Refresh falló — forzar logout completo
            console.log('[AUTH] switchOperator: refresh falló, forzando logout')
            guardarPerfilCache(null, get().user?.id)
            set({ user: null, perfil: null, loading: false, error: 'Tu sesión expiró. Inicia sesión nuevamente.' })
            await supabase.auth.signOut()
            return { ok: false }
          }
        } catch {
          guardarPerfilCache(null, get().user?.id)
          set({ user: null, perfil: null, loading: false, error: 'Tu sesión expiró. Inicia sesión nuevamente.' })
          await supabase.auth.signOut()
          return { ok: false }
        }
      }

      if (!res.ok) {
        // Si el worker está caído (500) → intentar validación offline con cache
        // Esto evita falsos "PIN incorrecto" cuando wrangler no corre localmente
        if (res.status === 500) {
          throw new Error('worker_unavailable')
        }
        set({ loading: false, error: result.error || 'PIN incorrecto' })
        return { ok: false }
      }

      // Setear perfil inmediatamente con datos del worker (sin esperar refresh)
      const op = result.operator
      if (op) {
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
        }
        guardarPerfilCache(perfilOp, get().user?.id)
        set({ perfil: perfilOp, loading: false, error: null })
      }

      // Refrescar JWT en background — no bloquear al usuario
      // Guard: solo un refresh concurrente a la vez para evitar bucle de eventos
      if (!get()._refreshingToken) {
        set({ _refreshingToken: true })
        supabase.auth.refreshSession()
          .then(({ data }) => { if (data?.user) set({ user: data.user }) })
          .catch(() => { /* ignorar — perfil ya está seteado */ })
          .finally(() => set({ _refreshingToken: false }))
      }

      return { ok: true }
    } catch (err) {
      // Error de red — intentar validación local con PBKDF2 usando operadores cacheados
      const userId = get().user?.id
      const operators = leerOperadoresCache(userId)
      const op = operators?.find(o => o.id === operatorId)

      if (op && op.pin_hash && op.pin_salt) {
        const pinValido = await verifyPinLocal(pin, op.pin_hash, op.pin_salt)
        if (pinValido) {
          const perfilOp = {
            id: op.id,
            nombre: op.nombre,
            email: get().user?.email,
            rol: op.rol,
            activo: true,
            color: op.color ?? null,
            _offline: true,
          }
          guardarPerfilCache(perfilOp, userId)
          set({ perfil: perfilOp, loading: false, error: null })
          console.log('[AUTH] PIN validado localmente (offline) —', op.nombre)
          return { ok: true, offline: true }
        }
        // PIN incorrecto — validación local determinó que es incorrecto
        set({ loading: false, error: 'PIN incorrecto' })
        return { ok: false }
      }

      // No hay cache de operadores — no se puede validar offline
      set({
        loading: false,
        error: !navigator.onLine
          ? 'Sin conexión. Conecta a internet la primera vez para habilitar el modo offline.'
          : 'Error de conexión. Verifica tu internet e intenta de nuevo.',
      })
      return { ok: false }
    }
  },

  // ─── Cambiar de operador (volver a selección) ─────────────────────────────
  switchOut: async () => {
    set({ loading: true, error: null })

    try {
      const token = await getAccessToken()
      if (token) {
        await fetch(apiUrl('/api/auth/clear-operator'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }

      // Refrescar para limpiar app_metadata del JWT
      await supabase.auth.refreshSession()

      // Limpiar cache de datos del operador anterior
      queryClient.clear()
      const userId = get().user?.id
      guardarPerfilCache(null, userId)
      set({ perfil: null, loading: false, error: null })
    } catch {
      guardarPerfilCache(null, get().user?.id)
      set({ perfil: null, loading: false })
    }
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
    guardarPerfilCache(null, userId)
    set({ user: null, perfil: null, error: null, _logoutManual: false })
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
