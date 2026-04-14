// src/modules/auth/LoginPage.jsx
// Login estilo Listo POS Lite: grid de avatares → modal PIN
// El PIN (6 dígitos) es la contraseña de Supabase Auth del usuario
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../../components/auth/LoginAvatar'
import LoginPinModal from '../../components/auth/LoginPinModal'

// ─── Tarjeta de usuario ────────────────────────────────────────────────────────
function UserCard({ user, onClick }) {
  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .split(' ').slice(0, 2).join(' ') // máximo 2 palabras en la tarjeta

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

// ─── Vista principal ───────────────────────────────────────────────────────────
export default function LoginPage() {
  const [usuarios,   setUsuarios]   = useState([])
  const [cargando,   setCargando]   = useState(true)
  const [errorLista, setErrorLista] = useState(null)
  const [seleccionado, setSeleccionado] = useState(null) // usuario para PIN

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

  // Llamado desde LoginPinModal: retorna true si el PIN es correcto
  async function handlePin(pin) {
    if (!seleccionado) return false
    const { ok } = await login(seleccionado.email, pin)
    if (ok) navigate('/', { replace: true })
    return ok
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfdf5 100%)' }}>

      {/* Logo */}
      <div className="mb-8">
        <img src="/logo.png" alt="Listo POS Cotizaciones"
          className="h-28 w-auto object-contain select-none" draggable={false} />
      </div>

      {/* Card principal */}
      <div className="w-full max-w-2xl bg-white/50 backdrop-blur-sm rounded-[2rem] shadow-xl border border-white/80 p-8 relative overflow-hidden">

        {/* Destellos decorativos */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(125,211,252,0.2)' }} />
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(94,234,212,0.15)' }} />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-black text-slate-800">¿Quién eres?</h1>
              <p className="text-sm text-slate-400">Selecciona tu usuario para continuar</p>
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
              <p className="text-slate-400 text-xs mt-1">Contacta al administrador de Supabase.</p>
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
