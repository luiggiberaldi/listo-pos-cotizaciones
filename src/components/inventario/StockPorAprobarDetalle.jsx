// src/components/inventario/StockPorAprobarDetalle.jsx (OP-2026-087)
// Etiqueta "N por aprobar" y ventana con el detalle de los despachos pendientes.
// Es solo un aviso: esas unidades NO se restan del stock disponible.
import { useState, useEffect } from 'react'
import { Clock, X } from 'lucide-react'
import { useStockPorAprobarDetalle } from '../../hooks/useStockPorAprobar'

const fmt = n => Number(n).toLocaleString('es-VE')

export default function StockPorAprobarDetalle({ productoId, porAprobar }) {
  const [open, setOpen] = useState(false)
  const { data: detalle = [], isLoading } = useStockPorAprobarDetalle(open ? productoId : null)

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  if (!porAprobar || porAprobar <= 0) return null

  return (
    <>
      <button
        type="button"
        data-testid="por-aprobar-etiqueta"
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}
        className="inline-flex items-center gap-1 text-[10px] text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-md font-semibold hover:bg-sky-100 transition-colors"
      >
        <Clock size={10} />
        {fmt(porAprobar)} por aprobar
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={e => { e.stopPropagation(); setOpen(false) }} />
          <div
            className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm rounded-2xl shadow-2xl bg-white border border-slate-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <p className="text-sm font-black text-slate-800">Despachos por aprobar</p>
                <p className="text-xs text-slate-500">
                  {fmt(porAprobar)} unidades. Siguen en el stock hasta que se aprueben; aún pueden rechazarse.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-3 space-y-2">
              {isLoading ? (
                <p className="text-sm text-slate-400 text-center py-6">Cargando…</p>
              ) : detalle.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Sin despachos por aprobar</p>
              ) : detalle.map((d, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{d.vendedor_nombre || 'Sin vendedor'}</p>
                    <p className="text-xs text-slate-500">DES-{d.despacho_numero}</p>
                  </div>
                  <span className="text-base font-black text-sky-600 shrink-0">{fmt(d.cantidad)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}
