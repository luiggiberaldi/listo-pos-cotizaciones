// src/components/cotizaciones/CotizacionCard.jsx
import { useState } from 'react'
import { FileText, User, Calendar, Pencil, Ban, CheckCircle, XCircle, FileDown, MessageCircle, Loader2, Truck } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import supabase from '../../services/supabase/client'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'

import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'

export default function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado, onDespachar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading] = useState(false)
  const [waLoading, setWaLoading]   = useState(false)
  const { data: config = {} } = useConfigNegocio()

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  // ── Descargar PDF ──────────────────────────────────────────────────────────
  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarPDF }, headerRes, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizaciones').select('*').eq('id', cotizacion.id).single(),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacion.id).order('orden'),
      ])
      if (headerRes.error) throw headerRes.error
      if (itemsRes.error) throw itemsRes.error
      generarPDF({
        cotizacion: { ...headerRes.data, cliente: cotizacion.cliente },
        items: itemsRes.data ?? [],
        config,
      })
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
      const [{ generarPDF }, headerRes, itemsRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizaciones').select('*').eq('id', cotizacion.id).single(),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacion.id).order('orden'),
      ])
      if (headerRes.error) throw headerRes.error
      if (itemsRes.error) throw itemsRes.error

      // Generar PDF como blob (sin descargar)
      const pdfBlob = generarPDF({
        cotizacion: { ...headerRes.data, cliente: cotizacion.cliente },
        items: itemsRes.data ?? [],
        config,
        returnBlob: true,
      })

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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-primary-light hover:shadow-md transition-all p-4 flex flex-col gap-3">

      {/* Cabecera: número + estado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <FileText size={14} className="text-primary" />
            <span className="font-bold text-slate-800 text-sm font-mono">{numDisplay}</span>
          </div>
          <div className="mt-1">
            <EstadoBadge estado={cotizacion.estado} />
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-1 shrink-0">
          {esBorrador && (
            <button onClick={() => onEditar(cotizacion)} title="Editar borrador"
              className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
              <Pencil size={16} />
            </button>
          )}
          {/* PDF — disponible en cotizaciones enviadas/aceptadas/rechazadas */}
          {cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada' && (
            <button onClick={descargarPDF} disabled={pdfLoading} title="Descargar PDF"
              className="p-2 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-40">
              {pdfLoading
                ? <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                : <FileDown size={16} />}
            </button>
          )}
          {/* WhatsApp — disponible en cotizaciones enviadas/aceptadas */}
          {(cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada') && (
            <button onClick={handleWhatsApp} disabled={waLoading} title="Compartir por WhatsApp"
              className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40">
              {waLoading
                ? <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                : <MessageCircle size={16} />}
            </button>
          )}
          {/* Supervisor puede marcar como aceptada/rechazada */}
          {esSupervisor && esEnviada && (
            <>
              <button onClick={() => onCambiarEstado(cotizacion.id, 'aceptada')} title="Marcar aceptada"
                className="p-2 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 transition-colors">
                <CheckCircle size={16} />
              </button>
              <button onClick={() => onCambiarEstado(cotizacion.id, 'rechazada')} title="Marcar rechazada"
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <XCircle size={16} />
              </button>
            </>
          )}
          {/* Supervisor puede despachar cotizaciones enviadas o aceptadas */}
          {esSupervisor && (cotizacion.estado === 'aceptada' || cotizacion.estado === 'enviada') && onDespachar && (
            <button onClick={() => onDespachar(cotizacion)} title="Crear nota de despacho"
              className="p-2 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
              <Truck size={16} />
            </button>
          )}
          {(esBorrador || (esSupervisor && cotizacion.estado !== 'anulada')) && (
            <button onClick={() => onAnular(cotizacion)} title="Anular"
              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Cliente */}
      <div className="flex items-center gap-1.5 text-sm text-slate-600">
        <User size={13} className="text-slate-400 shrink-0" />
        <span className="truncate font-medium">{cotizacion.cliente?.nombre ?? '—'}</span>
      </div>

      {/* Fecha */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Calendar size={12} />
        <span>{fmtFecha(cotizacion.creado_en)}</span>
        {cotizacion.valida_hasta && (
          <span className="ml-1">· válida hasta {fmtFecha(cotizacion.valida_hasta)}</span>
        )}
      </div>

      {/* Total */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-400">Total</span>
        <div className="text-right">
          <span className="font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
          {tasa > 0 && cotizacion.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* Vendedor (solo supervisor) */}
      {esSupervisor && cotizacion.vendedor && (
        <div className="flex items-center justify-between -mt-1">
          <span className="text-xs text-slate-400">Vendedor</span>
          <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            {cotizacion.vendedor.nombre}
          </span>
        </div>
      )}
    </div>
  )
}
