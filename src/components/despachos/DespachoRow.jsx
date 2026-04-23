// src/components/despachos/DespachoRow.jsx
// Fila compacta de despacho para vista de lista
import { memo } from 'react'
import { Calendar, Eye, FileText } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'

export default memo(function DespachoRow({ despacho, onVer, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const vendedorColor = despacho.vendedor?.color || '#64748b'

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`

  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}${despacho.cotizacion.version > 1 ? ` Rev.${despacho.cotizacion.version}` : ''}`
    : null

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
            <EstadoBadge estado={despacho.estado} />
            {cotNum && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                <FileText size={9} />{cotNum}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
            {despacho.cliente?.nombre && (
              <span className="truncate max-w-[200px] font-medium" style={{ color: despacho.cliente?.vendedor?.color || vendedorColor }}>{despacho.cliente.nombre}</span>
            )}
            {esSupervisor && despacho.vendedor && (
              <>
                <span className="text-slate-300">·</span>
                <span style={{ color: vendedorColor }}>{despacho.vendedor.nombre}</span>
              </>
            )}
          </div>
        </div>

        {/* Fecha */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-slate-400 shrink-0">
          <Calendar size={11} />
          {fmtFecha(despacho.creado_en)}
        </div>

        {/* Total */}
        <div className="text-right shrink-0">
          <span className="font-bold text-slate-800 text-sm">{fmtUsd(despacho.total_usd)}</span>
          {tasa > 0 && despacho.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(despacho.total_usd, tasa))}</div>
          )}
        </div>

        {/* Ver detalle */}
        <div className="shrink-0">
          <button onClick={() => onVer(despacho)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors"
            title="Ver detalle">
            <Eye size={15} />
          </button>
        </div>
      </div>
    </div>
  )
})
