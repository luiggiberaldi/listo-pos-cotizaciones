// src/components/cotizaciones/CotizacionCard.jsx
import { useState } from 'react'
import { FileText, User, Calendar, Pencil, Ban, CheckCircle, XCircle, FileDown, MessageCircle, Loader2, Truck, ChevronDown, DollarSign, RefreshCw, Eye } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import supabase from '../../services/supabase/client'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import DetalleModal from '../ui/DetalleModal'
import { showToast } from '../ui/Toast'

export default function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado, onDespachar, onReciclar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [waLoading, setWaLoading]     = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const { data: config = {} } = useConfigNegocio()

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarPDF }, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacion.id).order('orden'),
      ])
      if (itemsRes.error) throw itemsRes.error
      await generarPDF({ cotizacion, items: itemsRes.data ?? [], config })
    } catch (err) {
      console.error('PDF error:', err)
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const [{ generarPDF }, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacion.id).order('orden'),
      ])
      if (itemsRes.error) throw itemsRes.error
      const pdfBlob = await generarPDF({ cotizacion, items: itemsRes.data ?? [], config, returnBlob: true })
      const mensaje = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: cotizacion.cliente?.nombre,
        numDisplay,
        totalUsd: cotizacion.total_usd,
        validaHasta: cotizacion.valida_hasta,
      })
      await compartirPorWhatsApp({
        pdfBlob,
        pdfFilename: `${numDisplay.replace(/\s+/g, '_')}.pdf`,
        telefono: cotizacion.cliente?.telefono,
        mensaje,
      })
    } catch (err) {
      console.error('WhatsApp error:', err)
      const texto = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: cotizacion.cliente?.nombre,
        numDisplay,
        totalUsd: cotizacion.total_usd,
        validaHasta: cotizacion.valida_hasta,
      })
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
    } finally {
      setWaLoading(false)
    }
  }

  const vendedorColor = cotizacion.vendedor?.color || '#64748b'
  const canEdit = esBorrador
  const canPdf = cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada'
  const canWhatsApp = cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada'
  const canAcceptReject = esSupervisor && esEnviada
  const canDespachar = esSupervisor && (cotizacion.estado === 'aceptada' || cotizacion.estado === 'enviada') && onDespachar
  const canAnular = esBorrador || (esSupervisor && (cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada'))
  const canReciclar = esSupervisor && ['rechazada', 'anulada', 'vencida'].includes(cotizacion.estado)
  const hasSecondaryActions = canAcceptReject || canDespachar || canAnular || canReciclar

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
          {cotizacion.cliente?.nombre && (
            <p className="text-[11px] font-medium truncate max-w-[160px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {cotizacion.cliente.nombre}
            </p>
          )}
        </div>
        {/* Estado badge adaptado */}
        <div className="relative z-10 shrink-0">
          <EstadoBadge estado={cotizacion.estado} />
        </div>
      </div>

      {/* ── Fechas ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Calendar size={11} />
            {fmtFecha(cotizacion.creado_en)}
          </span>
          {cotizacion.valida_hasta && (
            <>
              <span className="text-slate-300">·</span>
              <span className={new Date(cotizacion.valida_hasta) < new Date() ? 'text-red-400' : 'text-slate-400'}>
                Vence {fmtFecha(cotizacion.valida_hasta)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Total ── */}
      <div className="mx-4 mb-3 bg-slate-50 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Total</span>
        <div className="text-right">
          <span className="text-base font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
          {tasa > 0 && cotizacion.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* ── Vendedor (solo supervisor) ── */}
      {esSupervisor && cotizacion.vendedor && (
        <div className="px-4 pb-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }}>
            {cotizacion.vendedor.nombre}
          </span>
        </div>
      )}

      {/* ── Acciones principales ── */}
      <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
        {/* Ver detalle — siempre visible */}
        <button onClick={() => setShowDetalle(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light transition-colors">
          <Eye size={13} />Ver
        </button>
        {canEdit && (
          <button onClick={() => onEditar(cotizacion)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} />Editar
          </button>
        )}
        {canPdf && (
          <button onClick={descargarPDF} disabled={pdfLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40">
            {pdfLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <FileDown size={13} />}
            PDF
          </button>
        )}
        {canWhatsApp && (
          <button onClick={handleWhatsApp} disabled={waLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40">
            {waLoading ? <div className="w-3 h-3 border-[1.5px] border-emerald-400 border-t-transparent rounded-full animate-spin" /> : <MessageCircle size={13} />}
            WhatsApp
          </button>
        )}

        {hasSecondaryActions && (
          <div className="relative ml-auto">
            <button
              onClick={() => setShowActions(!showActions)}
              onBlur={() => setTimeout(() => setShowActions(false), 200)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showActions ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
              }`}>
              <ChevronDown size={14} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
            </button>
            {showActions && (
              <div className="absolute right-0 bottom-full mb-1 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20">
                {canAcceptReject && (
                  <>
                    <button onClick={() => { onCambiarEstado(cotizacion.id, 'aceptada'); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors text-left">
                      <CheckCircle size={14} />Aceptar
                    </button>
                    <button onClick={() => { onCambiarEstado(cotizacion.id, 'rechazada'); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
                      <XCircle size={14} />Rechazar
                    </button>
                  </>
                )}
                {canDespachar && (
                  <button onClick={() => { onDespachar(cotizacion); setShowActions(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors text-left">
                    <Truck size={14} />Despachar
                  </button>
                )}
                {canAnular && (
                  <>
                    {(canAcceptReject || canDespachar) && <div className="my-1 border-t border-slate-100" />}
                    <button onClick={() => { onAnular(cotizacion); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors text-left">
                      <Ban size={14} />Anular
                    </button>
                  </>
                )}
                {canReciclar && (
                  <>
                    {(canAcceptReject || canDespachar || canAnular) && <div className="my-1 border-t border-slate-100" />}
                    <button onClick={() => { onReciclar(cotizacion); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors text-left">
                      <RefreshCw size={14} />Reciclar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <DetalleModal
        isOpen={showDetalle}
        onClose={() => setShowDetalle(false)}
        tipo="cotizacion"
        registro={cotizacion}
        tasa={tasa}
      />
    </div>
  )
}
