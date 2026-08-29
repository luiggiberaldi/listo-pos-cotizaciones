// src/components/auth/LoginPinModal.jsx
// Modal de ingreso de PIN — Dark Premium (coherente con el login)
import { useState, useRef, useEffect } from 'react'
import { X, Delete, Loader2 } from 'lucide-react'
import LoginAvatar from './LoginAvatar'

export default function LoginPinModal({ isOpen, onClose, user, onSubmit }) {
  const PIN_LEN = (user?.rol === 'vendedor' || user?.rol === 'vendedor_sin_comision') ? 4 : 6

  const [pin,     setPin]     = useState('')
  const [error,   setError]   = useState(false)
  const [working, setWorking] = useState(false)

  const inputRef = useRef(null)
  const isTactil = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches

  useEffect(() => {
    if (isOpen) {
      setPin(''); setError(false)
      if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  useEffect(() => {
    if (pin.length === PIN_LEN && !working) submit()
  }, [pin]) // eslint-disable-line

  async function submit() {
    if (pin.length !== PIN_LEN || working) return
    setWorking(true)
    const ok = await onSubmit(pin)
    if (!ok) {
      setError(true); setPin(''); setWorking(false)
      setTimeout(() => setError(false), 600)
      if (!isTactil()) setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function presionar(d) {
    if (pin.length >= PIN_LEN || working) return
    setPin(p => p + d)
  }

  function borrar() {
    if (working) return
    setPin(p => p.slice(0, -1))
  }

  if (!isOpen || !user) return null

  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  const esPlateado = ['administracion', 'logistica'].includes(user?.rol)
  const userColor  = esPlateado ? '#CBD5E1' : (user.color || '#3b82f6')

  // Botones — siempre con fondo oscuro para todos los roles
  const btnStyle = {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#ffffff',
    textShadow: '0 1px 3px rgba(0,0,0,0.3)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center animate-in fade-in duration-200"
      style={{ background: 'rgba(5, 10, 24, 0.85)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-sm sm:mx-4 rounded-t-3xl sm:rounded-3xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 max-h-[95dvh] overflow-y-auto"
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

        {/* Línea superior sutil */}
        <div className="absolute top-0 left-[20%] right-[20%] h-px"
          style={{ background: `linear-gradient(to right, transparent, ${userColor}40, transparent)` }} />

        {/* Barra de arrastre en móvil */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
        </div>

        <div className="relative z-10 px-5 sm:px-7 pt-4 sm:pt-8 pb-5 sm:pb-7">

          {/* Botón cerrar */}
          <button onClick={onClose}
            className="absolute top-3 sm:top-5 right-4 sm:right-5 p-1.5 rounded-xl transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}>
            <X size={18} />
          </button>

          {/* Avatar + nombre */}
          <div className="flex flex-col items-center mb-5 sm:mb-7">
            <div className="mb-3 sm:mb-4"><LoginAvatar user={user} /></div>
            <h2 className="text-lg sm:text-xl font-black text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{nombre}</h2>
            <p className="text-[11px] sm:text-xs mt-1 font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Ingresa tu PIN de {PIN_LEN} dígitos
            </p>
          </div>

          {/* Puntos indicadores */}
          <div className={`flex justify-center gap-3 sm:gap-3.5 mb-5 sm:mb-8 ${error ? 'animate-shake' : ''}`}>
            {Array.from({ length: PIN_LEN }).map((_, i) => (
              <div key={i} className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all duration-200"
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
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 max-w-[240px] sm:max-w-[270px] mx-auto">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} type="button" onPointerDown={e => { e.preventDefault(); presionar(String(n)) }}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-bold transition-all duration-150 active:scale-95 select-none"
                style={btnStyle}
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

            {/* Botón 0 */}
            <button type="button" onPointerDown={e => { e.preventDefault(); presionar('0') }}
              className="h-12 sm:h-14 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-bold transition-all duration-150 active:scale-95 select-none"
              style={btnStyle}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = `${userColor}50` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
              onMouseDown={e => { e.currentTarget.style.background = `${userColor}25` }}
              onMouseUp={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
              onTouchStart={e => { e.currentTarget.style.background = `${userColor}25`; e.currentTarget.style.transform = 'scale(0.95)' }}
              onTouchEnd={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.transform = 'scale(1)' }}>
              0
            </button>

            {/* Botón borrar */}
            <button type="button" onPointerDown={e => { e.preventDefault(); borrar() }}
              className="h-12 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all duration-150 active:scale-95 select-none"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent', color: 'rgba(255,255,255,0.5)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#ef4444' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
              onMouseDown={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }}
              onMouseUp={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
              onTouchStart={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; e.currentTarget.style.transform = 'scale(0.95)' }}
              onTouchEnd={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.transform = 'scale(1)' }}>
              <Delete size={20} className="sm:hidden" />
              <Delete size={22} className="hidden sm:block" />
            </button>
          </div>
        </div>

        {/* Overlay de carga */}
        {working && (
          <div className="absolute inset-0 z-20 rounded-t-3xl sm:rounded-3xl flex items-center justify-center"
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
