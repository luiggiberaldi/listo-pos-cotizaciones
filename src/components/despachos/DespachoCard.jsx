// src/components/despachos/DespachoCard.jsx
// Tarjeta de nota de despacho para la vista de lista
import { FileText, User, Calendar, Truck, CheckCircle, Ban, Package, RefreshCcw } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'

export default function DespachoCard({ despacho, onCambiarEstado, onAnular, onReciclar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  const numDisplay = `DES-${String(despacho.numero).padStart(5, '0')}`
  const vendedorColor = despacho.vendedor?.color || null

  // Referencia a la cotización original
  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}${despacho.cotizacion.version > 1 ? ` Rev.${despacho.cotizacion.version}` : ''}`
    : '—'

  const canDespachar = esSupervisor && despacho.estado === 'pendiente'
  const canEntregada = esSupervisor && despacho.estado === 'despachada'
  const canAnular = esSupervisor && (despacho.estado === 'pendiente' || despacho.estado === 'despachada')
  const canReciclar = esSupervisor && despacho.estado === 'anulada' && onReciclar
  const hasActions = canDespachar || canEntregada || canAnular || canReciclar

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50 transition-all duration-200 overflow-hidden flex flex-col"
      style={vendedorColor ? { borderLeftWidth: '4px', borderLeftColor: vendedorColor } : undefined}>

      {/* ── Cabecera: número + estado ── */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-indigo-500 shrink-0" />
            <span className="font-bold text-slate-800 text-sm font-mono truncate">{numDisplay}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-slate-700">
            <User size={13} className="text-slate-400 shrink-0" />
            <span className="truncate font-medium">{despacho.cliente?.nombre ?? '—'}</span>
          </div>
        </div>
        <EstadoBadge estado={despacho.estado} />
      </div>

      {/* ── Referencia cotización + fecha ── */}
      <div className="px-4 pb-3 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <FileText size={11} className="shrink-0" />
          <span className="font-mono">{cotNum}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Calendar size={11} />
            {fmtFecha(despacho.creado_en)}
          </span>
          {despacho.despachada_en && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-indigo-400">Despachada {fmtFecha(despacho.despachada_en)}</span>
            </>
          )}
          {despacho.entregada_en && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-teal-500">Entregada {fmtFecha(despacho.entregada_en)}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Total ── */}
      <div className="mx-4 mb-3 bg-slate-50 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Total</span>
        <div className="text-right">
          <span className="text-base font-bold text-slate-800">{fmtUsd(despacho.total_usd)}</span>
          {tasa > 0 && despacho.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(despacho.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* ── Vendedor (solo supervisor) ── */}
      {esSupervisor && despacho.vendedor && (
        <div className="px-4 pb-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={vendedorColor
              ? { backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }
              : { backgroundColor: '#f1f5f9', color: '#475569' }
            }>
            {despacho.vendedor.nombre}
          </span>
        </div>
      )}

      {/* ── Acciones (solo supervisor, barra inferior) ── */}
      {hasActions && (
        <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
          {canDespachar && (
            <button onClick={() => onCambiarEstado(despacho.id, 'despachada')} title="Marcar como despachada"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 transition-colors">
              <Truck size={13} />
              Despachar
            </button>
          )}
          {canEntregada && (
            <button onClick={() => onCambiarEstado(despacho.id, 'entregada')} title="Marcar como entregada"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
              <CheckCircle size={13} />
              Entregada
            </button>
          )}
          {canReciclar && (
            <button onClick={() => onReciclar(despacho)} title="Reciclar como cotización borrador"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
              <RefreshCcw size={13} />
              Reciclar
            </button>
          )}
          {canAnular && (
            <button onClick={() => onAnular(despacho)} title="Anular despacho"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors ml-auto">
              <Ban size={13} />
              Anular
            </button>
          )}
        </div>
      )}
    </div>
  )
}
