// src/components/cotizaciones/QuickQuoteFAB.jsx
// Speed Dial FAB — Cotización + Venta Rápida (solo móvil)
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, FileText, Zap, X } from 'lucide-react'

export default function QuickQuoteFAB() {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Cerrar al tocar fuera
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [open])

  // Cerrar speed dial al cambiar de ruta
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // No mostrar en cotizaciones, venta rápida, ni en login
  const hiddenPaths = ['/cotizaciones', '/venta-rapida', '/login']
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) return null

  function go(path) {
    setOpen(false)
    navigate(path)
  }

  return (
    <div ref={ref} className="fixed bottom-20 right-4 z-[90] md:hidden flex flex-col items-end gap-2">
      {/* Speed dial options */}
      {open && (
        <>
          {/* Overlay sutil */}
          <div className="fixed inset-0 bg-black/20 -z-10" onClick={() => setOpen(false)} />

          {/* Opción: Venta Rápida */}
          <button
            onClick={() => go('/venta-rapida')}
            className="flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-full shadow-lg active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', boxShadow: '0 4px 16px rgba(27,54,93,0.35)' }}
          >
            <span className="text-[11px] font-black text-white/90 uppercase tracking-wider whitespace-nowrap">Venta Rápida</span>
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
          </button>

          {/* Opción: Cotización */}
          <button
            onClick={() => go('/cotizaciones?nueva=1')}
            className="flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-full shadow-lg active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #1B365D, #2a5298)', boxShadow: '0 4px 16px rgba(27,54,93,0.35)' }}
          >
            <span className="text-[11px] font-black text-white/90 uppercase tracking-wider whitespace-nowrap">Cotización</span>
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <FileText size={18} className="text-white" />
            </div>
          </button>
        </>
      )}

      {/* Main FAB */}
      <button
        onClick={() => setOpen(!open)}
        className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-90"
        style={{
          background: 'linear-gradient(135deg, #1B365D, #B8860B)',
          boxShadow: '0 6px 24px rgba(27,54,93,0.4)',
          transition: 'transform 0.2s ease',
        }}
        title="Crear"
      >
        {open ? <X size={22} className="text-white" /> : <Plus size={24} className="text-white" strokeWidth={2.5} />}
      </button>
    </div>
  )
}
