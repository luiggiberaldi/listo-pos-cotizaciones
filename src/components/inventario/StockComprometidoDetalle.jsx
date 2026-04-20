// src/components/inventario/StockComprometidoDetalle.jsx
// Popover que muestra el desglose de stock comprometido por vendedor/cotización
import { useState } from 'react'
import { Users, X, FileText } from 'lucide-react'
import { useStockComprometidoDetalle } from '../../hooks/useStockComprometido'

export default function StockComprometidoDetalle({ productoId, comprometido }) {
  const [open, setOpen] = useState(false)
  const { data: detalle = [], isLoading } = useStockComprometidoDetalle(open ? productoId : null)

  if (!comprometido || comprometido <= 0) return null

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(!open) }}
        className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-semibold hover:text-amber-700 hover:underline transition-colors"
      >
        <Users size={10} />
        {Number(comprometido).toLocaleString('es-VE')} comprometidas
      </button>

      {open && (
        <>
          {/* Backdrop móvil */}
          <div className="fixed inset-0 z-[100] md:hidden" onClick={() => setOpen(false)} />

          {/* Popover */}
          <div
            className="absolute z-[101] bottom-full mb-2 left-0 w-64 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{ background: '#1a2744', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <span className="text-[11px] font-bold text-white/70">Stock comprometido</span>
              <button onClick={() => setOpen(false)} className="p-0.5 text-white/30 hover:text-white/70">
                <X size={12} />
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto p-2 space-y-1.5">
              {isLoading ? (
                <p className="text-[11px] text-white/40 text-center py-3">Cargando...</p>
              ) : detalle.length === 0 ? (
                <p className="text-[11px] text-white/40 text-center py-3">Sin compromisos activos</p>
              ) : (
                detalle.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-white/80 truncate">{d.vendedor_nombre}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <FileText size={9} className="text-white/30" />
                        <span className="text-[10px] text-white/40">COT-{d.cotizacion_numero}</span>
                        <span className="text-[10px] text-white/30">·</span>
                        <span className="text-[10px] text-white/40">{d.cotizacion_estado}</span>
                      </div>
                    </div>
                    <span className="text-[11px] font-black text-amber-400 shrink-0">
                      {Number(d.cantidad).toLocaleString('es-VE')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
