// src/components/layout/BcvWidget.jsx
// Widget de tasa BCV — visible en desktop y móvil con UX adaptada
import { useState, useRef, useEffect } from 'react'
import { DollarSign, RefreshCw, X } from 'lucide-react'
import { useTasaCambio } from '../../hooks/useTasaCambio'

const fmtRate = n => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export default function BcvWidget({ soloLectura = false }) {
  const { tasaBcv, tasaEfectiva, modoAuto, setModoAuto, tasaManual, setTasaManual, cargando: tasaCargando, refrescar } = useTasaCambio()

  const [showConfig, setShowConfig] = useState(false)
  const [tasaInput, setTasaInput] = useState(tasaManual)
  const [tasaConfirmada, setTasaConfirmada] = useState(!!tasaManual)
  const bcvRef = useRef(null)

  // Cerrar popover al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (bcvRef.current && !bcvRef.current.contains(e.target)) {
        setShowConfig(false)
      }
    }
    if (showConfig) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showConfig])

  // Bloquear scroll del body cuando el sheet está abierto en móvil
  useEffect(() => {
    if (showConfig) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [showConfig])

  function confirmarTasaManual() {
    if (parseFloat(tasaInput) > 0) {
      setTasaManual(tasaInput)
      setTasaConfirmada(true)
    }
  }

  // Panel de configuración compartido
  const configPanel = (
    <div className="space-y-4">
      {/* Tasa actual grande */}
      <div className="text-center py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">Tasa actual</p>
        <p className="text-3xl font-black text-emerald-400 leading-none">
          {tasaEfectiva > 0 ? fmtRate(tasaEfectiva) : '—'}
        </p>
        <p className="text-xs text-white/40 mt-1">Bs por dólar</p>
      </div>

      {/* Toggle Auto/Manual */}
      <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <p className="text-xs font-bold text-white/70">
            Modo {modoAuto ? <span className="text-emerald-400">automático</span> : <span className="text-amber-400">manual</span>}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">
            {modoAuto ? 'Se actualiza desde el BCV cada 15 min' : 'Tú defines la tasa'}
          </p>
        </div>
        <button
          onClick={() => setModoAuto(!modoAuto)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${modoAuto ? 'bg-emerald-500' : 'bg-white/20'}`}
        >
          <span className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full transition-transform shadow-sm ${modoAuto ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Contenido según modo */}
      {modoAuto ? (
        <div className="p-3 rounded-xl space-y-2" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.12)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-emerald-400">BCV Oficial</p>
              <p className="text-[10px] text-white/40">
                {tasaBcv.fuente || 'Cargando...'}
                {tasaBcv.ultimaActualizacion && (
                  <> · {new Date(tasaBcv.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </p>
            </div>
            <button onClick={refrescar} disabled={tasaCargando}
              className="p-2.5 rounded-xl text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all active:scale-90">
              <RefreshCw size={16} className={tasaCargando ? 'animate-spin' : ''} />
            </button>
          </div>
          {tasaBcv.precio > 0 && (
            <p className="text-lg font-black text-emerald-400">
              {fmtRate(tasaBcv.precio)} <span className="text-xs font-medium text-white/30">Bs/$</span>
            </p>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-xl space-y-3" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.12)' }}>
          <p className="text-xs font-bold text-amber-400">Tasa manual</p>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input type="number" min="0.01" step="0.01"
                value={tasaInput}
                onChange={e => { setTasaInput(e.target.value); setTasaConfirmada(false) }}
                placeholder="Ej: 48.50"
                className="w-full px-3 py-2.5 rounded-xl text-sm font-bold text-white/90 focus:outline-none focus:ring-2 focus:ring-amber-500/40 placeholder:text-white/20"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                onKeyDown={e => e.key === 'Enter' && confirmarTasaManual()}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/25">Bs/$</span>
            </div>
            <button
              onClick={confirmarTasaManual}
              disabled={!tasaInput || parseFloat(tasaInput) <= 0 || tasaConfirmada}
              className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                tasaConfirmada
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                  : 'text-white disabled:opacity-30'
              }`}
              style={!tasaConfirmada ? { background: 'linear-gradient(135deg, #B8860B, #d4a017)' } : {}}
            >
              {tasaConfirmada ? 'Listo' : 'Aplicar'}
            </button>
          </div>
          {tasaBcv.precio > 0 && (
            <p className="text-[10px] text-white/30">
              Referencia BCV: {fmtRate(tasaBcv.precio)} Bs/$
            </p>
          )}
        </div>
      )}
    </div>
  )

  // Solo lectura: vendedor ve la tasa pero no puede configurar
  if (soloLectura) {
    return (
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <DollarSign size={13} className="text-emerald-400 shrink-0" />
        <span className="hidden sm:inline text-xs font-black text-white/70">BCV</span>
        <span className="text-sm font-black text-emerald-400">
          {tasaEfectiva > 0 ? fmtRate(tasaEfectiva) : '—'}
        </span>
        <span className="hidden sm:inline text-[10px] text-white/35 font-medium">Bs/$</span>
      </div>
    )
  }

  return (
    <div className="relative" ref={bcvRef}>
      {/* ── Botón trigger — adaptado a desktop y móvil ── */}
      <button
        onClick={() => setShowConfig(v => !v)}
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-xl transition-all"
        style={{
          background: showConfig ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${showConfig ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)'}`,
        }}
        onMouseEnter={e => { if (!showConfig) e.currentTarget.style.background = 'rgba(255,255,255,0.09)' }}
        onMouseLeave={e => { if (!showConfig) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
        aria-label="Tasa BCV"
      >
        <DollarSign size={13} className="text-emerald-400 shrink-0" />
        <span className="hidden sm:inline text-xs font-black text-white/70">BCV</span>
        <span className="text-sm font-black text-emerald-400">
          {tasaEfectiva > 0 ? fmtRate(tasaEfectiva) : '—'}
        </span>
        <span className="hidden sm:inline text-[10px] text-white/35 font-medium">Bs/$</span>
        {!modoAuto && (
          <span className="text-[8px] sm:text-[9px] bg-amber-500/20 text-amber-400 px-1 sm:px-1.5 py-0.5 rounded font-bold border border-amber-500/20">MAN</span>
        )}
      </button>

      {/* ── Desktop: popover dropdown ── */}
      {showConfig && (
        <div className="hidden md:block absolute top-full right-0 mt-2 w-72 rounded-2xl shadow-2xl z-50 p-4 animate-in fade-in zoom-in-95 duration-150"
          style={{ background: '#0f1f3c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          {configPanel}
        </div>
      )}

      {/* ── Móvil: bottom sheet overlay ── */}
      {showConfig && (
        <>
          {/* Backdrop */}
          <div className="md:hidden fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowConfig(false)} />

          {/* Sheet */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-[201] rounded-t-3xl p-5 animate-in slide-in-from-bottom duration-300"
            style={{
              background: 'linear-gradient(180deg, #0f1f3c 0%, #0a1628 100%)',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
              paddingBottom: 'max(5rem, calc(env(safe-area-inset-bottom) + 4rem))',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}>
            {/* Handle */}
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header con cerrar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <DollarSign size={16} className="text-emerald-400" />
                </div>
                <span className="text-sm font-black text-white/80">Tasa de cambio</span>
              </div>
              <button onClick={() => setShowConfig(false)}
                className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>

            {configPanel}
          </div>
        </>
      )}
    </div>
  )
}
