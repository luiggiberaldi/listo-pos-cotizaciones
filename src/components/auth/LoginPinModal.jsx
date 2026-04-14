// src/components/auth/LoginPinModal.jsx
// Modal de ingreso de PIN — estilo Listo POS Lite
// PIN = contraseña numérica de Supabase Auth (definida por el supervisor)
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Delete, Loader2, ShieldAlert, Clock } from 'lucide-react'
import LoginAvatar from './LoginAvatar'

const MAX_INTENTOS  = 3
const BLOQUEO_SEG   = 30
const lockKey = (id) => `pin_lock_${id}`

function getLock(id)       { try { return JSON.parse(sessionStorage.getItem(lockKey(id))) } catch { return null } }
function setLock(id, data) { sessionStorage.setItem(lockKey(id), JSON.stringify(data)) }
function clearLock(id)     { sessionStorage.removeItem(lockKey(id)) }

export default function LoginPinModal({ isOpen, onClose, user, onSubmit }) {
  const PIN_LEN = 6

  const [pin,        setPin]        = useState('')
  const [error,      setError]      = useState(false)
  const [working,    setWorking]    = useState(false)
  const [intentos,   setIntentos]   = useState(0)
  const [bloqueado,  setBloqueado]  = useState(null) // timestamp hasta cuando
  const [segsLeft,   setSegsLeft]   = useState(0)

  const inputRef    = useRef(null)
  const timerRef    = useRef(null)
  const isTactil    = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches

  // Revisar bloqueo al abrir
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
      setPin('')
      setError(false)
      checkLock()
      if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      clearInterval(timerRef.current)
    }
  }, [isOpen, checkLock])

  // Countdown del bloqueo
  useEffect(() => {
    clearInterval(timerRef.current)
    if (!bloqueado) { setSegsLeft(0); return }

    const tick = () => {
      const left = Math.ceil((bloqueado - Date.now()) / 1000)
      if (left <= 0) {
        clearInterval(timerRef.current)
        clearLock(user?.id)
        setBloqueado(null)
        setIntentos(0)
        setSegsLeft(0)
        if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
      } else {
        setSegsLeft(left)
      }
    }
    tick()
    timerRef.current = setInterval(tick, 500)
    return () => clearInterval(timerRef.current)
  }, [bloqueado, user?.id])

  // Auto-submit cuando se completan los dígitos
  useEffect(() => {
    if (pin.length === PIN_LEN && !working && !bloqueado) submit()
  }, [pin]) // eslint-disable-line

  async function submit() {
    if (pin.length !== PIN_LEN || working || bloqueado) return
    setWorking(true)

    const ok = await onSubmit(pin)

    if (!ok) {
      const nuevos = intentos + 1
      setIntentos(nuevos)
      setError(true)
      setPin('')
      setWorking(false)
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

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={bloqueado ? undefined : onClose}
    >
      <div
        className="relative bg-white rounded-3xl p-8 w-full max-w-sm mx-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        {!bloqueado && (
          <button onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 transition-colors rounded-full hover:bg-slate-100">
            <X size={20} />
          </button>
        )}

        {/* Avatar + nombre */}
        <div className="flex flex-col items-center mb-7">
          <div className="mb-4"><LoginAvatar user={user} /></div>
          <h2 className="text-xl font-black text-slate-800">{nombre}</h2>
          <p className="text-xs text-slate-500 mt-1">
            Ingresa tu PIN de 6 dígitos
          </p>
        </div>

        {bloqueado ? (
          /* ── Estado bloqueado ── */
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-20 h-20 rounded-full bg-red-50 border-4 border-red-100 flex items-center justify-center">
              <ShieldAlert size={36} className="text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-black text-slate-700">Acceso bloqueado</p>
              <p className="text-xs text-slate-400 mt-1">{MAX_INTENTOS} intentos fallidos consecutivos</p>
            </div>
            <div className="flex items-center gap-2 px-6 py-3 bg-red-50 border border-red-200 rounded-2xl">
              <Clock size={18} className="text-red-500 shrink-0" />
              <span className="text-2xl font-black text-red-600 tabular-nums w-8 text-center">{segsLeft}</span>
              <span className="text-sm font-bold text-red-500">segundos restantes</span>
            </div>
            <p className="text-[11px] text-slate-400 text-center">Espera para volver a intentarlo</p>
          </div>
        ) : (
          /* ── Teclado PIN ── */
          <>
            {intentos > 0 && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <ShieldAlert size={14} className="text-amber-500 shrink-0" />
                <p className="text-[11px] font-bold text-amber-600">
                  {intentos}/{MAX_INTENTOS} intentos fallidos
                </p>
              </div>
            )}

            {/* Puntos indicadores */}
            <div className={`flex justify-center gap-3 mb-7 ${error ? 'animate-shake' : ''}`}>
              {Array.from({ length: PIN_LEN }).map((_, i) => (
                <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                  error
                    ? 'bg-red-500 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                    : i < pin.length
                      ? 'bg-sky-500 border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.4)] scale-110'
                      : 'bg-transparent border-slate-300'
                }`} />
              ))}
            </div>

            {/* Input oculto para teclado físico */}
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
            <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => presionar(String(n))}
                  className="h-14 rounded-xl bg-slate-50 text-slate-800 text-xl font-bold hover:bg-slate-100 active:scale-95 active:bg-sky-50 transition-all border border-slate-200 shadow-sm">
                  {n}
                </button>
              ))}
              <div />
              <button onClick={() => presionar('0')}
                className="h-14 rounded-xl bg-slate-50 text-slate-800 text-xl font-bold hover:bg-slate-100 active:scale-95 active:bg-sky-50 transition-all border border-slate-200 shadow-sm">
                0
              </button>
              <button onClick={borrar}
                className="h-14 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500 active:scale-95 transition-all border border-slate-200 shadow-sm">
                <Delete size={22} />
              </button>
            </div>
          </>
        )}

        {working && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-3xl flex items-center justify-center">
            <Loader2 className="animate-spin text-sky-500" size={32} />
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
