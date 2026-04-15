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

  const vendedorColor = cotizacion.vendedor?.color || null

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-primary-light hover:shadow-md transition-all p-4 flex flex-col gap-3"
      style={vendedorColor ? { borderLeftWidth: '4px', borderLeftColor: vendedorColor } : undefined}>

      {/* Cabecera: número + estado */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText size={14} className="text-primary shrink-0" />
          <span className="font-bold text-slate-800 text-base font-mono truncate">{numDisplay}</span>
        </div>
        <EstadoBadge estado={cotizacion.estado} />
      </div>

      {/* Barra de acciones */}
      <div className="flex items-center gap-1 flex-wrap">
        {esBorrador && (
          <button onClick={() => onEditar(cotizacion)} title="Editar borrador"
            className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-primary hover:bg-primary-light transition-colors">
            <span className="flex items-center gap-1.5">
              <Pencil size={15} />
              <span className="text-sm font-medium">Editar</span>
            </span>
          </button>
        )}
        {/* PDF — disponible en cotizaciones enviadas/aceptadas/rechazadas */}
        {cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada' && (
          <button onClick={descargarPDF} disabled={pdfLoading} title="Descargar PDF"
            className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-40">
            <span className="flex items-center gap-1.5">
              {pdfLoading
                ? <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                : <FileDown size={15} />}
              <span className="text-sm font-medium">PDF</span>
            </span>
          </button>
        )}
        {/* WhatsApp — disponible en cotizaciones enviadas/aceptadas */}
        {(cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada') && (
          <button onClick={handleWhatsApp} disabled={waLoading} title="Compartir por WhatsApp"
            className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40">
            <span className="flex items-center gap-1.5">
              {waLoading
                ? <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                : <MessageCircle size={15} />}
              <span className="text-sm font-medium">WhatsApp</span>
            </span>
          </button>
        )}
        {/* Supervisor puede marcar como aceptada/rechazada */}
        {esSupervisor && esEnviada && (
          <>
            <button onClick={() => onCambiarEstado(cotizacion.id, 'aceptada')} title="Marcar aceptada"
              className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 transition-colors">
              <span className="flex items-center gap-1.5">
                <CheckCircle size={15} />
                <span className="text-sm font-medium">Aceptar</span>
              </span>
            </button>
            <button onClick={() => onCambiarEstado(cotizacion.id, 'rechazada')} title="Marcar rechazada"
              className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors">
              <span className="flex items-center gap-1.5">
                <XCircle size={15} />
                <span className="text-sm font-medium">Rechazar</span>
              </span>
            </button>
          </>
        )}
        {/* Supervisor puede despachar cotizaciones enviadas o aceptadas */}
        {esSupervisor && (cotizacion.estado === 'aceptada' || cotizacion.estado === 'enviada') && onDespachar && (
          <button onClick={() => onDespachar(cotizacion)} title="Crear nota de despacho"
            className="px-2.5 py-2 rounded-lg text-slate-500 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
            <span className="flex items-center gap-1.5">
              <Truck size={15} />
              <span className="text-sm font-medium">Despachar</span>
            </span>
          </button>
        )}
        {(esBorrador || (esSupervisor && cotizacion.estado !== 'anulada')) && (
          <button onClick={() => onAnular(cotizacion)} title="Anular"
            className="ml-auto px-2.5 py-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors">
            <span className="flex items-center gap-1.5">
              <Ban size={15} />
              <span className="text-sm font-medium">Anular</span>
            </span>
          </button>
        )}
      </div>

      {/* Cliente */}
      <div className="flex items-center gap-1.5 text-base text-slate-600">
        <User size={13} className="text-slate-500 shrink-0" />
        <span className="truncate font-medium">{cotizacion.cliente?.nombre ?? '—'}</span>
      </div>

      {/* Fecha */}
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <Calendar size={12} />
        <span>{fmtFecha(cotizacion.creado_en)}</span>
        {cotizacion.valida_hasta && (
          <span className="ml-1">· válida hasta {fmtFecha(cotizacion.valida_hasta)}</span>
        )}
      </div>

      {/* Total */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-sm text-slate-500">Total</span>
        <div className="text-right">
          <span className="font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
          {tasa > 0 && cotizacion.total_usd > 0 && (
            <div className="text-sm text-slate-500">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* Vendedor (solo supervisor) */}
      {esSupervisor && cotizacion.vendedor && (
        <div className="flex items-center justify-between -mt-1">
          <span className="text-sm text-slate-500">Vendedor</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={vendedorColor
              ? { backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }
              : { backgroundColor: '#f1f5f9', color: '#475569' }
            }>
            {cotizacion.vendedor.nombre}
          </span>
        </div>
      )}
    </div>
  )
}
