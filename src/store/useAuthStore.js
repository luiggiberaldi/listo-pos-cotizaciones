// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Cuenta única de negocio en auth.users — operadores se identifican con PIN
// El JWT lleva operator_id y operator_rol en app_metadata
import { create } from 'zustand'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'

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

// ─── Helper: obtener token de sesión actual ───────────────────────────────────
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
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
    const timeoutId = setTimeout(() => {
      if (!get().initialized) {
        set({ initialized: true, user: null, perfil: null })
      }
    }, 2000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') {
          try {
            if (session?.user) {
              // Setear user inmediatamente para que LoginPage sepa que hay sesión
              set({ user: session.user })
              const perfilPromise = get()._cargarPerfil(session.user)
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 1800)
              )
              await Promise.race([perfilPromise, timeoutPromise])
            }
          } catch {
            // Error al cargar perfil inicial — se ignora
          } finally {
            clearTimeout(timeoutId)
            set({ initialized: true })
          }
        }

        if (event === 'SIGNED_IN' && session?.user) {
          if (!get()._cargandoPerfil) {
            // Setear user para que la app sepa que hay sesión
            set({ user: session.user })
            // Solo cargar perfil si hay operador seleccionado en app_metadata
            const opId = session.user.app_metadata?.operator_id
            if (opId && (!get().perfil || get().perfil.id !== opId)) {
              await get()._cargarPerfil(session.user)
            }
          }
        }

        if (event === 'SIGNED_OUT') {
          const wasLoggedIn = get().user !== null && !get()._logoutManual
          set({ user: null, perfil: null, error: null, _logoutManual: false })
          if (wasLoggedIn) {
            set({ error: 'Tu sesión ha expirado. Inicia sesión nuevamente para no perder tu trabajo.' })
          }
        }

        if (event === 'TOKEN_REFRESHED' && session?.user) {
          set({ user: session.user })
          // Si el token refrescado trae operador, actualizar perfil si no hay
          const opId = session.user.app_metadata?.operator_id
          if (opId && !get().perfil) {
            await get()._cargarPerfil(session.user)
          }
        }
      }
    )

    return () => {
      clearTimeout(timeoutId)
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

    // Super Admin — no existe en tabla usuarios, perfil sintético
    if (operatorId === '00000000-0000-0000-0000-000000000000') {
      set({
        user: authUser,
        perfil: {
          id: operatorId,
          nombre: 'Super Admin',
          email: authUser.email,
          rol: 'supervisor',
          activo: true,
          color: '#ef4444',
          _isSuperAdmin: true,
        },
        error: null,
      })
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
      set({
        user: authUser,
        perfil: null,
        error: 'Este operador está desactivado. Contacta al supervisor.',
      })
      return
    }

    set({
      user: authUser,
      perfil: {
        id: data.id,
        nombre: data.nombre,
        email: authUser.email,
        rol: data.rol,
        activo: data.activo,
        color: data.color ?? null,
      },
      error: null,
    })
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

    // Setear user — el perfil se carga cuando se seleccione operador
    set({ user: data.user, loading: false, _cargandoPerfil: false, error: null })

    // Si ya hay operador en metadata (sesión previa), cargar perfil
    if (data.user.app_metadata?.operator_id) {
      try {
        await get()._cargarPerfil(data.user)
      } catch { /* ignorar */ }
    }

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
        set({
          perfil: {
            id: op.id,
            nombre: op.nombre,
            email: get().user?.email,
            rol: op.rol,
            activo: true,
            color: op.color ?? null,
          },
          loading: false,
          error: null,
        })
      }

      // Refrescar JWT para que RLS funcione con el nuevo operador
      // IMPORTANTE: await para que el JWT tenga operator_id antes de que el usuario interactúe
      try {
        const { data: refreshData } = await supabase.auth.refreshSession()
        if (refreshData?.user) set({ user: refreshData.user })
      } catch { /* ignorar — perfil ya está seteado */ }

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

      set({ perfil: null, loading: false, error: null })
    } catch {
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
    set({ user: null, perfil: null, error: null, _logoutManual: false })
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
