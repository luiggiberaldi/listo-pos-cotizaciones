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

  // Referencia a la cotización original
  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}${despacho.cotizacion.version > 1 ? ` Rev.${despacho.cotizacion.version}` : ''}`
    : '—'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all p-4 flex flex-col gap-3">

      {/* Cabecera: número + estado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Package size={14} className="text-indigo-500" />
            <span className="font-bold text-slate-800 text-sm font-mono">{numDisplay}</span>
          </div>
          <div className="mt-1">
            <EstadoBadge estado={despacho.estado} />
          </div>
        </div>

        {/* Acciones (solo supervisor) */}
        {esSupervisor && (
          <div className="flex items-center gap-1 shrink-0">
            {/* Pendiente: marcar despachada */}
            {despacho.estado === 'pendiente' && (
              <button onClick={() => onCambiarEstado(despacho.id, 'despachada')} title="Marcar como despachada"
                className="p-2 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
                <Truck size={16} />
              </button>
            )}
            {/* Despachada: marcar entregada */}
            {despacho.estado === 'despachada' && (
              <button onClick={() => onCambiarEstado(despacho.id, 'entregada')} title="Marcar como entregada"
                className="p-2 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 transition-colors">
                <CheckCircle size={16} />
              </button>
            )}
            {/* Pendiente o Despachada: anular (restaura stock) */}
            {(despacho.estado === 'pendiente' || despacho.estado === 'despachada') && (
              <button onClick={() => onAnular(despacho)} title="Anular despacho"
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <Ban size={16} />
              </button>
            )}
            {/* Anulada: reciclar (nueva cotización borrador) */}
            {despacho.estado === 'anulada' && onReciclar && (
              <button onClick={() => onReciclar(despacho)} title="Reciclar como cotización borrador"
                className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
                <RefreshCcw size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cliente */}
      <div className="flex items-center gap-1.5 text-sm text-slate-600">
        <User size={13} className="text-slate-400 shrink-0" />
        <span className="truncate font-medium">{despacho.cliente?.nombre ?? '—'}</span>
      </div>

      {/* Referencia cotización */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <FileText size={12} />
        <span>{cotNum}</span>
      </div>

      {/* Fecha */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Calendar size={12} />
        <span>{fmtFecha(despacho.creado_en)}</span>
        {despacho.despachada_en && (
          <span className="ml-1">· despachada {fmtFecha(despacho.despachada_en)}</span>
        )}
        {despacho.entregada_en && (
          <span className="ml-1">· entregada {fmtFecha(despacho.entregada_en)}</span>
        )}
      </div>

      {/* Total */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">Total</span>
        <div className="text-right">
          <span className="font-bold text-slate-800">{fmtUsd(despacho.total_usd)}</span>
          {tasa > 0 && despacho.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(despacho.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* Vendedor (solo supervisor) */}
      {esSupervisor && despacho.vendedor && (
        <div className="flex items-center justify-between -mt-1">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            {despacho.vendedor.nombre}
          </span>
        </div>
      )}
    </div>
  )
}
