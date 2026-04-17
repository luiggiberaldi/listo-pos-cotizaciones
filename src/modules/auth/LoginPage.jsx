// src/modules/auth/LoginPage.jsx
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Mail, Key, Eye, EyeOff, ArrowRight } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../../components/auth/LoginAvatar'
import LoginPinModal from '../../components/auth/LoginPinModal'
import { validarGate } from '../../hooks/useConfigNegocio'
import { CardContainer, CardBody, CardItem } from '../../components/ui/3d-card'

const GATE_SESSION_KEY = 'listo_gate_ok'

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

const USUARIOS_CACHE_KEY = 'listo_usuarios_cache'

// ─── Paso 2: Seleccionar usuario ──────────────────────────────────────────────
function UserSelectStep() {
  const cached = (() => { try { return JSON.parse(localStorage.getItem(USUARIOS_CACHE_KEY) || '[]') } catch { return [] } })()
  const [usuarios,     setUsuarios]     = useState(cached)
  const [cargando,     setCargando]     = useState(cached.length === 0)
  const [errorLista,   setErrorLista]   = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [visible,      setVisible]      = useState(false)

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
              className="relative z-10 w-auto object-contain select-none pointer-events-none drop-shadow-2xl"
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
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">¿Quién está operando?</h1>
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
                {usuarios.map((u, i) => (
                  <UserCard key={u.id} user={u} onClick={setSeleccionado} index={i} />
                ))}
              </div>
            )}

          </div>
        </div>

      </div>

      {/* Footer — bottom fijo, solo desktop */}
      <div className="hidden md:flex fixed bottom-4 left-0 right-0 justify-center pointer-events-none z-20"
        style={{ animation: 'fadeIn 1s ease 0.8s forwards', opacity: 0 }}>
        <p className="text-[10px] tracking-[0.2em] uppercase font-medium px-4 py-1.5 rounded-full"
          style={{ color: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          Construacero Carabobo C.A. · Listo POS
        </p>
      </div>

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
export default function LoginPage() {
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = prev }
  }, [])
  return <UserSelectStep />
}
