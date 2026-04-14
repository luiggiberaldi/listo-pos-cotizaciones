// src/components/cotizaciones/CotizacionCard.jsx
// src/components/cotizaciones/CotizacionCard.jsx
import { useState } from 'react'
import { FileText, User, Calendar, Pencil, Ban, CheckCircle, XCircle, FileDown, MessageCircle } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
import useAuthStore from '../../store/useAuthStore'
import supabase from '../../services/supabase/client'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { generarPDF } from '../../services/pdf/cotizacionPDF'

function fmtUsd(n) { return `$${Number(n || 0).toFixed(2)}` }
function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading] = useState(false)
  const { data: config = {} } = useConfigNegocio()

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  // ── Descargar PDF ──────────────────────────────────────────────────────────
  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ data: header }, { data: items }] = await Promise.all([
        supabase.from('cotizaciones').select('*').eq('id', cotizacion.id).single(),
        supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacion.id).order('orden'),
      ])
      generarPDF({
        cotizacion: { ...header, cliente: cotizacion.cliente },
        items: items ?? [],
        config,
      })
    } catch (err) {
      console.error('PDF error:', err)
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Compartir por WhatsApp ──────────────────────────────────────────────────
  function compartirWhatsApp() {
    const nombre    = config.nombre_negocio || 'Cotización'
    const cliente   = cotizacion.cliente?.nombre ?? ''
    const total     = `$${Number(cotizacion.total_usd || 0).toFixed(2)}`
    const vencim    = cotizacion.valida_hasta
      ? `\nVálida hasta: ${new Date(cotizacion.valida_hasta + 'T12:00:00').toLocaleDateString('es-VE')}`
      : ''
    const texto = `Hola${cliente ? ` ${cliente}` : ''}, te envío la ${numDisplay} de *${nombre}*.\n\nTotal: *${total}*${vencim}\n\nQuedo a tu disposición para cualquier consulta.`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-amber-200 hover:shadow-md transition-all p-4 flex flex-col gap-3">

      {/* Cabecera: número + estado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <FileText size={14} className="text-amber-500" />
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
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
              <Pencil size={14} />
            </button>
          )}
          {/* PDF — disponible en cotizaciones enviadas/aceptadas/rechazadas */}
          {cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada' && (
            <button onClick={descargarPDF} disabled={pdfLoading} title="Descargar PDF"
              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-40">
              {pdfLoading
                ? <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                : <FileDown size={14} />}
            </button>
          )}
          {/* WhatsApp — disponible en cotizaciones enviadas/aceptadas */}
          {(cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada') && (
            <button onClick={compartirWhatsApp} title="Compartir por WhatsApp"
              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
              <MessageCircle size={14} />
            </button>
          )}
          {/* Supervisor puede marcar como aceptada/rechazada */}
          {esSupervisor && esEnviada && (
            <>
              <button onClick={() => onCambiarEstado(cotizacion.id, 'aceptada')} title="Marcar aceptada"
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 transition-colors">
                <CheckCircle size={14} />
              </button>
              <button onClick={() => onCambiarEstado(cotizacion.id, 'rechazada')} title="Marcar rechazada"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <XCircle size={14} />
              </button>
            </>
          )}
          {(esBorrador || (esSupervisor && cotizacion.estado !== 'anulada')) && (
            <button onClick={() => onAnular(cotizacion)} title="Anular"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={14} />
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
        <span className="font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
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
