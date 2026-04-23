// src/components/cotizaciones/ReciclarCotizacionModal.jsx
// Modal dedicado para reutilizar una cotización rechazada/anulada/vencida
// Carga y muestra los items reales de la cotización para confirmar
import { useState, useEffect } from 'react'
import { RefreshCw, Loader2, FileText, User, DollarSign, ChevronRight, Package, AlertCircle } from 'lucide-react'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import EstadoBadge from './EstadoBadge'
import supabase from '../../services/supabase/client'

export default function ReciclarCotizacionModal({
  isOpen,
  cotizacion,
  vendedores = [],
  vendedorSeleccionado,
  onVendedorChange,
  onConfirm,
  onClose,
  isPending = false,
}) {
  const [items, setItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)

  // Cargar items reales de la cotización al abrir
  useEffect(() => {
    if (!isOpen || !cotizacion?.id) {
      setItems([])
      return
    }
    setLoadingItems(true)
    supabase
      .from('cotizacion_items')
      .select('nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden')
      .eq('cotizacion_id', cotizacion.id)
      .order('orden')
      .then(({ data, error }) => {
        if (!error && data) setItems(data)
        setLoadingItems(false)
      })
  }, [isOpen, cotizacion?.id])

  if (!isOpen || !cotizacion) return null

  const numDisplay = `COT-${String(cotizacion.numero).padStart(5, '0')}`
  const vendedorOriginal = cotizacion.vendedor
  const vendedorOriginalColor = vendedorOriginal?.color || '#64748b'

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-white w-full sm:max-w-md sm:rounded-[1.5rem] rounded-t-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 max-h-[90dvh] flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header con color teal ── */}
        <div className="relative h-20 sm:h-24 flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #5eead4 0%, #0d9488 100%)' }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '12px 12px',
            }} />
          <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: '1.5px solid rgba(255,255,255,0.5)',
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            }}>
            <RefreshCw size={24} color="white" />
          </div>
          <button onClick={onClose} disabled={isPending}
            className="absolute top-3 right-3 p-1.5 rounded-full transition-colors disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)', color: 'white' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Content ── */}
        <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-4 min-h-0">
          <div className="text-center">
            <h3 className="text-lg font-black text-slate-800">Reutilizar cotización</h3>
            <p className="text-sm text-slate-500 mt-1">Se creará un nuevo borrador con los mismos productos</p>
          </div>

          {/* ── Resumen de la cotización original ── */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-slate-400" />
                <span className="text-sm font-bold font-mono text-slate-800">{numDisplay}</span>
              </div>
              <EstadoBadge estado={cotizacion.estado} />
            </div>

            {cotizacion.cliente?.nombre && (
              <div className="flex items-center gap-2">
                <User size={14} className="text-slate-400" />
                <span className="text-sm text-slate-700">{cotizacion.cliente.nombre}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign size={14} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
              </div>
              {vendedorOriginal && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: vendedorOriginalColor + '18', color: vendedorOriginalColor, border: `1px solid ${vendedorOriginalColor}40` }}>
                  {vendedorOriginal.nombre}
                </span>
              )}
            </div>
          </div>

          {/* ── Items de la cotización ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 ml-1">
              <Package size={12} className="text-slate-400" />
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Productos a copiar ({loadingItems ? '...' : items.length})
              </label>
            </div>
            {loadingItems ? (
              <div className="flex items-center justify-center py-4 text-slate-400">
                <Loader2 size={16} className="animate-spin mr-2" />
                <span className="text-xs">Cargando productos...</span>
              </div>
            ) : items.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle size={14} className="text-amber-500 shrink-0" />
                <span className="text-xs text-amber-700">No se encontraron productos en esta cotización</span>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-36 overflow-y-auto">
                  {items.map((item, idx) => (
                    <div key={idx} className={`flex items-center gap-2 px-3 py-2 text-xs ${idx > 0 ? 'border-t border-slate-100' : ''}`}>
                      <span className="flex-1 text-slate-700 truncate font-medium">{item.nombre_snap}</span>
                      <span className="text-slate-400 shrink-0">{item.cantidad} {item.unidad_snap}</span>
                      <span className="text-slate-600 font-semibold shrink-0 w-20 text-right">{fmtUsd(item.total_linea_usd)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Selector de vendedor ── */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Asignar a vendedor</label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {vendedores.map(v => {
                const isSelected = vendedorSeleccionado === v.id
                const isOriginal = v.id === cotizacion.vendedor_id
                const vColor = v.color || '#64748b'
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onVendedorChange(v.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all active:scale-[0.98] ${
                      isSelected
                        ? 'bg-teal-50 border-2 border-teal-400 shadow-sm'
                        : 'bg-white border border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: vColor }}>
                      {v.nombre?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-semibold block truncate ${isSelected ? 'text-teal-700' : 'text-slate-700'}`}>
                        {v.nombre}
                      </span>
                      {isOriginal && (
                        <span className="text-[10px] text-slate-400">Vendedor original</span>
                      )}
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Explicación ── */}
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-teal-50/50 border border-teal-100">
            <ChevronRight size={14} className="text-teal-500 shrink-0 mt-0.5" />
            <p className="text-xs text-teal-700 leading-relaxed">
              Nuevo número de correlativo. La cotización original no se modifica.
            </p>
          </div>
        </div>

        {/* ── Botones ── */}
        <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-2 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors border border-slate-100 disabled:opacity-50 min-h-[48px]"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!vendedorSeleccionado || isPending || loadingItems || items.length === 0}
            className="flex-1 py-3 text-sm font-bold text-white rounded-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
            style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', boxShadow: '0 4px 12px rgba(13,148,136,0.3)' }}
          >
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Creando...</>
            ) : (
              <><RefreshCw size={16} /> Reutilizar</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
