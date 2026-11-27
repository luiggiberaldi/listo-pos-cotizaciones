// src/modules/auth/LoginPage.jsx
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Mail, Key, Eye, EyeOff, ArrowRight, Download, LogOut } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import { apiUrl, fetchConTimeout } from '../../services/apiBase'
import { getOperatorSession, setOperatorSession } from '../../services/operatorSession'
import queryClient from '../../lib/queryClient'
import LoginAvatar from '../../components/auth/LoginAvatar'
import LoginPinModal from '../../components/auth/LoginPinModal'
import HeaderTasas from '../../components/layout/HeaderTasas'
import { StagingBadge, esEntornoStaging } from '../../components/ui/StagingBanner'


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
      {/* OP-2026-031: se quitaron dos líneas verticales decorativas (35 % y 65 %):
          con el panel más ancho quedaban detrás y se veían "recortadas" a través del vidrio. */}
    </div>
  )
}

const ROL_ACCENT = {
  supervisor:     { color: '#3b82f6', glow: 'rgba(59,130,246,0.35)', chip: 'rgba(59,130,246,0.22)', chipBorder: 'rgba(96,165,250,0.5)', chipText: '#bfdbfe', label: 'Jefe de ventas' },
  vendedor:       { color: '#14b8a6', glow: 'rgba(20,184,166,0.3)',  chip: 'rgba(20,184,166,0.2)', chipBorder: 'rgba(45,212,191,0.45)', chipText: '#99f6e4', label: 'Vendedor' },
  administracion: { color: '#CBD5E1', glow: 'rgba(203,213,225,0.45)', chip: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 50%, #475569 100%)', chipBorder: 'rgba(203,213,225,0.7)', chipText: '#0f172a', label: 'Administración', labelCorto: 'Admin.' },
  logistica:      { color: '#CBD5E1', glow: 'rgba(203,213,225,0.45)', chip: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 50%, #475569 100%)', chipBorder: 'rgba(203,213,225,0.7)', chipText: '#0f172a', label: 'Logística' },
  vendedor_sin_comision: { color: '#14b8a6', glow: 'rgba(20,184,166,0.3)',  chip: 'rgba(20,184,166,0.2)', chipBorder: 'rgba(45,212,191,0.45)', chipText: '#99f6e4', label: 'Vendedor' },
  jefe:           { color: '#B8860B', glow: 'rgba(184,134,11,0.5)',  chip: 'linear-gradient(135deg, #FFD700 0%, #B8860B 50%, #8B6914 100%)',  chipBorder: 'rgba(184,134,11,0.6)', chipText: '#451a03', label: 'Jefe' },
}

// Orden de la lista: por rol y, dentro de cada rol, alfabético (OP-2026-031).
const ORDEN_ROL = { jefe: 0, administracion: 1, logistica: 2, supervisor: 3, vendedor: 4, vendedor_sin_comision: 4 }
// Dos bloques separados por una línea fina: dirección/operación arriba y ventas abajo.
const ROLES_DIRECCION = ['jefe', 'administracion', 'logistica']

// Para buscar por la inicial: "Ángel" empieza por "a".
const inicialNormalizada = nombre => formatearNombre(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toLowerCase()

// Último operador que entró en ESTE equipo, guardado por cuenta de negocio
// (nunca se mezcla con otra cuenta). Solo guarda el id, nunca el PIN.
const ultimoOperadorKey = accountId => `construacero_ultimo_operador_${accountId}`
function leerUltimoOperador(accountId) {
  if (!accountId) return null
  try { return localStorage.getItem(ultimoOperadorKey(accountId)) } catch { return null }
}
function guardarUltimoOperador(accountId, operatorId) {
  if (!accountId || !operatorId) return
  try { localStorage.setItem(ultimoOperadorKey(accountId), operatorId) } catch { /* Storage no disponible. */ }
}

function formatearNombre(nombre) {
  return (nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function acentoDe(user) {
  const rol = user.rol || 'vendedor'
  const esVendedorExterno = ['vendedor', 'vendedor_sin_comision'].includes(rol) && (!!user.es_externo || (user.markup_pct != null && Number(user.markup_pct) > 0))
  return esVendedorExterno
    ? {
        color: '#D97706',
        glow: 'rgba(217,119,6,0.35)',
        chip: 'rgba(217,119,6,0.22)',
        chipBorder: 'rgba(251,191,36,0.45)',
        chipText: '#fde68a',
        label: 'Vendedor (E)'
      }
    : (ROL_ACCENT[rol] ?? ROL_ACCENT.vendedor)
}

function RolChip({ acc }) {
  return (
    <span
      className="inline-block px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] min-[400px]:text-[10px] sm:text-[11px] font-bold uppercase tracking-normal sm:tracking-wide max-w-full whitespace-normal [overflow-wrap:normal] text-center leading-tight"
      title={acc.label}
      style={{ background: acc.chip, border: `1px solid ${acc.chipBorder}`, color: acc.chipText || acc.color }}
    >
      {acc.labelCorto || acc.label}
    </span>
  )
}

// ─── Tarjeta de usuario (Dark Premium, compacta) ─────────────────────────────
// esUltimo: fue el último en entrar en este equipo → va primero con marco dorado.
function UserCard({ user, onClick, index, esUltimo = false }) {
  const [hovered, setHovered] = React.useState(false)
  const nombre = formatearNombre(user.nombre)
  const acc = acentoDe(user)
  const borde = esUltimo
    ? (hovered ? 'rgba(252,231,163,0.85)' : 'rgba(212,175,55,0.6)')
    : (hovered ? acc.color + '60' : 'rgba(255,255,255,0.08)')

  return (
    <button
      type="button"
      onClick={() => onClick(user)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={`Entrar como ${nombre}, ${acc.label}${esUltimo ? ' (último usuario en este equipo)' : ''}`}
      title={esUltimo ? 'Último usuario que entró en este equipo' : undefined}
      data-user-id={user.id}
      className="cursor-pointer h-full w-full rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      style={{ animation: `fadeSlideUp 0.5s ease forwards`, animationDelay: `${index * 0.04}s`, opacity: 0 }}
    >
      <div
        className="relative flex flex-col items-center justify-start gap-1.5 sm:gap-2 [@media(max-height:700px)]:gap-1 px-1 sm:px-2 pt-2.5 pb-2 sm:pt-3 sm:pb-2.5 lg:pt-4 lg:pb-3 [@media(max-height:700px)]:pt-2 [@media(max-height:700px)]:pb-1.5 rounded-2xl transition-all duration-300 h-full"
        style={{
          background: esUltimo
            ? 'linear-gradient(160deg, rgba(184,134,11,0.18) 0%, rgba(255,255,255,0.04) 65%)'
            : (hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)'),
          border: `1px solid ${borde}`,
          boxShadow: hovered
            ? `0 0 0 1px ${acc.color}30, 0 16px 40px rgba(0,0,0,0.4), 0 0 24px ${acc.glow}`
            : (esUltimo ? '0 6px 24px rgba(0,0,0,0.3), 0 0 18px rgba(184,134,11,0.18)' : '0 6px 24px rgba(0,0,0,0.3)'),
          transform: hovered ? 'translateY(-3px) scale(1.02)' : 'translateY(0) scale(1)',
        }}
      >
        <div
          className="absolute top-0 left-[15%] right-[15%] h-px rounded-full transition-opacity duration-300"
          style={{
            background: `linear-gradient(to right, transparent, ${esUltimo ? '#D4AF37' : acc.color}, transparent)`,
            opacity: hovered || esUltimo ? 0.8 : 0.2,
          }}
        />
        {esUltimo && (
          <span
            className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 z-20 inline-flex items-center justify-center w-4 h-4 sm:w-[18px] sm:h-[18px] rounded-full text-[9px] sm:text-[10px] leading-none"
            style={{ background: 'rgba(212,175,55,0.22)', color: '#FCE7A3', border: '1px solid rgba(212,175,55,0.45)' }}
          >
            ★
          </span>
        )}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-2xl blur-xl transition-opacity duration-300"
            style={{ background: acc.glow, opacity: hovered ? 1 : 0.4, transform: 'scale(1.3)' }}
          />
          <LoginAvatar user={user} size="md" className="relative z-10" />
        </div>
        <div className="flex flex-col items-center gap-1 min-w-0 w-full text-center">
          {/* Mismo tamaño para todos los nombres; los largos bajan a 2 líneas. */}
          <p
            className="font-black text-white text-[12px] sm:text-[13px] lg:text-sm leading-tight line-clamp-2 break-words w-full"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
            title={nombre}
          >
            {nombre}
          </p>
          <RolChip acc={acc} />
        </div>
      </div>
    </button>
  )
}

// true cuando la pantalla mide al menos `px` de ancho (se actualiza al girar o redimensionar).
function useMinWidth(px) {
  const query = `(min-width: ${px}px)`
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setOk(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return ok
}

// Escribir una letra resalta a la primera persona cuyo nombre empieza por ella;
// repetirla pasa a la siguiente con la misma inicial. Enter abre su PIN (OP-2026-031).
function BuscarPorInicial({ lista, activo }) {
  useEffect(() => {
    if (!activo) return undefined
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const letra = e.key.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      if (!/^[a-zñ]$/.test(letra)) return
      const coinciden = lista.filter(u => inicialNormalizada(u.nombre) === letra)
      if (coinciden.length === 0) return
      const actual = document.activeElement?.getAttribute?.('data-user-id')
      const pos = coinciden.findIndex(u => u.id === actual)
      const siguiente = coinciden[(pos + 1) % coinciden.length]
      document.querySelector(`[data-user-id="${siguiente.id}"]`)?.focus()
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lista, activo])
  return null
}

// ─── Botón de instalación PWA ─────────────────────────────────────────────────
function PwaInstallButton() {
  const [prompt, setPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (installed || isStandalone) return null

  async function handleInstall() {
    if (prompt) {
      prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setInstalled(true)
      setPrompt(null)
    }
  }

  // iOS: mostrar guía
  if (isIos && !prompt) {
    return (
      <>
        <button
          onClick={() => setShowIosGuide(true)}
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
        {showIosGuide && (
          <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowIosGuide(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom">
              <div className="px-5 pt-5 pb-3 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-50 flex items-center justify-center">
                  <Download size={22} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">Instalar en iPhone</h3>
                <p className="text-sm text-slate-500 mt-1">Sigue estos pasos para agregar la app a tu pantalla de inicio</p>
              </div>
              <div className="px-5 pb-4 space-y-3">
                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">1</span>
                  <p className="text-sm text-slate-700">Pulsa el botón <strong>Compartir</strong> <span className="inline-block align-middle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline text-blue-600"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></span> en la barra de Safari</p>
                </div>
                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">2</span>
                  <p className="text-sm text-slate-700">Desplaza y selecciona <strong>"Agregar a pantalla de inicio"</strong></p>
                </div>
                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">3</span>
                  <p className="text-sm text-slate-700">Pulsa <strong>"Agregar"</strong> en la esquina superior derecha</p>
                </div>
              </div>
              <div className="px-5 pb-5">
                <button onClick={() => setShowIosGuide(false)}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors">
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // Android/Desktop: prompt nativo
  if (!prompt) return null

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
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center justify-center px-4 sm:px-6 pt-16 sm:pt-20 pb-8">
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
          <div className="mt-2">
            <StagingBadge />
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
function UserSelectStep({ onLogout }) {
  // La lista previa al PIN se verifica por cuenta; no reutilizar la de otro negocio.
  const accountId = useAuthStore(state => state.user?.id)
  const rosterRequest = React.useRef(0)
  const superAttempt = React.useRef(0)
  const [usuarios,     setUsuarios]     = useState([])
  const [cargando,     setCargando]     = useState(true)
  const [errorLista,   setErrorLista]   = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)

  // ── Super Admin Easter Egg ──
  const [logoTaps, setLogoTaps]         = useState(0)
  const [showSuperPin, setShowSuperPin] = useState(false)
  const [superPin, setSuperPin]         = useState('')
  const [superError, setSuperError]     = useState('')
  const [superWorking, setSuperWorking] = useState(false)
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

  function closeSuperPin() {
    superAttempt.current++
    setShowSuperPin(false)
    setSuperWorking(false)
    setSuperPin('')
    setSuperError('')
  }

  async function handleSuperPinSubmit(e) {
    e.preventDefault()
    if (superWorking) return
    const attempt = ++superAttempt.current
    const requestedAccount = accountId
    const previousSession = getOperatorSession()
    const isCurrent = () => attempt === superAttempt.current
      && useAuthStore.getState().user?.id === requestedAccount
      && getOperatorSession() === previousSession
    let token
    let issuedSession
    const discardSession = () => {
      if (issuedSession?.token && token) void fetchConTimeout(apiUrl('/api/auth/clear-operator'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Operator-Session': issuedSession.token },
      }, 5000).catch(() => {})
    }
    setSuperWorking(true)
    setSuperError('')
    try {
      const { data } = await supabase.auth.getSession()
      if (!isCurrent()) return
      token = data?.session?.access_token
      if (!token || data.session.user?.id !== requestedAccount) throw new Error('No autenticado')
      const response = await fetchConTimeout(apiUrl('/api/auth/super-admin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: superPin }),
        cache: 'no-store',
      }, 10000)
      const result = await response.json()
      issuedSession = result.operatorSession
      if (!isCurrent()) { discardSession(); return }
      if (!response.ok) {
        setSuperError(result.error || 'Código incorrecto')
        setSuperPin('')
        return
      }
      if (result.operator?.id !== '00000000-0000-0000-0000-000000000000'
        || result.operator?.rol !== 'desarrollador') throw new Error('Operador inválido')
      // Sin await entre la última validación y publicar la nueva identidad.
      void queryClient.cancelQueries().catch(() => {})
      queryClient.clear()
      setOperatorSession(issuedSession, { accountId: requestedAccount, operatorId: result.operator.id })
      useAuthStore.setState({
        perfil: {
          id: result.operator.id,
          nombre: 'Desarrollador',
          email: useAuthStore.getState().user?.email,
          rol: 'desarrollador',
          activo: true,
          color: '#8b5cf6',
          _isSuperAdmin: true,
        },
        error: null,
      })
      setShowSuperPin(false)
      navigate('/', { replace: true })
    } catch {
      discardSession()
      if (isCurrent()) {
        setSuperError('No se pudo verificar el acceso. Intenta nuevamente.')
        setSuperPin('')
      }
    } finally {
      if (attempt === superAttempt.current) setSuperWorking(false)
    }
  }

  async function cargarUsuarios() {
    const requestId = ++rosterRequest.current
    const requestedAccount = accountId
    const isCurrent = () => requestId === rosterRequest.current
      && useAuthStore.getState().user?.id === requestedAccount
    setCargando(true)
    setErrorLista(null)
    try {
      const { data } = await supabase.auth.getSession()
      if (!isCurrent()) return
      const session = data?.session
      if (!session?.access_token || session.user?.id !== requestedAccount) throw new Error('No autenticado')
      // Esta ruta admite solo la cuenta verificada y nunca devuelve credenciales de PIN.
      // Las tablas/RPC operativas siguen exigiendo una sesión de operador con PIN.
      const response = await fetchConTimeout(apiUrl('/api/auth/operators'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      }, 10000)
      if (!response.ok) throw new Error('Lista no disponible')
      const result = await response.json()
      if (!isCurrent()) return
      if (!Array.isArray(result.operators)) throw new Error('Lista inválida')
      const roles = new Set(Object.keys(ROL_ACCENT))
      setUsuarios(result.operators
        .filter(operator => operator?.id && roles.has(operator.rol))
        .map(({ id, nombre, rol, codigo, color, es_externo }) => ({ id, nombre, rol, codigo, color, es_externo: !!es_externo })))
    } catch {
      if (isCurrent()) {
        setUsuarios([])
        setErrorLista('No se pudo cargar la lista de usuarios. Verifica tu conexión e intenta nuevamente.')
      }
    } finally {
      if (isCurrent()) setCargando(false)
    }
  }

  useEffect(() => {
    // Retirar únicamente el antiguo caché de selección compartido entre cuentas.
    try { localStorage.removeItem('construacero_usuarios_cache_v4') } catch { /* Storage no concede acceso. */ }
    cargarUsuarios()
    return () => {
      rosterRequest.current++
      superAttempt.current++
      clearTimeout(logoTapTimer.current)
    }
  }, [])

  function seleccionarUsuario(u) {
    setSeleccionado(u)
    // Precalentar el token MIENTRAS se teclea el PIN — saca el refresh del JWT
    // del camino crítico (causa del cuelgue "Verificando…" en producción)
    useAuthStore.getState().precalentarToken()
  }

  function cancelPendingPin() {
    if (useAuthStore.getState().loading) void useAuthStore.getState().switchOut()
  }

  async function handlePin(pin) {
    if (!seleccionado) return false
    const res = await switchOperator(seleccionado.id, pin)
    if (res.ok) {
      guardarUltimoOperador(accountId, seleccionado.id)
      navigate('/', { replace: true })
    } else if (res.sessionExpired) {
      // Sesión principal de negocio expirada por inactividad → volver al login de email/clave
      if (typeof onLogout === 'function') onLogout()
    }
    return res
  }

  // Orden de la lista (OP-2026-031)
  // Celular (< 640 px): bloques apilados con su título, 2 columnas cada uno.
  const esCelular = !useMinWidth(640)
  // PC (propuesta A): los dos bloques van lado a lado, cada uno con su título.
  const ladoALado = useMinWidth(1024)
  const ultimoId = leerUltimoOperador(accountId)
  const ultimoUsuario = usuarios.find(u => u.id === ultimoId) || null
  const ordenados = [...usuarios].sort((a, b) =>
    ((ORDEN_ROL[a.rol] ?? 9) - (ORDEN_ROL[b.rol] ?? 9))
    || formatearNombre(a.nombre).localeCompare(formatearNombre(b.nombre), 'es'))
  // El último usuario de este equipo va primero, marcado en dorado.
  // El último usuario de este equipo va primero dentro de su bloque, marcado en dorado.
  const primeroElUltimo = arr => ultimoUsuario && arr.some(u => u.id === ultimoUsuario.id)
    ? [ultimoUsuario, ...arr.filter(u => u.id !== ultimoUsuario.id)]
    : arr
  const bloques = [
    primeroElUltimo(ordenados.filter(u => ROLES_DIRECCION.includes(u.rol))),
    primeroElUltimo(ordenados.filter(u => !ROLES_DIRECCION.includes(u.rol))),
  ].filter(b => b.length > 0)
  const lista = bloques.flat()
  const enFilasDe3 = bloque => !esCelular && bloque.length % 3 === 0 && bloque.length % 4 !== 0
  const gridCols = 'grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-2.5 lg:gap-3'
  // Filas que se reparten y centran: si la última fila no se llena, queda centrada
  // en vez de dejar un hueco a la derecha. Ancho = (100% - huecos) / columnas.
  const filaCentrada = 'flex flex-wrap justify-center gap-2 sm:gap-2.5 lg:gap-3'
  const anchoTarjeta = 'w-[calc((100%-1rem)/3)] sm:w-[calc((100%-1.875rem)/4)] lg:w-[calc((100%-2.25rem)/4)]'

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
      <BuscarPorInicial lista={lista} activo={!seleccionado && !showSuperPin} />

      <div className="relative z-10 min-h-[100dvh] w-full flex flex-col lg:flex-row items-center justify-start lg:justify-center px-3 sm:px-6 lg:px-8 xl:px-12 pt-14 pb-14 sm:pt-16 sm:pb-16 lg:pt-16 lg:pb-6 [@media(max-height:700px)]:pt-14 [@media(max-height:700px)]:pb-3 gap-3 sm:gap-5 lg:gap-8 xl:gap-12 overflow-x-hidden overflow-y-auto">

        {/* ── LOGO COMPACTO (celular y tablet) ── */}
        <div
          className="lg:hidden [@media(max-height:700px)]:hidden flex items-center gap-3 select-none shrink-0"
          style={{ animation: 'logoReveal 0.8s ease forwards' }}
        >
          <img
            src="/logo.png"
            alt="Construacero Carabobo"
            onClick={handleLogoTap}
            className="h-10 sm:h-14 w-auto object-contain cursor-pointer"
            style={{ filter: 'drop-shadow(0 0 18px rgba(184,134,11,0.35)) brightness(1.05)' }}
            draggable={false}
          />
          <span className="text-[10px] sm:text-xs font-bold tracking-[0.25em] uppercase whitespace-nowrap" style={{ color: '#B8860B' }}>
            Sistema de Gestión
          </span>
        </div>

        {/* ── LOGO + BRANDING (computadora) ── */}
        <div
          className="hidden lg:flex flex-col items-center gap-4 select-none lg:w-[200px] xl:w-[280px] shrink-0"
          style={{ animation: 'logoReveal 0.8s ease forwards' }}
        >
          <div className="relative flex items-center justify-center">
            <div className="absolute rounded-full opacity-25 blur-3xl"
              style={{ width: 'clamp(120px, 25vw, 280px)', height: 'clamp(120px, 25vw, 280px)', background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)' }} />
            <img
              src="/logo.png"
              alt="Construacero Carabobo"
              onClick={handleLogoTap}
              className="relative z-10 w-auto object-contain select-none drop-shadow-2xl cursor-pointer"
              style={{
                height: 'clamp(80px, 14vw, 220px)',
                filter: 'drop-shadow(0 0 40px rgba(184,134,11,0.35)) brightness(1.05)',
              }}
              draggable={false}
            />
          </div>

          <div className="flex items-center justify-center gap-2 sm:gap-3 w-full">
            <div className="h-px flex-1 max-w-[36px] sm:max-w-[48px] opacity-40" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
            <span className="text-[9px] sm:text-xs font-bold tracking-[0.25em] sm:tracking-[0.3em] uppercase whitespace-nowrap" style={{ color: '#B8860B' }}>
              Sistema de Gestión
            </span>
            <div className="h-px flex-1 max-w-[36px] sm:max-w-[48px] opacity-40" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
          </div>

          <p className="hidden lg:block text-sm leading-relaxed max-w-[280px] text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Gestión de cotizaciones, inventario y clientes para Construacero Carabobo C.A.
          </p>
        </div>

        {/* ── PANEL PRINCIPAL ── */}
        <div
          className="w-full max-w-[calc(100vw-1.5rem)] sm:max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-3xl relative overflow-hidden rounded-2xl sm:rounded-3xl"
          style={{
            // OP-2026-031: sin "vidrio esmerilado" (backdrop-filter). En algunas tarjetas
            // gráficas Chrome lo dibuja por bloques y deja una costura vertical visible.
            // El fondo ya es suave, así que un tono semitransparente se ve igual.
            background: 'linear-gradient(160deg, rgba(30,41,59,0.55) 0%, rgba(15,23,42,0.45) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 25px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
            animation: 'fadeSlideUp 0.6s ease 0.2s forwards',
            opacity: 0,
          }}
        >
          <div className="absolute top-0 left-[10%] right-[10%] h-px"
            style={{ background: 'linear-gradient(to right, transparent, rgba(184,134,11,0.6), transparent)' }} />
          <div className="absolute top-0 right-0 w-64 h-64 -mr-20 -mt-20 rounded-full opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 -ml-16 -mb-16 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', opacity: 0.06 }} />

          <div className="relative z-10 p-3 sm:p-5 xl:p-6">

            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg md:text-xl font-black text-white tracking-tight">
                  ¿Quién está operando?
                </h1>
                <p className="text-[11px] sm:text-xs md:text-sm mt-0.5 [@media(max-height:700px)]:hidden" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <span className="lg:hidden">Selecciona tu usuario e ingresa tu PIN</span>
                  <span className="hidden lg:inline">Elige tu usuario o escribe su inicial</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={cargarUsuarios.bind(null, false)}
                  disabled={cargando}
                  className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                  title="Volver a cargar la lista de usuarios"
                  aria-label="Actualizar lista de usuarios"
                >
                  <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">Actualizar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('¿Cerrar la sesión de la empresa en este equipo? Tendrás que ingresar el correo y contraseña de nuevo.')) {
                      onLogout()
                    }
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-xl text-xs font-semibold transition-all"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(252,165,165,0.9)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; e.currentTarget.style.color = '#fecaca' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = 'rgba(252,165,165,0.9)' }}
                  title="Cerrar la sesión de la empresa en este equipo (pedirá correo y clave de nuevo)"
                  aria-label="Salir de la cuenta de la empresa"
                >
                  <LogOut size={14} />
                  <span>Salir</span>
                </button>
              </div>
            </div>

            {/* Grid usuarios */}
            {cargando ? (
              <div className={gridCols}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 py-3 sm:py-4 animate-pulse">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 lg:w-14 lg:h-14 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="space-y-2 w-full px-2">
                      <div className="h-2.5 rounded w-3/4 mx-auto" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-2 rounded w-1/2 mx-auto" style={{ background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : errorLista ? (
              <div className="text-center py-8 sm:py-10">
                <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>{errorLista}</p>
                <button onClick={cargarUsuarios} className="text-sm font-bold text-sky-400 hover:text-sky-300 transition-colors">
                  Reintentar
                </button>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="text-center py-8 sm:py-10">
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No hay usuarios activos en el sistema.</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Contacta al supervisor.</p>
              </div>
            ) : (
              esCelular && bloques.length === 2 ? (
                <div className="space-y-3">
                  {bloques.map((bloque, b) => (
                    <section key={b} aria-label={b === 0 ? 'Dirección y operaciones' : 'Ventas'}>
                      <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5 px-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {b === 0 ? 'Dirección y operaciones' : 'Ventas'}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {bloque.map(u => (
                          <div key={u.id} className="min-w-0">
                            <UserCard user={u} onClick={seleccionarUsuario} index={lista.indexOf(u)} esUltimo={u.id === ultimoUsuario?.id} />
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : ladoALado && bloques.length === 2 ? (
                <div className="grid gap-4 xl:gap-5" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)' }}>
                  {bloques.map((bloque, b) => (
                    <section
                      key={b}
                      aria-label={b === 0 ? 'Dirección y operaciones' : 'Ventas'}
                      className={b === 1 ? 'pl-4 xl:pl-5' : ''}
                      style={b === 1 ? { borderLeft: '1px solid rgba(255,255,255,0.08)' } : undefined}
                    >
                      <p className="text-[11px] font-bold uppercase tracking-wider mb-2 px-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {b === 0 ? 'Dirección y operaciones' : 'Ventas'}
                      </p>
                      <div className="grid gap-2.5 xl:gap-3" style={{ gridTemplateColumns: `repeat(${b === 0 ? 2 : 3}, minmax(0, 1fr))` }}>
                        {bloque.map(u => (
                          <div key={u.id} className="min-w-0">
                            <UserCard user={u} onClick={seleccionarUsuario} index={lista.indexOf(u)} esUltimo={u.id === ultimoUsuario?.id} />
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
              <div>
                {bloques.map((bloque, b) => (
                  <React.Fragment key={b}>
                    {b > 0 && (
                      <div
                        role="separator"
                        className="h-px my-2.5 sm:my-3 [@media(max-height:700px)]:my-2 mx-2"
                        style={{ background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.14), transparent)' }}
                      />
                    )}
                    <div
                      className={filaCentrada}
                      // Tablet: si el bloque se reparte exacto en filas de 3 (y no de 4), va en
                      // filas de 3 del mismo tamaño y centradas, para no dejar tarjetas sueltas.
                      style={enFilasDe3(bloque) ? { width: 'calc(75% - 0.15625rem)', margin: '0 auto' } : undefined}
                    >
                      {bloque.map(u => (
                        <div key={u.id} className={`min-w-0 ${enFilasDe3(bloque) ? 'w-[calc((100%-1.25rem)/3)]' : anchoTarjeta}`}>
                          <UserCard user={u} onClick={seleccionarUsuario} index={lista.indexOf(u)} esUltimo={u.id === ultimoUsuario?.id} />
                        </div>
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>
              )
            )}

          </div>
        </div>

      </div>

      {/* Footer — PWA install button */}
      <div className="fixed bottom-3 sm:bottom-4 left-0 right-0 flex justify-center z-20 pointer-events-none"
        style={{ animation: 'fadeIn 1s ease 0.8s forwards', opacity: 0 }}>
        <div className="pointer-events-auto">
          <PwaInstallButton />
        </div>
      </div>

      {/* Modal Desarrollador secreto */}
      {showSuperPin && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" onClick={closeSuperPin} />
          <div className="fixed inset-0 z-[201] flex items-center justify-center px-4">
            <form
              onSubmit={handleSuperPinSubmit}
              className="w-full max-w-xs rounded-2xl p-6 relative"
              style={{
                background: 'rgba(15,10,25,0.95)',
                border: '1px solid rgba(139,92,246,0.3)',
                boxShadow: '0 25px 80px rgba(0,0,0,0.7), 0 0 40px rgba(139,92,246,0.15)',
                backdropFilter: 'blur(20px)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-0 left-[10%] right-[10%] h-px"
                style={{ background: 'linear-gradient(to right, transparent, rgba(139,92,246,0.6), transparent)' }} />
              <div className="text-center mb-5">
                <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                  style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                  </svg>
                </div>
                <h3 className="text-sm font-black text-white">Acceso Desarrollador</h3>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>Ingresa el código de acceso</p>
              </div>
              <input
                type="password"
                value={superPin}
                aria-label="Código de desarrollador"
                onChange={e => { setSuperPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setSuperError('') }}
                className="w-full text-center text-lg font-mono font-bold tracking-[0.3em] py-3 rounded-xl outline-none text-white"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${superError ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  caretColor: '#8b5cf6',
                }}
                placeholder="••••••••"
                autoFocus
                inputMode="numeric"
                maxLength={8}
              />
              {superError && <p className="text-xs text-red-400 text-center mt-2">{superError}</p>}
              <button
                type="submit"
                disabled={superWorking || superPin.length < 8}
                className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-30"
                style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
              >
                Acceder
              </button>
              <button
                type="button"
                onClick={closeSuperPin}
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
        onClose={() => { cancelPendingPin(); setSeleccionado(null) }}
        onCancelPending={cancelPendingPin}
        onSubmit={handlePin}
      />
    </>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
// La sesión de Supabase persiste en localStorage. Si el usuario ya inició sesión
// con email/contraseña, no necesita volver a hacerlo — va directo a selección de operador.
// Detectar sesión guardada en localStorage de forma síncrona
// para evitar flash del formulario email/contraseña al recargar
function haySessionGuardada() {
  try {
    const keys = Object.keys(localStorage)
    const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!sbKey) return false
    const stored = localStorage.getItem(sbKey)
    if (!stored) return false
    const parsed = JSON.parse(stored)
    return !!(parsed?.access_token || parsed?.user)
  } catch { return false }
}

export default function LoginPage() {
  const { user, initialized } = useAuthStore()
  const [gatePassed, setGatePassed] = useState(() => haySessionGuardada())

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

  return (
    <>
      {/* ── Barra superior (móvil + desktop, tal cual como el header post-PIN) ── */}
      <header
        className={`fixed ${esEntornoStaging() ? 'top-8' : 'top-0'} left-0 right-0 z-40 px-3 md:px-4 h-12 md:h-14 flex items-center justify-between gap-2 md:gap-4`}
        style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="pointer-events-none select-none flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.1] backdrop-blur-md shadow-lg shadow-black/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] sm:text-xs font-semibold tracking-wider text-slate-300 font-mono">
            v1.0.4
          </span>
        </div>

        <div className="flex-1" />

        <HeaderTasas soloLectura />
      </header>

      {/* Si no hay sesión de negocio o se cerró sesión → pedir email/contraseña */}
      {!gatePassed || !user ? (
        <GateStep onPass={() => setGatePassed(true)} />
      ) : (
        <UserSelectStep
          key={user.id}
          onLogout={() => {
            setGatePassed(false)
            useAuthStore.getState().logout()
          }}
        />
      )}
    </>
  )
}
