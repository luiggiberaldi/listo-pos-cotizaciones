// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Rol viene de public.usuarios (tabla de la BD, no de los metadatos de auth)
import { create } from 'zustand'
import supabase from '../services/supabase/client'

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

// ─── Store ────────────────────────────────────────────────────────────────────
const useAuthStore = create((set, get) => ({
  // Estado
  user: null,          // Objeto auth.user de Supabase
  perfil: null,        // { id, nombre, email, rol, activo } desde public.usuarios
  loading: false,
  error: null,
  initialized: false,  // true una vez que se verificó la sesión inicial

  // ─── Inicializar: suscribirse a cambios de auth ────────────────────────────
  // Llamar UNA sola vez en el arranque de la app (App.jsx useEffect)
  initialize: () => {
    // Timeout de seguridad: si en 8 segundos no se inicializó, forzar login
    const timeoutId = setTimeout(() => {
      if (!get().initialized) {
        set({ initialized: true, user: null, perfil: null })
      }
    }, 8000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // INITIAL_SESSION = primera verificación al registrar el listener
        if (event === 'INITIAL_SESSION') {
          try {
            if (session?.user) {
              const perfilPromise = get()._cargarPerfil(session.user)
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 6000)
              )
              await Promise.race([perfilPromise, timeoutPromise])
            }
          } catch (err) {
            console.warn('Error al cargar perfil inicial:', err.message)
          } finally {
            clearTimeout(timeoutId)
            set({ initialized: true })
          }
        }

        // SIGNED_IN = login exitoso
        if (event === 'SIGNED_IN' && session?.user) {
          if (!get().perfil || get().perfil.id !== session.user.id) {
            await get()._cargarPerfil(session.user)
          }
        }

        // SIGNED_OUT = logout
        if (event === 'SIGNED_OUT') {
          set({ user: null, perfil: null, error: null })
        }

        // TOKEN_REFRESHED = solo actualizar el objeto user
        if (event === 'TOKEN_REFRESHED' && session?.user) {
          set({ user: session.user })
        }
      }
    )

    // Devolver la función de cleanup
    return () => {
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  },

  // ─── Cargar perfil desde public.usuarios ──────────────────────────────────
  // Uso interno. Con timeout de 7s para evitar colgamiento infinito.
  _cargarPerfil: async (authUser) => {
    const queryPromise = supabase
      .from('usuarios')
      .select('id, nombre, rol, activo')
      .eq('id', authUser.id)
      .single()

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout_perfil')), 7000)
    )

    const { data, error } = await Promise.race([queryPromise, timeoutPromise])
      .catch(err => ({ data: null, error: err }))

    if (error || !data) {
      // El usuario existe en auth pero no en la tabla usuarios
      // Puede pasar si el supervisor no completó el alta
      set({
        user: authUser,
        perfil: null,
        error: 'Tu cuenta no está configurada correctamente. Contacta al supervisor.',
      })
      return
    }

    if (!data.activo) {
      // Usuario desactivado
      await supabase.auth.signOut()
      set({
        user: null,
        perfil: null,
        error: 'Tu cuenta está desactivada. Contacta al supervisor.',
      })
      return
    }

    set({
      user: authUser,
      perfil: {
        id: data.id,
        nombre: data.nombre,
        email: authUser.email,
        rol: data.rol,       // 'supervisor' | 'vendedor'
        activo: data.activo,
      },
      error: null,
    })
  },

  // ─── Login ─────────────────────────────────────────────────────────────────
  login: async (email, password) => {
    set({ loading: true, error: null })

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      set({ loading: false, error: traducirError(error.message) })
      return { ok: false }
    }

    // El perfil se carga vía onAuthStateChange (SIGNED_IN)
    // pero lo cargamos también aquí para no depender del timing del evento
    try {
      await get()._cargarPerfil(data.user)
    } catch (_) {
      // Si falla la carga del perfil, el error ya fue seteado en _cargarPerfil
    }
    set({ loading: false })
    // Solo ok:true si el perfil se cargó correctamente
    return get().perfil ? { ok: true } : { ok: false }
  },

  // ─── Reset de contraseña (email) ───────────────────────────────────────────
  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { ok: !error, error: error?.message }
  },

  // ─── Logout ────────────────────────────────────────────────────────────────
  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, perfil: null, error: null })
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
