// src/modules/auth/LoginPage.jsx
// Pantalla de inicio de sesión
// Diseño limpio, accesible para personas mayores: tipografía grande, alto contraste
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarClave, setMostrarClave] = useState(false)

  const { login, loading, error, limpiarError } = useAuthStore()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    limpiarError()

    if (!email.trim()) return
    if (!password) return

    const { ok } = await login(email, password)
    if (ok) navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo y título */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-500 rounded-2xl mb-5 shadow-md">
            <span className="text-white text-3xl font-black">LP</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-800">
            Listo POS Cotizaciones
          </h1>
          <p className="text-slate-500 mt-2 text-lg">
            Inicia sesión para continuar
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-6">

            {/* Campo Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-slate-700 font-semibold text-lg mb-2"
              >
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                className="
                  w-full px-4 py-3 rounded-xl border-2 border-slate-200
                  text-lg text-slate-800
                  focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100
                  transition-colors
                "
                disabled={loading}
              />
            </div>

            {/* Campo Contraseña */}
            <div>
              <label
                htmlFor="password"
                className="block text-slate-700 font-semibold text-lg mb-2"
              >
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={mostrarClave ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="
                    w-full px-4 py-3 pr-14 rounded-xl border-2 border-slate-200
                    text-lg text-slate-800
                    focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100
                    transition-colors
                  "
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setMostrarClave(!mostrarClave)}
                  aria-label={mostrarClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="
                    absolute right-3 top-1/2 -translate-y-1/2
                    p-2 text-slate-400 hover:text-slate-600 rounded-lg
                    transition-colors
                  "
                >
                  {mostrarClave ? <EyeOff size={22} /> : <Eye size={22} />}
                </button>
              </div>
            </div>

            {/* Mensaje de error */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700"
              >
                <AlertCircle size={22} className="shrink-0 mt-0.5" />
                <p className="text-base font-medium">{error}</p>
              </div>
            )}

            {/* Botón Entrar */}
            <button
              type="submit"
              disabled={loading || !email.trim() || !password}
              className="
                w-full flex items-center justify-center gap-3
                bg-amber-500 hover:bg-amber-600 active:bg-amber-700
                disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed
                text-white font-bold text-xl
                py-4 rounded-xl
                transition-colors shadow-sm
                focus:outline-none focus:ring-4 focus:ring-amber-200
              "
            >
              {loading ? (
                <>
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LogIn size={22} />
                  Entrar
                </>
              )}
            </button>

          </form>
        </div>

        {/* Nota de acceso */}
        <p className="text-center text-slate-400 text-sm mt-6">
          ¿No tienes acceso? Contacta al supervisor del sistema.
        </p>

      </div>
    </div>
  )
}
