// src/components/layout/BcvWidget.jsx
// Extracted BCV widget to prevent AppLayout full re-renders on tasa state changes
import { useState, useRef, useEffect } from 'react'
import { DollarSign, RefreshCw } from 'lucide-react'
import { useTasaCambio } from '../../hooks/useTasaCambio'

export default function BcvWidget() {
  const { tasaBcv, tasaEfectiva, modoAuto, setModoAuto, tasaManual, setTasaManual, cargando: tasaCargando, refrescar } = useTasaCambio()

  const [showTasaConfig, setShowTasaConfig] = useState(false)
  const [tasaInput, setTasaInput] = useState(tasaManual)
  const [tasaConfirmada, setTasaConfirmada] = useState(!!tasaManual)
  const bcvRef = useRef(null)

  // Cerrar BCV popover al hacer click fuera
  useEffect(() => {
    function handleClickOutsideBcv(e) {
      if (bcvRef.current && !bcvRef.current.contains(e.target)) {
        setShowTasaConfig(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutsideBcv)
    return () => document.removeEventListener('mousedown', handleClickOutsideBcv)
  }, [])

  function confirmarTasaManual() {
    if (parseFloat(tasaInput) > 0) {
      setTasaManual(tasaInput)
      setTasaConfirmada(true)
    }
  }

  return (
    <div className="hidden md:block relative" ref={bcvRef}>
      <button
        onClick={() => setShowTasaConfig(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all"
        style={{
          background: showTasaConfig ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${showTasaConfig ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)'}`,
        }}
        onMouseEnter={e => { if (!showTasaConfig) e.currentTarget.style.background = 'rgba(255,255,255,0.09)' }}
        onMouseLeave={e => { if (!showTasaConfig) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
        aria-label="Tasa BCV"
      >
        <DollarSign size={13} className="text-emerald-400 shrink-0" />
        <span className="text-xs font-black text-white/70">BCV</span>
        <span className="text-sm font-black text-emerald-400">
          {tasaEfectiva > 0
            ? new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaEfectiva)
            : '—'}
        </span>
        <span className="text-[10px] text-white/35 font-medium">Bs/$</span>
        {!modoAuto && (
          <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold border border-amber-500/20">MAN</span>
        )}
      </button>

      {/* Popover BCV */}
      {showTasaConfig && (
        <div className="absolute top-full right-0 mt-2 w-64 rounded-2xl shadow-2xl z-50 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
          style={{ background: '#0f1f3c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-400" />
              <span className="text-xs font-black uppercase tracking-wider text-white/60">Tasa BCV</span>
            </div>
            {tasaBcv.precio > 0 && (
              <span className="text-[10px] text-white/30">
                Ref: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaBcv.precio)}
              </span>
            )}
          </div>
          {/* Modo Auto/Manual */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-white/30">Modo</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">
                {modoAuto ? <span className="text-emerald-400">Auto</span> : <span className="text-amber-400">Manual</span>}
              </span>
              <button
                onClick={() => setModoAuto(!modoAuto)}
                className={`relative w-9 h-5 rounded-full transition-colors ${modoAuto ? 'bg-emerald-500' : 'bg-white/20'}`}
                aria-label={modoAuto ? 'Cambiar a modo manual' : 'Cambiar a modo automático'}
              >
                <span className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform shadow-sm ${modoAuto ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
          {modoAuto ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-white/50">{tasaBcv.fuente || 'Cargando...'}</p>
                {tasaBcv.ultimaActualizacion && (
                  <p className="text-[10px] text-white/30">
                    {new Date(tasaBcv.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
              <button onClick={refrescar} disabled={tasaCargando}
                className="p-1.5 rounded-lg text-white/30 hover:text-emerald-400 transition-colors hover:bg-white/5"
                aria-label="Refrescar tasa">
                <RefreshCw size={13} className={tasaCargando ? 'animate-spin' : ''} />
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5 items-center">
              <input type="number" min="0.01" step="0.01"
                value={tasaInput}
                onChange={e => { setTasaInput(e.target.value); setTasaConfirmada(false) }}
                placeholder="Tasa manual Bs/$"
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-sm font-bold text-white/80 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                onKeyDown={e => e.key === 'Enter' && confirmarTasaManual()}
                aria-label="Tasa manual"
              />
              <button
                onClick={confirmarTasaManual}
                disabled={!tasaInput || parseFloat(tasaInput) <= 0 || tasaConfirmada}
                className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                  tasaConfirmada
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                    : 'text-white hover:opacity-90 disabled:opacity-40'
                }`}
                style={!tasaConfirmada ? { background: 'linear-gradient(135deg, #1B365D, #B8860B)' } : {}}
              >
                {tasaConfirmada ? '✓' : 'OK'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
