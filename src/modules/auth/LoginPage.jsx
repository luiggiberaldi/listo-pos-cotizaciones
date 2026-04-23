// src/modules/auth/LoginPage.jsx
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Mail, Key, Eye, EyeOff, ArrowRight, Download } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import { apiUrl } from '../../services/apiBase'
import LoginAvatar from '../../components/auth/LoginAvatar'
import LoginPinModal from '../../components/auth/LoginPinModal'
import { CardContainer, CardBody, CardItem } from '../../components/ui/3d-card'

// ─── Fondo animado con orbes ─────────────────────────────────────────────────
function DarkBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      <div className="absolute -top-[20%] -left-[10%] w-[700px] h-[700px] rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute top-[30%] left-[50%] -translate-x-1/2 w-[400px] h-[400px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="absolute top-0 left-[35%] w-px h-full opacity-10"
        style={{ background: 'linear-gradient(to bottom, transparent 0%, #B8860B 30%, #1B365D 70%, transparent 100%)' }} />
      <div className="absolute top-0 left-[65%] w-px h-full opacity-5"
        style={{ background: 'linear-gradient(to bottom, transparent 0%, #3b82f6 50%, transparent 100%)' }} />
    </div>
  )
}

// ─── Colores de acento por rol ────────────────────────────────────────────────
const ROL_ACCENT = {
  supervisor: { color: '#3b82f6', glow: 'rgba(59,130,246,0.35)', chip: 'rgba(59,130,246,0.15)', chipBorder: 'rgba(59,130,246,0.3)', label: 'Supervisor' },
  vendedor:   { color: '#14b8a6', glow: 'rgba(20,184,166,0.3)',  chip: 'rgba(20,184,166,0.12)', chipBorder: 'rgba(20,184,166,0.25)', label: 'Vendedor'   },
}

// ─── Tarjeta de usuario (Dark Premium) ───────────────────────────────────────
function UserCard({ user, onClick, index }) {
  const [hovered, setHovered] = React.useState(false)

  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .split(' ').slice(0, 2).join(' ')

  const rol = user.rol || 'vendedor'
  const acc = ROL_ACCENT[rol] ?? ROL_ACCENT.vendedor

  return (
    <div
      onClick={() => onClick(user)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="cursor-pointer outline-none"
      style={{ animation: `fadeSlideUp 0.5s ease forwards`, animationDelay: `${index * 0.1}s`, opacity: 0 }}
    >
      <CardContainer className="inter-var py-0">
        <CardBody className="relative group/card w-auto h-auto p-0 border-transparent bg-transparent">
          <CardItem translateZ="80" className="w-full">
            <div
              className="relative flex flex-col items-center gap-4 px-5 pt-7 pb-5 rounded-2xl transition-all duration-300"
              style={{
                background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${hovered ? acc.color + '60' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: hovered
                  ? `0 0 0 1px ${acc.color}30, 0 20px 60px rgba(0,0,0,0.4), 0 0 30px ${acc.glow}`
                  : '0 8px 32px rgba(0,0,0,0.3)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div
                className="absolute top-0 left-[15%] right-[15%] h-px rounded-full transition-opacity duration-300"
                style={{
                  background: `linear-gradient(to right, transparent, ${acc.color}, transparent)`,
                  opacity: hovered ? 0.8 : 0.2,
                }}
              />
              <div className="relative">
                <div
                  className="absolute inset-0 rounded-2xl blur-xl transition-opacity duration-300"
                  style={{ background: acc.glow, opacity: hovered ? 1 : 0.4, transform: 'scale(1.3)' }}
                />
                <LoginAvatar user={user} className="relative z-10" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-base font-black text-white leading-tight tracking-tight"
                  style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                  {nombre}
                </p>
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all duration-300"
                  style={{
                    background: acc.chip,
                    border: `1px solid ${acc.chipBorder}`,
                    color: acc.color,
                  }}
                >
                  {acc.label}
                </span>
              </div>
            </div>
          </CardItem>
        </CardBody>
      </CardContainer>
    </div>
  )
}

const USUARIOS_CACHE_KEY = 'construacero_usuarios_cache'

// ─── Botón de instalación PWA ─────────────────────────────────────────────────
function PwaInstallButton() {
  const [prompt, setPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (installed || !prompt) return null

  async function handleInstall() {
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setPrompt(null)
  }

  return (
    <button
      onClick={handleInstall}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95"
      style={{
        background: 'rgba(184,134,11,0.15)',
        border: '1px solid rgba(184,134,11,0.4)',
        color: '#B8860B',
        backdropFilter: 'blur(8px)',
      }}
    >
      <Download size={15} />
      Instalar App
    </button>
  )
}

// ─── Paso 1: Login del negocio (email + contraseña) ─────────────────────────
function GateStep({ onPass }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { login } = useAuthStore()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true)
    setError(null)
    const { ok } = await login(email, password)
    setLoading(false)
    if (ok) {
      onPass()
    } else {
      // Leer error del store
      const storeError = useAuthStore.getState().error
      setError(storeError || 'Email o contraseña incorrectos')
      useAuthStore.getState().limpiarError()
    }
  }

  return (
    <>
      <DarkBackground />
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center justify-center px-4 sm:px-6 py-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 mb-8 select-none" style={{ animation: 'logoReveal 0.8s ease forwards' }}>
          <div className="relative flex items-center justify-center">
            <div className="absolute rounded-full opacity-25 blur-3xl"
              style={{ width: '200px', height: '200px', background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)' }} />
            <img src="/logo.png" alt="Construacero Carabobo"
              className="relative z-10 w-auto object-contain select-none pointer-events-none drop-shadow-2xl"
              style={{ height: '140px', filter: 'drop-shadow(0 0 40px rgba(184,134,11,0.35)) brightness(1.05)' }}
              draggable={false} />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-px w-12 opacity-40" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: '#B8860B' }}>Acceso al Sistema</span>
            <div className="h-px w-12 opacity-40" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
          </div>
        </div>

        {/* Formulario login negocio */}
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl p-6 sm:p-8"
          style={{
            background: 'rgba(255,255,255,0.04)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 25px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
            animation: 'fadeSlideUp 0.6s ease 0.2s forwards',
            opacity: 0,
          }}
        >
          <div className="absolute top-0 left-[10%] right-[10%] h-px"
            style={{ background: 'linear-gradient(to right, transparent, rgba(184,134,11,0.6), transparent)' }} />

          <h2 className="text-lg font-black text-white mb-1">Verificación de acceso</h2>
          <p className="text-xs mb-6" style={{ color: 'rgba(255,255,255,0.4)' }}>Ingresa las credenciales del negocio</p>

          {/* Email */}
          <div className="mb-4">
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Correo</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => e.target.style.borderColor = 'rgba(184,134,11,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                placeholder="correo@empresa.com"
                autoComplete="email"
                required
              />
            </div>
          </div>

          {/* Password */}
          <div className="mb-5">
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Contraseña</label>
            <div className="relative">
              <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => e.target.style.borderColor = 'rgba(184,134,11,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                placeholder="••••••••"
                required
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 mb-4 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #B8860B 0%, #8B6914 100%)',
              boxShadow: '0 4px 20px rgba(184,134,11,0.3)',
            }}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {loading ? 'Verificando...' : 'Acceder'}
          </button>
        </form>

        <div className="mt-6" style={{ animation: 'fadeSlideUp 0.6s ease 0.5s forwards', opacity: 0 }}>
          <PwaInstallButton />
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }
      `}</style>
    </>
  )
}

// ─── Paso 2: Seleccionar operador ────────────────────────────────────────────
function UserSelectStep() {
  const cached = (() => { try { return JSON.parse(localStorage.getItem(USUARIOS_CACHE_KEY) || '[]') } catch { return [] } })()
  const [usuarios,     setUsuarios]     = useState(cached)
  const [cargando,     setCargando]     = useState(cached.length === 0)
  const [errorLista,   setErrorLista]   = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [visible,      setVisible]      = useState(false)

  // ── Super Admin Easter Egg ──
  const [logoTaps, setLogoTaps]         = useState(0)
  const [showSuperPin, setShowSuperPin] = useState(false)
  const [superPin, setSuperPin]         = useState('')
  const [superError, setSuperError]     = useState('')
  const logoTapTimer = React.useRef(null)

  const { switchOperator } = useAuthStore()
  const navigate = useNavigate()

  function handleLogoTap() {
    const next = logoTaps + 1
    setLogoTaps(next)
    clearTimeout(logoTapTimer.current)
    if (next >= 10) {
      setLogoTaps(0)
      setShowSuperPin(true)
      setSuperPin('')
      setSuperError('')
    } else {
      logoTapTimer.current = setTimeout(() => setLogoTaps(0), 3000)
    }
  }

  async function handleSuperPinSubmit(e) {
    e.preventDefault()
    setSuperError('')
    try {
      // Llamar al backend para setear app_metadata de super admin en el JWT
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) { setSuperError('No hay sesión activa'); return }

      const res = await fetch(apiUrl('/api/auth/super-admin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: superPin }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSuperError(result.error || 'Código incorrecto')
        setSuperPin('')
        return
      }

      // Refrescar sesión para obtener JWT con los nuevos app_metadata
      await supabase.auth.refreshSession()

      // Setear perfil sintético de super admin (no existe en tabla usuarios)
      const store = useAuthStore.getState()
      useAuthStore.setState({
        perfil: {
          id: '00000000-0000-0000-0000-000000000000',
          nombre: 'Super Admin',
          email: store.user?.email || 'admin@system',
          rol: 'supervisor',
          activo: true,
          color: '#ef4444',
          _isSuperAdmin: true,
        },
        error: null,
      })
      setShowSuperPin(false)
      navigate('/', { replace: true })
    } catch (err) {
      setSuperError('Error de conexión')
      setSuperPin('')
    }
  }

  async function cargarUsuarios(silencioso = false) {
    if (!silencioso) setCargando(usuarios.length === 0)
    setErrorLista(null)
    const { data, error } = await supabase.rpc('listar_usuarios_login')
    if (error) {
      if (usuarios.length === 0) setErrorLista('No se pudo cargar la lista de usuarios')
    } else {
      const lista = data ?? []
      setUsuarios(lista)
      localStorage.setItem(USUARIOS_CACHE_KEY, JSON.stringify(lista))
    }
    setCargando(false)
  }

  useEffect(() => {
    cargarUsuarios(cached.length > 0)
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  async function handlePin(pin) {
    if (!seleccionado) return false
    const { ok } = await switchOperator(seleccionado.id, pin)
    if (ok) navigate('/', { replace: true })
    return ok
  }

  return (
    <>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }
      `}</style>

      <DarkBackground />

      <div className="relative z-10 min-h-screen w-full flex flex-col lg:flex-row items-center justify-center px-4 sm:px-6 lg:px-12 py-8 gap-8 lg:gap-16">

        {/* ── LOGO + BRANDING ── */}
        <div
          className="flex flex-col items-center lg:items-start gap-4 select-none lg:w-[340px] xl:w-[400px] shrink-0"
          style={{ animation: 'logoReveal 0.8s ease forwards' }}
        >
          <div className="relative flex items-center justify-center lg:justify-start">
            <div className="absolute rounded-full opacity-25 blur-3xl"
              style={{ width: 'clamp(160px, 30vw, 280px)', height: 'clamp(160px, 30vw, 280px)', background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)' }} />
            <img
              src="/logo.png"
              alt="Construacero Carabobo"
              onClick={handleLogoTap}
              className="relative z-10 w-auto object-contain select-none drop-shadow-2xl cursor-pointer"
              style={{
                height: 'clamp(160px, 22vw, 300px)',
                filter: 'drop-shadow(0 0 40px rgba(184,134,11,0.35)) brightness(1.05)',
              }}
              draggable={false}
            />
          </div>

          <div className="flex items-center justify-center lg:justify-start gap-3 w-full">
            <div className="h-px flex-1 max-w-[48px] opacity-40" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-[0.3em] uppercase whitespace-nowrap" style={{ color: '#B8860B' }}>
              Sistema de Gestión
            </span>
            <div className="h-px flex-1 max-w-[48px] opacity-40" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
          </div>

          <p className="hidden lg:block text-sm leading-relaxed max-w-[280px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Gestión de cotizaciones, inventario y clientes para Construacero Carabobo C.A.
          </p>
        </div>

        {/* ── PANEL PRINCIPAL ── */}
        <div
          className="w-full max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg xl:max-w-xl relative overflow-hidden rounded-2xl sm:rounded-3xl"
          style={{
            background: 'rgba(255,255,255,0.04)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 25px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
            animation: 'fadeSlideUp 0.6s ease 0.2s forwards',
            opacity: 0,
          }}
        >
          <div className="absolute top-0 left-[10%] right-[10%] h-px"
            style={{ background: 'linear-gradient(to right, transparent, rgba(184,134,11,0.6), transparent)' }} />
          <div className="absolute top-0 right-0 w-64 h-64 -mr-20 -mt-20 rounded-full opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(30px)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 -ml-16 -mb-16 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(30px)', opacity: 0.06 }} />

          <div className="relative z-10 p-5 sm:p-7 lg:p-8">

            {/* Header */}
            <div className="flex items-center justify-between mb-6 sm:mb-8">
              <div>
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  ¿Quién está operando?
                </h1>
                <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Selecciona tu usuario e ingresa tu PIN
                </p>
              </div>
              <button
                onClick={cargarUsuarios.bind(null, false)}
                disabled={cargando}
                className="p-2 sm:p-2.5 rounded-xl transition-all disabled:opacity-40 shrink-0"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              >
                <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Grid usuarios */}
            {cargando ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-3 py-5 sm:py-6 animate-pulse">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="space-y-2 w-full px-2">
                      <div className="h-2.5 rounded w-3/4 mx-auto" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-2 rounded w-1/2 mx-auto" style={{ background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : errorLista ? (
              <div className="text-center py-10">
                <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>{errorLista}</p>
                <button onClick={cargarUsuarios} className="text-sm font-bold text-sky-400 hover:text-sky-300 transition-colors">
                  Reintentar
                </button>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No hay usuarios activos en el sistema.</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Contacta al supervisor.</p>
              </div>
            ) : (
              <div className={`grid gap-6 sm:gap-8 ${
                usuarios.length === 1 ? 'grid-cols-1 max-w-[180px] mx-auto' :
                usuarios.length === 2 ? 'grid-cols-2' :
                'grid-cols-2 sm:grid-cols-3'
              }`}>
                {[...usuarios].sort((a, b) => {
                  const orden = { supervisor: 0, vendedor: 1 }
                  return (orden[a.rol] ?? 2) - (orden[b.rol] ?? 2)
                }).map((u, i) => (
                  <UserCard key={u.id} user={u} onClick={setSeleccionado} index={i} />
                ))}
              </div>
            )}

          </div>
        </div>

      </div>

      {/* Footer — bottom fijo, solo desktop */}
      <div className="hidden md:flex fixed bottom-4 left-0 right-0 justify-center items-center gap-4 pointer-events-none z-20"
        style={{ animation: 'fadeIn 1s ease 0.8s forwards', opacity: 0 }}>
        <div className="pointer-events-auto">
          <PwaInstallButton />
        </div>
      </div>

      {/* Botón instalar PWA en móvil */}
      <div className="md:hidden fixed bottom-4 left-0 right-0 flex justify-center z-20 pointer-events-none"
        style={{ animation: 'fadeIn 1s ease 0.8s forwards', opacity: 0 }}>
        <div className="pointer-events-auto">
          <PwaInstallButton />
        </div>
      </div>

      {/* Modal Super Admin secreto */}
      {showSuperPin && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" onClick={() => setShowSuperPin(false)} />
          <div className="fixed inset-0 z-[201] flex items-center justify-center px-4">
            <form
              onSubmit={handleSuperPinSubmit}
              className="w-full max-w-xs rounded-2xl p-6 relative"
              style={{
                background: 'rgba(15,10,25,0.95)',
                border: '1px solid rgba(239,68,68,0.3)',
                boxShadow: '0 25px 80px rgba(0,0,0,0.7), 0 0 40px rgba(239,68,68,0.15)',
                backdropFilter: 'blur(20px)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-0 left-[10%] right-[10%] h-px"
                style={{ background: 'linear-gradient(to right, transparent, rgba(239,68,68,0.6), transparent)' }} />
              <div className="text-center mb-5">
                <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                  style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <h3 className="text-sm font-black text-white">Acceso Super Admin</h3>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>Ingresa el código de acceso</p>
              </div>
              <input
                type="password"
                value={superPin}
                onChange={e => { setSuperPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setSuperError('') }}
                className="w-full text-center text-lg font-mono font-bold tracking-[0.5em] py-3 rounded-xl outline-none text-white"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${superError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  caretColor: '#ef4444',
                }}
                placeholder="••••••"
                autoFocus
                inputMode="numeric"
                maxLength={6}
              />
              {superError && <p className="text-xs text-red-400 text-center mt-2">{superError}</p>}
              <button
                type="submit"
                disabled={superPin.length < 6}
                className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-30"
                style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}
              >
                Acceder
              </button>
              <button
                type="button"
                onClick={() => setShowSuperPin(false)}
                className="w-full mt-2 py-2 text-xs font-medium transition-all"
                style={{ color: 'rgba(255,255,255,0.3)' }}
              >
                Cancelar
              </button>
            </form>
          </div>
        </>
      )}

      {/* Modal PIN */}
      <LoginPinModal
        isOpen={!!seleccionado}
        user={seleccionado}
        onClose={() => setSeleccionado(null)}
        onSubmit={handlePin}
      />
    </>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
// La sesión de Supabase persiste en localStorage. Si el usuario ya inició sesión
// con email/contraseña, no necesita volver a hacerlo — va directo a selección de operador.
export default function LoginPage() {
  const { user, initialized } = useAuthStore()
  const [gatePassed, setGatePassed] = useState(false)

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  // Si el store detecta sesión persistente, saltar el gate automáticamente
  useEffect(() => {
    if (user) setGatePassed(true)
  }, [user])

  // Mientras se verifica la sesión guardada, mostrar splash de carga
  if (!initialized) {
    return (
      <>
        <DarkBackground />
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center">
          <div className="relative flex items-center justify-center" style={{ animation: 'logoReveal 0.8s ease forwards' }}>
            <div className="absolute rounded-full opacity-25 blur-3xl"
              style={{ width: '200px', height: '200px', background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)' }} />
            <img src="/logo.png" alt="Construacero Carabobo"
              className="relative z-10 w-auto object-contain select-none pointer-events-none drop-shadow-2xl"
              style={{ height: '140px', filter: 'drop-shadow(0 0 40px rgba(184,134,11,0.35)) brightness(1.05)' }}
              draggable={false} />
          </div>
          <RefreshCw size={20} className="animate-spin mt-8" style={{ color: 'rgba(255,255,255,0.3)' }} />
        </div>
        <style>{`
          @keyframes logoReveal {
            from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); }
            to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
          }
        `}</style>
      </>
    )
  }

  // Si no hay sesión de negocio → pedir email/contraseña (solo la primera vez)
  if (!gatePassed && !user) {
    return <GateStep onPass={() => setGatePassed(true)} />
  }

  // Sesión activa → selección de operador + PIN
  return <UserSelectStep />
}
