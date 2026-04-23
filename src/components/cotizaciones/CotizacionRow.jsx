// src/components/cotizaciones/CotizacionRow.jsx
// Fila compacta de cotización para vista de lista
import { memo } from 'react'
import { Calendar, Eye, Pencil, Clock, Truck, PackageCheck, XCircle } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'

export default memo(function CotizacionRow({ cotizacion, onEditar, onVer, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esPropietario = cotizacion.vendedor_id === perfil?.id
  const canVersion = !esBorrador && ['enviada', 'aceptada', 'rechazada'].includes(cotizacion.estado) && (!esSupervisor || esPropietario)
  const vendedorColor = cotizacion.vendedor?.color || '#64748b'
  const despacho = cotizacion.despacho

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:shadow-md transition-all flex items-stretch overflow-hidden">
      {/* Barra lateral color vendedor */}
      <div className="w-1 shrink-0" style={{ background: vendedorColor }} />

      {/* Info principal */}
      <div className="min-w-0 flex-1 px-3 py-2.5 flex items-center gap-3">
        {/* Número + cliente */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-800 text-sm font-mono">{numDisplay}</span>
            <EstadoBadge estado={cotizacion.estado} />
            {despacho && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                despacho.estado === 'entregada' ? 'bg-emerald-100 text-emerald-700' :
                despacho.estado === 'despachada' ? 'bg-blue-100 text-blue-700' :
                despacho.estado === 'anulada' ? 'bg-red-100 text-red-600' :
                'bg-indigo-100 text-indigo-700'
              }`}>
                {despacho.estado === 'pendiente' ? <><Clock size={9} /> Desp.</> :
                 despacho.estado === 'despachada' ? <><Truck size={9} /> Enviado</> :
                 despacho.estado === 'entregada' ? <><PackageCheck size={9} /> Entregado</> :
                 despacho.estado === 'anulada' ? <><XCircle size={9} /> Anulado</> : despacho.estado}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
            {cotizacion.cliente?.nombre && (
              <span className="truncate max-w-[200px] font-medium" style={{ color: cotizacion.cliente?.vendedor?.color || vendedorColor }}>{cotizacion.cliente.nombre}</span>
            )}
            {esSupervisor && cotizacion.vendedor && (
              <>
                <span className="text-slate-300">·</span>
                <span style={{ color: vendedorColor }}>{cotizacion.vendedor.nombre}</span>
              </>
            )}
          </div>
        </div>

        {/* Fecha */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-slate-400 shrink-0">
          <Calendar size={11} />
          {fmtFecha(cotizacion.creado_en)}
        </div>

        {/* Total */}
        <div className="text-right shrink-0">
          <span className="font-bold text-slate-800 text-sm">{fmtUsd(cotizacion.total_usd)}</span>
          {tasa > 0 && cotizacion.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
          )}
        </div>

        {/* Acciones compactas */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onVer(cotizacion)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors"
            title="Ver detalle">
            <Eye size={15} />
          </button>
          {(esBorrador || canVersion) && (
            <button onClick={() => onEditar(cotizacion)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
              title={esBorrador ? 'Editar' : 'Revisar'}>
              <Pencil size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
