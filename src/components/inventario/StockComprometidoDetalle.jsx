// src/components/inventario/StockComprometidoDetalle.jsx
// Bottom sheet (móvil) / popover (desktop) de stock comprometido por vendedor
import { useState, useEffect } from 'react'
import { Users, X, FileText, Package } from 'lucide-react'
import { useStockComprometidoDetalle } from '../../hooks/useStockComprometido'

const ESTADO_LABEL = {
  enviada: 'Enviada',
  aceptada: 'Aceptada',
}

function DetalleItem({ d }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'rgba(251,191,36,0.1)' }}>
        <Users size={14} className="text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white/90 truncate">{d.vendedor_nombre}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <FileText size={10} className="text-white/30 shrink-0" />
          <span className="text-xs text-white/50">COT-{d.cotizacion_numero}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{
              background: d.cotizacion_estado === 'aceptada' ? 'rgba(52,211,153,0.15)' : 'rgba(99,102,241,0.15)',
              color: d.cotizacion_estado === 'aceptada' ? '#34d399' : '#818cf8',
            }}>
            {ESTADO_LABEL[d.cotizacion_estado] || d.cotizacion_estado}
          </span>
        </div>
      </div>
      <span className="text-base font-black text-amber-400 shrink-0">
        {Number(d.cantidad).toLocaleString('es-VE')}
      </span>
    </div>
  )
}

export default function StockComprometidoDetalle({ productoId, comprometido }) {
  const [open, setOpen] = useState(false)
  const { data: detalle = [], isLoading } = useStockComprometidoDetalle(open ? productoId : null)

  // Bloquear scroll del body cuando el sheet está abierto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  if (!comprometido || comprometido <= 0) return null

  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}
        className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-semibold hover:text-amber-700 hover:underline transition-colors"
      >
        <Users size={10} />
        {Number(comprometido).toLocaleString('es-VE')} comprometidas
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
          />

          {/* ── Móvil: bottom sheet ── */}
          <div
            className="md:hidden fixed bottom-0 left-0 right-0 z-[201] rounded-t-3xl animate-in slide-in-from-bottom duration-300"
            style={{
              background: 'linear-gradient(180deg, #0f1f3c 0%, #0a1628 100%)',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
              paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
              maxHeight: '70vh',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(251,191,36,0.1)' }}>
                  <Package size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-black text-white/90">Stock comprometido</p>
                  <p className="text-xs text-white/40">
                    {Number(comprometido).toLocaleString('es-VE')} unidades en cotizaciones activas
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Lista */}
            <div className="overflow-y-auto px-4 pb-4 space-y-2" style={{ maxHeight: 'calc(70vh - 120px)' }}>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                </div>
              ) : detalle.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-8">Sin compromisos activos</p>
              ) : (
                detalle.map((d, i) => <DetalleItem key={i} d={d} />)
              )}
            </div>
          </div>

          {/* ── Desktop: popover centrado ── */}
          <div
            className="hidden md:block fixed z-[201] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            style={{ background: '#0f1f3c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(251,191,36,0.1)' }}>
                  <Package size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-black text-white/90">Stock comprometido</p>
                  <p className="text-xs text-white/40">
                    {Number(comprometido).toLocaleString('es-VE')} unidades en cotizaciones activas
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Lista */}
            <div className="max-h-64 overflow-y-auto p-4 space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                </div>
              ) : detalle.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-8">Sin compromisos activos</p>
              ) : (
                detalle.map((d, i) => <DetalleItem key={i} d={d} />)
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
