// src/modules/auth/LoginPage.jsx
// Login en dos pasos:
// Paso 1: Correo + contraseña compartidos del negocio (gate)
// Paso 2: Grid de avatares → PIN individual (auth de Supabase)
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Mail, Key, Eye, EyeOff, ArrowRight, Loader2, ArrowLeft } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../../components/auth/LoginAvatar'
import LoginPinModal from '../../components/auth/LoginPinModal'
import { validarGate } from '../../hooks/useConfigNegocio'

const GATE_SESSION_KEY = 'listo_gate_ok'

// ─── Tarjeta de usuario ────────────────────────────────────────────────────────
function UserCard({ user, onClick }) {
  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .split(' ').slice(0, 2).join(' ')

  return (
    <button
      onClick={() => onClick(user)}
      className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-white/60 hover:bg-white border border-white/80 hover:border-sky-200 hover:shadow-lg hover:shadow-sky-500/10 transition-all active:scale-95 group"
    >
      <LoginAvatar user={user} className="group-hover:scale-105 transition-transform" />
      <div className="text-center">
        <p className="text-sm font-black text-slate-800 leading-tight">{nombre}</p>
        <p className={`text-[11px] font-bold mt-0.5 ${
          user.rol === 'supervisor' ? 'text-sky-500' : 'text-teal-500'
        }`}>
          {user.rol === 'supervisor' ? 'Supervisor' : 'Vendedor'}
        </p>
      </div>
    </button>
  )
}

// ─── Paso 1: Gate (correo + contraseña del negocio) ───────────────────────────
function GateStep({ onSuccess }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]       = useState('')
  const [cargando, setCargando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!email.trim()) { setError('Ingresa el correo del negocio'); return }
    if (!password)      { setError('Ingresa la contraseña'); return }

    setCargando(true)
    try {
      const result = await validarGate(email, password)
      if (result.ok) {
        sessionStorage.setItem(GATE_SESSION_KEY, '1')
        onSuccess()
      } else {
        setError(result.error || 'Credenciales incorrectas')
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfdf5 100%)' }}>

      {/* Logo */}
      <div className="mb-8 select-none">
        <img src="/logo.png" alt="Construacero Carabobo"
          className="h-44 sm:h-52 w-auto object-contain select-none pointer-events-none" draggable={false} />
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden relative">

        {/* Destellos decorativos */}
        <div className="absolute top-0 right-0 -mr-12 -mt-12 w-40 h-40 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(27,54,93,0.1)' }} />
        <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-40 h-40 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(184,134,11,0.08)' }} />

        <div className="p-6 relative z-10">
          <div className="text-center mb-6">
            <h1 className="text-lg font-black text-slate-800">Acceso al sistema</h1>
            <p className="text-sm text-slate-400 mt-1">Ingresa las credenciales del negocio</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Email */}
            <div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail size={16} className="text-slate-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                  placeholder="Correo del negocio"
                  autoComplete="email"
                  disabled={cargando}
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Key size={16} className="text-slate-400" />
                </div>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                  placeholder="Contraseña"
                  autoComplete="current-password"
                  disabled={cargando}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-[11px] text-red-500 font-bold ml-1">{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={cargando}
              className="w-full py-3.5 text-white text-sm font-black rounded-xl transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
              style={{ background: 'linear-gradient(135deg, #1B365D 0%, #B8860B 100%)' }}
            >
              {cargando
                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <>Entrar <ArrowRight size={16} strokeWidth={3} /></>
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Paso 2: Seleccionar usuario + PIN ────────────────────────────────────────
function UserSelectStep({ onBack }) {
  const [usuarios,     setUsuarios]     = useState([])
  const [cargando,     setCargando]     = useState(true)
  const [errorLista,   setErrorLista]   = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)

  const { login } = useAuthStore()
  const navigate  = useNavigate()

  async function cargarUsuarios() {
    setCargando(true)
    setErrorLista(null)
    const { data, error } = await supabase.rpc('listar_usuarios_login')
    if (error) {
      setErrorLista('No se pudo cargar la lista de usuarios')
    } else {
      setUsuarios(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => { cargarUsuarios() }, [])

  async function handlePin(pin) {
    if (!seleccionado) return false
    const { ok } = await login(seleccionado.email, pin)
    if (ok) navigate('/', { replace: true })
    return ok
  }

  function handleBack() {
    sessionStorage.removeItem(GATE_SESSION_KEY)
    onBack()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfdf5 100%)' }}>

      {/* Logo */}
      <div className="mb-8 select-none">
        <img src="/logo.png" alt="Construacero Carabobo"
          className="h-44 w-auto object-contain select-none pointer-events-none" draggable={false} />
      </div>

      {/* Card principal */}
      <div className="w-full max-w-2xl bg-white/50 backdrop-blur-sm rounded-[2rem] shadow-xl border border-white/80 p-8 relative overflow-hidden">

        {/* Destellos decorativos */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(27,54,93,0.1)' }} />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(184,134,11,0.08)' }} />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-lg font-black text-slate-800">¿Quién eres?</h1>
                <p className="text-sm text-slate-400">Selecciona tu usuario para continuar</p>
              </div>
            </div>
            <button onClick={cargarUsuarios} disabled={cargando}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors disabled:opacity-50">
              <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Estados */}
          {cargando ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-white/60 border border-white/80 animate-pulse">
                  <div className="w-20 h-20 rounded-[1.25rem] bg-slate-200" />
                  <div className="space-y-1.5 w-full">
                    <div className="h-3 bg-slate-200 rounded w-3/4 mx-auto" />
                    <div className="h-2.5 bg-slate-100 rounded w-1/2 mx-auto" />
                  </div>
                </div>
              ))}
            </div>
          ) : errorLista ? (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm mb-3">{errorLista}</p>
              <button onClick={cargarUsuarios}
                className="text-sky-600 text-sm font-bold hover:underline">
                Reintentar
              </button>
            </div>
          ) : usuarios.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm">No hay usuarios activos en el sistema.</p>
              <p className="text-slate-400 text-xs mt-1">Contacta al supervisor.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {usuarios.map(u => (
                <UserCard key={u.id} user={u} onClick={setSeleccionado} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal PIN */}
      <LoginPinModal
        isOpen={!!seleccionado}
        user={seleccionado}
        onClose={() => setSeleccionado(null)}
        onSubmit={handlePin}
      />
    </div>
  )
}

// ─── Vista principal ────────────────────────────────────────────────────────────
// DEMO MODE: se salta el gate (correo/contraseña) y va directo a selección de usuario
export default function LoginPage() {
  return <UserSelectStep onBack={() => {}} />
}
