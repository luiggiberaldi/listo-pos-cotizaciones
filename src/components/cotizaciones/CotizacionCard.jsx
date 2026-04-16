// src/components/cotizaciones/CotizacionCard.jsx
import { useState } from 'react'
import { FileText, User, Calendar, Pencil, Ban, CheckCircle, XCircle, FileDown, MessageCircle, Loader2, Truck, ChevronDown, DollarSign, RefreshCw } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import supabase from '../../services/supabase/client'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'

import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'

export default function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado, onDespachar, onReciclar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading] = useState(false)
  const [waLoading, setWaLoading]   = useState(false)
  const [showActions, setShowActions] = useState(false)
  const { data: config = {} } = useConfigNegocio()

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  // ── Descargar PDF ──────────────────────────────────────────────────────────
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
      alert('Error al generar PDF: ' + (err.message || 'Error desconocido'))
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Compartir por WhatsApp (con PDF en móvil) ──────────────────────────────
  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const [{ generarPDF }, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacion.id).order('orden'),
      ])
      if (itemsRes.error) throw itemsRes.error

      // Generar PDF como blob (sin descargar)
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
      // Fallback: solo abrir WhatsApp con mensaje de texto
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

  const vendedorColor = cotizacion.vendedor?.color || null

  // Determinar acciones disponibles
  const canEdit = esBorrador
  const canPdf = cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada'
  const canWhatsApp = cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada'
  const canAcceptReject = esSupervisor && esEnviada
  const canDespachar = esSupervisor && (cotizacion.estado === 'aceptada' || cotizacion.estado === 'enviada') && onDespachar
  const canAnular = esBorrador || (esSupervisor && (cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada'))
  const canReciclar = esSupervisor && ['rechazada', 'anulada', 'vencida'].includes(cotizacion.estado)
  const hasSecondaryActions = canAcceptReject || canDespachar || canAnular || canReciclar

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col"
      style={vendedorColor ? { borderColor: vendedorColor + '60' } : undefined}>

      {/* ── Franja de color del vendedor ── */}
      {vendedorColor && (
        <div className="h-1.5 w-full" style={{ backgroundColor: vendedorColor }} />
      )}

      {/* ── Cabecera: número + estado ── */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm font-mono truncate">{numDisplay}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-sm text-slate-700">
            <User size={13} className="text-slate-400 shrink-0" />
            <span className="truncate font-medium">{cotizacion.cliente?.nombre ?? '—'}</span>
          </div>
        </div>
        <EstadoBadge estado={cotizacion.estado} />
      </div>

      {/* ── Fechas ── */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Calendar size={11} />
            {fmtFecha(cotizacion.creado_en)}
          </span>
          {cotizacion.valida_hasta && (
            <>
              <span className="text-slate-300">·</span>
              <span className={`${new Date(cotizacion.valida_hasta) < new Date() ? 'text-red-400' : 'text-slate-400'}`}>
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
            style={vendedorColor
              ? { backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }
              : { backgroundColor: '#f1f5f9', color: '#475569' }
            }>
            {cotizacion.vendedor.nombre}
          </span>
        </div>
      )}

      {/* ── Acciones principales (siempre visibles) ── */}
      <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
        {canEdit && (
          <button onClick={() => onEditar(cotizacion)} title="Editar borrador"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} />
            Editar
          </button>
        )}
        {canPdf && (
          <button onClick={descargarPDF} disabled={pdfLoading} title="Descargar PDF"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-40">
            {pdfLoading
              ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" />
              : <FileDown size={13} />}
            PDF
          </button>
        )}
        {canWhatsApp && (
          <button onClick={handleWhatsApp} disabled={waLoading} title="Compartir por WhatsApp"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors disabled:opacity-40">
            {waLoading
              ? <div className="w-3 h-3 border-[1.5px] border-emerald-400 border-t-transparent rounded-full animate-spin" />
              : <MessageCircle size={13} />}
            WhatsApp
          </button>
        )}

        {/* Botón "más acciones" para acciones secundarias */}
        {hasSecondaryActions && (
          <div className="relative ml-auto">
            <button
              onClick={() => setShowActions(!showActions)}
              onBlur={() => setTimeout(() => setShowActions(false), 200)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showActions
                  ? 'bg-slate-200 text-slate-700'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
              }`}>
              <ChevronDown size={14} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown de acciones secundarias */}
            {showActions && (
              <div className="absolute right-0 bottom-full mb-1 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20">
                {canAcceptReject && (
                  <>
                    <button onClick={() => { onCambiarEstado(cotizacion.id, 'aceptada'); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors text-left">
                      <CheckCircle size={14} />
                      Aceptar
                    </button>
                    <button onClick={() => { onCambiarEstado(cotizacion.id, 'rechazada'); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
                      <XCircle size={14} />
                      Rechazar
                    </button>
                  </>
                )}
                {canDespachar && (
                  <button onClick={() => { onDespachar(cotizacion); setShowActions(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors text-left">
                    <Truck size={14} />
                    Despachar
                  </button>
                )}
                {canAnular && (
                  <>
                    {(canAcceptReject || canDespachar) && <div className="my-1 border-t border-slate-100" />}
                    <button onClick={() => { onAnular(cotizacion); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors text-left">
                      <Ban size={14} />
                      Anular
                    </button>
                  </>
                )}
                {canReciclar && (
                  <>
                    {(canAcceptReject || canDespachar || canAnular) && <div className="my-1 border-t border-slate-100" />}
                    <button onClick={() => { onReciclar(cotizacion); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors text-left">
                      <RefreshCw size={14} />
                      Reciclar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
