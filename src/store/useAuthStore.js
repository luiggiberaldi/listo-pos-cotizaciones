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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // INITIAL_SESSION = primera verificación al registrar el listener
        if (event === 'INITIAL_SESSION') {
          if (session?.user) {
            await get()._cargarPerfil(session.user)
          }
          set({ initialized: true })
        }

        // SIGNED_IN = login exitoso (incluye token refresh inicial en algunos casos)
        if (event === 'SIGNED_IN' && session?.user) {
          // Solo recargar si el perfil no está cargado aún
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

    // Devolver la función de cleanup (para componentes que quieran limpiar)
    return () => subscription.unsubscribe()
  },

  // ─── Cargar perfil desde public.usuarios ──────────────────────────────────
  // Uso interno. Separado para poder llamarlo desde initialize y desde login.
  _cargarPerfil: async (authUser) => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, rol, activo')
      .eq('id', authUser.id)
      .single()

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
    await get()._cargarPerfil(data.user)
    set({ loading: false })
    return { ok: true }
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
