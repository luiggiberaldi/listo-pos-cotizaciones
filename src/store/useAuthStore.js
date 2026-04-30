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

// ─── Cache de perfil en localStorage ──────────────────────────────────────────
const PERFIL_CACHE_KEY = 'listo_perfil_cache'

function guardarPerfilCache(perfil) {
  try {
    if (perfil) {
      localStorage.setItem(PERFIL_CACHE_KEY, JSON.stringify(perfil))
    } else {
      localStorage.removeItem(PERFIL_CACHE_KEY)
    }
  } catch { /* ignorar */ }
}

function leerPerfilCache() {
  try {
    const raw = localStorage.getItem(PERFIL_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ─── Store ────────────────────────────────────────────────────────────────────
const useAuthStore = create((set, get) => ({
  // Estado
  user: null,          // Objeto auth.user de Supabase (cuenta del negocio)
  perfil: null,        // { id, nombre, email, rol, activo, color } del operador activo
  loading: false,
  error: null,
  initialized: false,  // true una vez que se verificó la sesión inicial
  _cargandoPerfil: false,
  _logoutManual: false,

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

    // SEGURIDAD: NO restaurar perfil desde cache al recargar.
    // El usuario siempre debe re-seleccionar operador con PIN.
    guardarPerfilCache(null)

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
              // SEGURIDAD: Solo setear user, NO cargar perfil automáticamente.
              // El usuario debe seleccionar operador con PIN en cada sesión.
              set({ user: session.user, _cargandoPerfil: false })
            } else {
              console.log('[AUTH] INITIAL_SESSION sin user (no hay sesión)')
            }
          } catch (err) {
            console.log('[AUTH] error en INITIAL_SESSION:', err.message)
          } finally {
            clearTimeout(timeoutId)
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
          const wasLoggedIn = get().user !== null && !get()._logoutManual
          guardarPerfilCache(null)
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
      guardarPerfilCache(perfilDev)
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
      guardarPerfilCache(null)
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
      guardarPerfilCache(null)
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
    guardarPerfilCache(perfilNuevo)
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

    return { ok: true }
  },

  // ─── Seleccionar operador con PIN ─────────────────────────────────────────
  switchOperator: async (operatorId, pin) => {
    if (get().loading) return { ok: false }

    set({ loading: true, error: null })

    try {
      const token = await getAccessToken()
      if (!token) {
        set({ loading: false, error: 'No hay sesión activa. Inicia sesión primero.' })
        return { ok: false }
      }

      const res = await fetch(apiUrl('/api/auth/switch-operator'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ operator_id: operatorId, pin }),
      })

      const result = await res.json()

      if (!res.ok) {
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
        guardarPerfilCache(perfilOp)
        set({ perfil: perfilOp, loading: false, error: null })
      }

      // Refrescar JWT en background — no bloquear al usuario
      supabase.auth.refreshSession()
        .then(({ data }) => { if (data?.user) set({ user: data.user }) })
        .catch(() => { /* ignorar — perfil ya está seteado */ })

      return { ok: true }
    } catch (err) {
      set({ loading: false, error: 'Error de conexión. Verifica tu internet.' })
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

      guardarPerfilCache(null)
      set({ perfil: null, loading: false, error: null })
    } catch {
      guardarPerfilCache(null)
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
    await supabase.auth.signOut()
    guardarPerfilCache(null)
    set({ user: null, perfil: null, error: null, _logoutManual: false })
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
