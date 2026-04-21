// src/modules/auth/LoginPage.jsx
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Mail, Key, Eye, EyeOff, ArrowRight, Download } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../../components/auth/LoginAvatar'
import LoginPinModal from '../../components/auth/LoginPinModal'
import { validarGate, tieneGateConfigurado } from '../../hooks/useConfigNegocio'
import { CardContainer, CardBody, CardItem } from '../../components/ui/3d-card'

const GATE_SESSION_KEY = 'construacero_gate_ok'

// ─── Fondo animado con orbes ─────────────────────────────────────────────────
function DarkBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      {/* Orbe azul marino grande */}
      <div className="absolute -top-[20%] -left-[10%] w-[700px] h-[700px] rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(80px)' }} />
      {/* Orbe dorado */}
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(80px)' }} />
      {/* Orbe centro sutil */}
      <div className="absolute top-[30%] left-[50%] -translate-x-1/2 w-[400px] h-[400px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />

      {/* Malla de puntos decorativa */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Línea decorativa diagonal */}
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
            {/* Recuadro glassmorphism */}
            <div
              className="relative flex flex-col items-center gap-4 px-5 pt-7 pb-5 rounded-2xl transition-all duration-300"
              style={{
                background: hovered
                  ? 'rgba(255,255,255,0.07)'
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${hovered ? acc.color + '60' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: hovered
                  ? `0 0 0 1px ${acc.color}30, 0 20px 60px rgba(0,0,0,0.4), 0 0 30px ${acc.glow}`
                  : '0 8px 32px rgba(0,0,0,0.3)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {/* Línea top de acento */}
              <div
                className="absolute top-0 left-[15%] right-[15%] h-px rounded-full transition-opacity duration-300"
                style={{
                  background: `linear-gradient(to right, transparent, ${acc.color}, transparent)`,
                  opacity: hovered ? 0.8 : 0.2,
                }}
              />

              {/* Avatar */}
              <div className="relative">
                {/* Halo de glow detrás */}
                <div
                  className="absolute inset-0 rounded-2xl blur-xl transition-opacity duration-300"
                  style={{ background: acc.glow, opacity: hovered ? 1 : 0.4, transform: 'scale(1.3)' }}
                />
                <LoginAvatar user={user} className="relative z-10" />
              </div>

              {/* Nombre */}
              <div className="text-center space-y-2">
                <p className="text-base font-black text-white leading-tight tracking-tight"
                  style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                  {nombre}
                </p>
                {/* Chip de rol */}
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

// ─── Paso 1: Gate de acceso ──────────────────────────────────────────────────
function GateStep({ onPass }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true)
    setError(null)
    const result = await validarGate(email, password)
    setLoading(false)
    if (result.ok) {
      sessionStorage.setItem(GATE_SESSION_KEY, '1')
      onPass()
    } else {
      setError(result.error || 'Acceso denegado')
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

        {/* Formulario gate */}
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

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 mb-4 text-center">{error}</p>
          )}

          {/* Submit */}
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

// ─── Paso 2: Seleccionar usuario ──────────────────────────────────────────────
function UserSelectStep() {
  const cached = (() => { try { return JSON.parse(localStorage.getItem(USUARIOS_CACHE_KEY) || '[]') } catch { return [] } })()
  const [usuarios,     setUsuarios]     = useState(cached)
  const [cargando,     setCargando]     = useState(cached.length === 0)
  const [errorLista,   setErrorLista]   = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [visible,      setVisible]      = useState(false)
  const [modoEmail,    setModoEmail]    = useState(false)
  const [emailLogin,   setEmailLogin]   = useState('')
  const [passLogin,    setPassLogin]    = useState('')
  const [showPassLogin, setShowPassLogin] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError,   setLoginError]   = useState(null)

  // ── Easter egg: 10 taps en el logo → acceso dev ──
  const [tapCount, setTapCount]       = useState(0)
  const [showDevPin, setShowDevPin]   = useState(false)
  const [devPin, setDevPin]           = useState('')
  const [devError, setDevError]       = useState(null)
  const [devLoading, setDevLoading]   = useState(false)
  const tapTimer = useRef(null)

  function handleLogoTap() {
    const next = tapCount + 1
    setTapCount(next)
    clearTimeout(tapTimer.current)
    if (next >= 10) {
      setShowDevPin(true)
      setTapCount(0)
    } else {
      tapTimer.current = setTimeout(() => setTapCount(0), 3000)
    }
  }

  async function handleDevPinSubmit() {
    if (devPin !== '794848') {
      setDevError('Código incorrecto')
      setDevPin('')
      return
    }
    setDevLoading(true)
    setDevError(null)
    const { ok } = await login('dev@construacero.sys', '794848')
    setDevLoading(false)
    if (ok) {
      navigate('/', { replace: true })
    } else {
      setDevError('Error de autenticación')
    }
  }

  const { login } = useAuthStore()
  const navigate  = useNavigate()

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
    cargarUsuarios(cached.length > 0) // silencioso si hay caché
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  async function handlePin(pin) {
    if (!seleccionado) return false
    const { ok } = await login(seleccionado.email, pin)
    if (ok) navigate('/', { replace: true })
    return ok
  }

  async function handleEmailLogin(e) {
    e.preventDefault()
    if (!emailLogin.trim() || !passLogin) return
    setLoginLoading(true)
    setLoginError(null)
    const { ok, error } = await login(emailLogin.trim(), passLogin)
    setLoginLoading(false)
    if (ok) {
      navigate('/', { replace: true })
    } else {
      setLoginError(error || 'Correo o contraseña incorrectos')
    }
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

      {/* Layout responsivo: columna en móvil, fila en desktop grande */}
      <div className="relative z-10 min-h-screen w-full flex flex-col lg:flex-row items-center justify-center px-4 sm:px-6 lg:px-12 py-8 gap-8 lg:gap-16">

        {/* ── LOGO + BRANDING ── */}
        <div
          className="flex flex-col items-center lg:items-start gap-4 select-none lg:w-[340px] xl:w-[400px] shrink-0"
          style={{ animation: 'logoReveal 0.8s ease forwards' }}
        >
          {/* Halo dorado */}
          <div className="relative flex items-center justify-center lg:justify-start">
            <div className="absolute rounded-full opacity-25 blur-3xl"
              style={{ width: 'clamp(160px, 30vw, 280px)', height: 'clamp(160px, 30vw, 280px)', background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)' }} />
            <img
              src="/logo.png"
              alt="Construacero Carabobo"
              onClick={handleLogoTap}
              className="relative z-10 w-auto object-contain select-none drop-shadow-2xl cursor-default"
              style={{
                height: 'clamp(160px, 22vw, 300px)',
                filter: 'drop-shadow(0 0 40px rgba(184,134,11,0.35)) brightness(1.05)',
              }}
              draggable={false}
            />
          </div>

          {/* Separador + texto — visible siempre */}
          <div className="flex items-center justify-center lg:justify-start gap-3 w-full">
            <div className="h-px flex-1 max-w-[48px] opacity-40" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-[0.3em] uppercase whitespace-nowrap" style={{ color: '#B8860B' }}>
              Sistema de Gestión
            </span>
            <div className="h-px flex-1 max-w-[48px] opacity-40" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
          </div>

          {/* Tagline — solo en desktop */}
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
          {/* Línea top dorada */}
          <div className="absolute top-0 left-[10%] right-[10%] h-px"
            style={{ background: 'linear-gradient(to right, transparent, rgba(184,134,11,0.6), transparent)' }} />

          {/* Destellos internos */}
          <div className="absolute top-0 right-0 w-64 h-64 -mr-20 -mt-20 rounded-full opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(30px)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 -ml-16 -mb-16 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(30px)', opacity: 0.06 }} />

          <div className="relative z-10 p-5 sm:p-7 lg:p-8">

            {/* Header */}
            <div className="flex items-center justify-between mb-6 sm:mb-8">
              <div>
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  {modoEmail ? 'Iniciar sesión' : '¿Quién está operando?'}
                </h1>
                <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {modoEmail ? 'Ingresa tu correo y contraseña' : 'Selecciona tu usuario e ingresa tu PIN'}
                </p>
              </div>
              {!modoEmail && (
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
              )}
            </div>

            {/* ── Modo email: formulario directo ── */}
            {modoEmail ? (
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Correo</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                    <input
                      type="email"
                      value={emailLogin}
                      onChange={e => setEmailLogin(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-colors"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                      onFocus={e => e.target.style.borderColor = 'rgba(184,134,11,0.5)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                      placeholder="tu@correo.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Contraseña</label>
                  <div className="relative">
                    <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                    <input
                      type={showPassLogin ? 'text' : 'password'}
                      value={passLogin}
                      onChange={e => setPassLogin(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-colors"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                      onFocus={e => e.target.style.borderColor = 'rgba(184,134,11,0.5)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                      placeholder="••••••••"
                      required
                    />
                    <button type="button" onClick={() => setShowPassLogin(!showPassLogin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {showPassLogin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <p className="text-xs text-red-400 text-center">{loginError}</p>
                )}

                <button
                  type="submit"
                  disabled={loginLoading || !emailLogin.trim() || !passLogin}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg, #B8860B 0%, #8B6914 100%)',
                    boxShadow: '0 4px 20px rgba(184,134,11,0.3)',
                  }}
                >
                  {loginLoading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  {loginLoading ? 'Ingresando...' : 'Iniciar sesión'}
                </button>

                <div className="text-center pt-2">
                  <button type="button" onClick={() => { setModoEmail(false); setLoginError(null) }}
                    className="text-xs font-semibold transition-colors hover:underline"
                    style={{ color: 'rgba(255,255,255,0.4)' }}>
                    ← Volver a selección de usuario
                  </button>
                </div>
              </form>
            ) : (
              <>
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
                {usuarios.map((u, i) => (
                  <UserCard key={u.id} user={u} onClick={setSeleccionado} index={i} />
                ))}
              </div>
            )}

                {/* Link para iniciar con correo */}
                <div className="text-center pt-5 mt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button onClick={() => setModoEmail(true)}
                    className="inline-flex items-center gap-2 text-xs font-semibold transition-colors hover:underline"
                    style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <Mail size={13} />
                    Iniciar sesión con correo y contraseña
                  </button>
                </div>
              </>
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
        <p className="text-[10px] tracking-[0.2em] uppercase font-medium px-4 py-1.5 rounded-full"
          style={{ color: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          Construacero Carabobo C.A. · Sistema de Gestión
        </p>
      </div>

      {/* Botón instalar PWA en móvil */}
      <div className="md:hidden fixed bottom-4 left-0 right-0 flex justify-center z-20 pointer-events-none"
        style={{ animation: 'fadeIn 1s ease 0.8s forwards', opacity: 0 }}>
        <div className="pointer-events-auto">
          <PwaInstallButton />
        </div>
      </div>

      {/* Modal PIN */}
      <LoginPinModal
        isOpen={!!seleccionado}
        user={seleccionado}
        onClose={() => setSeleccionado(null)}
        onSubmit={handlePin}
      />

      {/* ── Modal secreto dev (easter egg) ── */}
      {showDevPin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) { setShowDevPin(false); setDevPin(''); setDevError(null) } }}>
          <div className="w-full max-w-xs rounded-2xl p-6 mx-4"
            style={{
              background: 'rgba(15,15,30,0.95)',
              border: '1px solid rgba(220,38,38,0.3)',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(220,38,38,0.1)',
            }}>
            <div className="text-center mb-5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
                style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)' }}>
                <Key size={20} style={{ color: '#dc2626' }} />
              </div>
              <h3 className="text-sm font-black text-white tracking-tight">Acceso Desarrollador</h3>
              <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Ingresa el código de acceso</p>
            </div>

            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={devPin}
              onChange={e => { setDevPin(e.target.value.replace(/\D/g, '')); setDevError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && devPin.length === 6) handleDevPinSubmit() }}
              autoFocus
              className="w-full text-center text-2xl font-mono tracking-[0.5em] py-3 rounded-xl text-white outline-none transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${devError ? 'rgba(220,38,38,0.5)' : 'rgba(255,255,255,0.1)'}`,
                caretColor: '#dc2626',
              }}
              placeholder="------"
            />

            {devError && (
              <p className="text-xs text-red-400 text-center mt-2">{devError}</p>
            )}

            <button
              onClick={handleDevPinSubmit}
              disabled={devPin.length !== 6 || devLoading}
              className="w-full flex items-center justify-center gap-2 mt-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
                boxShadow: '0 4px 20px rgba(220,38,38,0.3)',
              }}
            >
              {devLoading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {devLoading ? 'Accediendo...' : 'Entrar'}
            </button>

            <button
              onClick={() => { setShowDevPin(false); setDevPin(''); setDevError(null) }}
              className="w-full text-center text-xs mt-3 py-1 transition-colors"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function LoginPage() {
  const [gateChecked, setGateChecked] = useState(false)
  const [needsGate, setNeedsGate] = useState(false)
  const [gatePassed, setGatePassed] = useState(false)

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  useEffect(() => {
    // Si ya pasó el gate en esta sesión, saltar
    if (sessionStorage.getItem(GATE_SESSION_KEY)) {
      setGatePassed(true)
      setGateChecked(true)
      return
    }
    // Verificar si hay gate configurado
    tieneGateConfigurado().then(tiene => {
      setNeedsGate(tiene)
      if (!tiene) setGatePassed(true)
      setGateChecked(true)
    })
  }, [])

  if (!gateChecked) {
    // Cargando check de gate — mostrar fondo oscuro sin flash
    return <DarkBackground />
  }

  if (needsGate && !gatePassed) {
    return <GateStep onPass={() => setGatePassed(true)} />
  }

  return <UserSelectStep />
}
