// src/components/auth/LoginPinModal.jsx
// Modal de ingreso de PIN — Dark Premium (coherente con el login)
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Delete, Loader2, ShieldAlert, Clock } from 'lucide-react'
import LoginAvatar from './LoginAvatar'

const MAX_INTENTOS = 3
const BLOQUEO_SEG  = 30
const lockKey = (id) => `pin_lock_${id}`

function getLock(id)       { try { return JSON.parse(sessionStorage.getItem(lockKey(id))) } catch { return null } }
function setLock(id, data) { sessionStorage.setItem(lockKey(id), JSON.stringify(data)) }
function clearLock(id)     { sessionStorage.removeItem(lockKey(id)) }

export default function LoginPinModal({ isOpen, onClose, user, onSubmit }) {
  const PIN_LEN = 6

  const [pin,       setPin]       = useState('')
  const [error,     setError]     = useState(false)
  const [working,   setWorking]   = useState(false)
  const [intentos,  setIntentos]  = useState(0)
  const [bloqueado, setBloqueado] = useState(null)
  const [segsLeft,  setSegsLeft]  = useState(0)

  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const isTactil = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches

  const checkLock = useCallback(() => {
    if (!user?.id) return
    const d = getLock(user.id)
    if (d?.until && Date.now() < d.until) {
      setBloqueado(d.until)
      setIntentos(d.intentos ?? MAX_INTENTOS)
    } else {
      if (d?.until) clearLock(user.id)
      setBloqueado(null)
      setIntentos(d?.until ? 0 : (d?.intentos ?? 0))
    }
  }, [user?.id])

  useEffect(() => {
    if (isOpen) {
      setPin(''); setError(false); checkLock()
      if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      clearInterval(timerRef.current)
    }
  }, [isOpen, checkLock])

  useEffect(() => {
    clearInterval(timerRef.current)
    if (!bloqueado) { setSegsLeft(0); return }
    const tick = () => {
      const left = Math.ceil((bloqueado - Date.now()) / 1000)
      if (left <= 0) {
        clearInterval(timerRef.current)
        clearLock(user?.id)
        setBloqueado(null); setIntentos(0); setSegsLeft(0)
        if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
      } else { setSegsLeft(left) }
    }
    tick()
    timerRef.current = setInterval(tick, 500)
    return () => clearInterval(timerRef.current)
  }, [bloqueado, user?.id])

  useEffect(() => {
    if (pin.length === PIN_LEN && !working && !bloqueado) submit()
  }, [pin]) // eslint-disable-line

  async function submit() {
    if (pin.length !== PIN_LEN || working || bloqueado) return
    setWorking(true)
    const ok = await onSubmit(pin)
    if (!ok) {
      const nuevos = intentos + 1
      setIntentos(nuevos); setError(true); setPin(''); setWorking(false)
      setTimeout(() => setError(false), 600)
      if (nuevos >= MAX_INTENTOS) {
        const hasta = Date.now() + BLOQUEO_SEG * 1000
        setLock(user.id, { until: hasta, intentos: nuevos })
        setBloqueado(hasta)
      } else {
        setLock(user.id, { until: null, intentos: nuevos })
        if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
      }
    } else {
      clearLock(user?.id)
    }
  }

  function presionar(d) {
    if (pin.length >= PIN_LEN || working || bloqueado) return
    setPin(p => p + d)
  }

  function borrar() {
    if (working || bloqueado) return
    setPin(p => p.slice(0, -1))
  }

  if (!isOpen || !user) return null

  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  const userColor = user.color || '#3b82f6'

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center animate-in fade-in duration-200"
      style={{ background: 'rgba(5, 10, 24, 0.85)', backdropFilter: 'blur(8px)' }}
      onClick={bloqueado ? undefined : onClose}
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-3xl overflow-hidden animate-in zoom-in-95 duration-300"
        style={{
          background: 'linear-gradient(160deg, #0d1f3c 0%, #0a1628 60%, #081520 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Patrón de puntos de fondo */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }} />

        {/* Orbe de color del usuario */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${userColor}40 0%, transparent 70%)`, filter: 'blur(24px)' }} />

        {/* Línea dorada superior */}
        <div className="absolute top-0 left-[20%] right-[20%] h-px"
          style={{ background: 'linear-gradient(to right, transparent, rgba(184,134,11,0.4), transparent)' }} />

        <div className="relative z-10 px-7 pt-8 pb-7">

          {/* Botón cerrar */}
          {!bloqueado && (
            <button onClick={onClose}
              className="absolute top-5 right-5 p-1.5 rounded-xl transition-colors"
              style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.05)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
              <X size={18} />
            </button>
          )}

          {/* Avatar + nombre */}
          <div className="flex flex-col items-center mb-7">
            <div className="mb-4"><LoginAvatar user={user} /></div>
            <h2 className="text-xl font-black text-white">{nombre}</h2>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Ingresa tu PIN de 6 dígitos
            </p>
          </div>

          {bloqueado ? (
            /* ── Estado bloqueado ── */
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.3)' }}>
                <ShieldAlert size={36} className="text-red-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-black text-white">Acceso bloqueado</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{MAX_INTENTOS} intentos fallidos consecutivos</p>
              </div>
              <div className="flex items-center gap-3 px-6 py-3 rounded-2xl"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <Clock size={18} className="text-red-400 shrink-0" />
                <span className="text-2xl font-black text-red-400 tabular-nums w-8 text-center">{segsLeft}</span>
                <span className="text-sm font-semibold text-red-400/70">segundos</span>
              </div>
            </div>
          ) : (
            <>
              {/* Aviso intentos fallidos */}
              {intentos > 0 && (
                <div className="mb-5 flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <ShieldAlert size={14} className="text-amber-400 shrink-0" />
                  <p className="text-[11px] font-bold text-amber-400">
                    {intentos}/{MAX_INTENTOS} intentos fallidos
                  </p>
                </div>
              )}

              {/* Puntos indicadores */}
              <div className={`flex justify-center gap-3.5 mb-8 ${error ? 'animate-shake' : ''}`}>
                {Array.from({ length: PIN_LEN }).map((_, i) => (
                  <div key={i} className="w-4 h-4 rounded-full transition-all duration-200"
                    style={
                      error
                        ? { background: '#ef4444', border: '2px solid #ef4444', boxShadow: '0 0 12px rgba(239,68,68,0.6)', transform: 'scale(1.1)' }
                        : i < pin.length
                          ? { background: userColor, border: `2px solid ${userColor}`, boxShadow: `0 0 14px ${userColor}70`, transform: 'scale(1.15)' }
                          : { background: 'transparent', border: '2px solid rgba(255,255,255,0.2)' }
                    } />
                ))}
              </div>

              {/* Input oculto teclado físico */}
              <input
                ref={inputRef}
                type="tel"
                maxLength={PIN_LEN}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LEN))}
                className="absolute opacity-0 w-0 h-0"
                autoComplete="off"
                inputMode="numeric"
                readOnly={isTactil()}
              />

              {/* Pad numérico */}
              <div className="grid grid-cols-3 gap-3 max-w-[270px] mx-auto">
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <button key={n} onClick={() => presionar(String(n))}
                    className="h-14 rounded-2xl text-xl font-bold transition-all duration-150 active:scale-95 select-none"
                    style={{
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.9)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = `${userColor}50` }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
                    onMouseDown={e => { e.currentTarget.style.background = `${userColor}25` }}
                    onMouseUp={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                    onTouchStart={e => { e.currentTarget.style.background = `${userColor}25`; e.currentTarget.style.transform = 'scale(0.95)' }}
                    onTouchEnd={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.transform = 'scale(1)' }}>
                    {n}
                  </button>
                ))}

                <div />

                <button onClick={() => presionar('0')}
                  className="h-14 rounded-2xl text-xl font-bold transition-all duration-150 active:scale-95 select-none"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.9)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                  onMouseDown={e => { e.currentTarget.style.background = `${userColor}25` }}
                  onMouseUp={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                  onTouchStart={e => { e.currentTarget.style.background = `${userColor}25`; e.currentTarget.style.transform = 'scale(0.95)' }}
                  onTouchEnd={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.transform = 'scale(1)' }}>
                  0
                </button>

                <button onClick={borrar}
                  className="h-14 rounded-2xl flex items-center justify-center transition-all duration-150 active:scale-95 select-none"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.4)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#f87171' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
                  onTouchStart={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; e.currentTarget.style.transform = 'scale(0.95)' }}
                  onTouchEnd={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'scale(1)' }}>
                  <Delete size={22} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Overlay de carga */}
        {working && (
          <div className="absolute inset-0 rounded-3xl flex items-center justify-center"
            style={{ background: 'rgba(10,22,40,0.85)', backdropFilter: 'blur(4px)' }}>
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="animate-spin" size={32} style={{ color: userColor }} />
              <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Verificando…</p>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  )
}
