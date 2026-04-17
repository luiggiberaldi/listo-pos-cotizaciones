// src/components/despachos/DespachoCard.jsx
import { useState } from 'react'
import { FileText, User, Calendar, Truck, CheckCircle, Ban, Package, RefreshCcw, Download, Loader2, Eye } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import supabase from '../../services/supabase/client'
import DetalleModal from '../ui/DetalleModal'

export default function DespachoCard({ despacho, onCambiarEstado, onAnular, onReciclar, tasa = 0, config = {} }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)

  const numDisplay = `DES-${String(despacho.numero).padStart(5, '0')}`
  const vendedorColor = despacho.vendedor?.color || '#64748b'

  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}${despacho.cotizacion.version > 1 ? ` Rev.${despacho.cotizacion.version}` : ''}`
    : '—'

  const canDespachar = esSupervisor && despacho.estado === 'pendiente'
  const canEntregada = esSupervisor && despacho.estado === 'despachada'
  const canAnular = esSupervisor && (despacho.estado === 'pendiente' || despacho.estado === 'despachada')
  const canReciclar = esSupervisor && despacho.estado === 'anulada' && onReciclar

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarDespachoPDF }, itemsRes] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', despacho.cotizacion_id).order('orden'),
      ])
      if (itemsRes.error) throw itemsRes.error
      await generarDespachoPDF({ despacho, items: itemsRes.data ?? [], config })
    } catch (err) {
      console.error('PDF error:', err)
      alert('Error al generar PDF: ' + (err.message || 'Error desconocido'))
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-16 shrink-0 flex items-end justify-between px-4 pb-2"
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        {/* Patrón de puntos */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        {/* Número + cliente */}
        <div className="relative z-10 min-w-0">
          <p className="font-black text-white text-sm font-mono leading-tight drop-shadow">{numDisplay}</p>
          {despacho.cliente?.nombre && (
            <p className="text-[11px] font-medium truncate max-w-[160px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {despacho.cliente.nombre}
            </p>
          )}
        </div>
        {/* Estado */}
        <div className="relative z-10 shrink-0">
          <EstadoBadge estado={despacho.estado} />
        </div>
      </div>

      {/* ── Ref. cotización + fechas ── */}
      <div className="px-4 pt-3 pb-2 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <FileText size={11} className="shrink-0" />
          <span className="font-mono">{cotNum}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Calendar size={11} />{fmtFecha(despacho.creado_en)}
          </span>
          {despacho.despachada_en && (
            <><span className="text-slate-300">·</span><span className="text-indigo-400">Despachada {fmtFecha(despacho.despachada_en)}</span></>
          )}
          {despacho.entregada_en && (
            <><span className="text-slate-300">·</span><span className="text-teal-500">Entregada {fmtFecha(despacho.entregada_en)}</span></>
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
            style={{ backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }}>
            {despacho.vendedor.nombre}
          </span>
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
        {/* Ver detalle — siempre visible */}
        <button onClick={() => setShowDetalle(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light transition-colors">
          <Eye size={13} />Ver
        </button>
        {canDespachar && (
          <button onClick={() => onCambiarEstado(despacho.id, 'despachada')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
            <Truck size={13} />Despachar
          </button>
        )}
        {canEntregada && (
          <button onClick={() => onCambiarEstado(despacho.id, 'entregada')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors">
            <CheckCircle size={13} />Entregada
          </button>
        )}
        {canReciclar && (
          <button onClick={() => onReciclar(despacho)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 transition-colors">
            <RefreshCcw size={13} />Reciclar
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={descargarPDF} disabled={pdfLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50">
            {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
          {canAnular && (
            <button onClick={() => onAnular(despacho)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={13} />Anular
            </button>
          )}
        </div>
      </div>

      <DetalleModal
        isOpen={showDetalle}
        onClose={() => setShowDetalle(false)}
        tipo="despacho"
        registro={despacho}
        tasa={tasa}
      />
    </div>
  )
}
