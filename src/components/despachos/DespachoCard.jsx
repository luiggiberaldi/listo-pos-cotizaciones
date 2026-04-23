// src/components/despachos/DespachoCard.jsx
import { useState, memo } from 'react'
import { FileText, Calendar, Truck, CheckCircle, Ban, RefreshCcw, Download, Loader2, Eye, MoreHorizontal } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import DespachoFlowIndicator from './DespachoFlowIndicator'
import MobileActionSheet from '../cotizaciones/MobileActionSheet'
import ConfirmModal from '../ui/ConfirmModal'
import useAuthStore from '../../store/useAuthStore'
import { getDespachoAction, PRIMARY_ACTION_COLORS } from '../../utils/despachoActions'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import supabase from '../../services/supabase/client'
import DetalleModal from '../ui/DetalleModal'
import { showToast } from '../ui/Toast'

export default memo(function DespachoCard({ despacho, onCambiarEstado, onAnular, onReciclar, tasa = 0, config = {}, estadoCambiando = false }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const rol = perfil?.rol || 'vendedor'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const [showSheet, setShowSheet]     = useState(false)
  const [accionPendiente, setAccionPendiente] = useState(null) // { id, estado, actionConfig }

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`
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
      const [{ generarDespachoPDF }, itemsRes, clienteRes, vendedorRes, transportistaRes] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        supabase.from('cotizacion_items').select('codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden').eq('cotizacion_id', despacho.cotizacion_id).order('orden'),
        despacho.cliente_id ? supabase.from('clientes').select('id, nombre, rif_cedula, telefono, direccion').eq('id', despacho.cliente_id).single() : Promise.resolve({ data: null }),
        despacho.vendedor_id ? supabase.from('usuarios').select('id, nombre, color').eq('id', despacho.vendedor_id).single() : Promise.resolve({ data: null }),
        despacho.transportista_id ? supabase.from('transportistas').select('id, nombre, rif, telefono').eq('id', despacho.transportista_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const desConDatos = {
        ...despacho,
        cliente: clienteRes.data || despacho.cliente,
        vendedor: vendedorRes.data || despacho.vendedor,
        transportista: transportistaRes.data || despacho.transportista,
      }
      await generarDespachoPDF({ despacho: desConDatos, items: itemsRes.data ?? [], config, formaPago: despacho.forma_pago || '' })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Acción primaria para móvil ──
  function getPrimaryAction() {
    if (canDespachar) {
      const cfg = getDespachoAction('despachar', rol)
      return { key: 'despachar', label: cfg.label || 'Despachar', icon: Truck, action: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }) }
    }
    if (canEntregada) {
      const cfg = getDespachoAction('entregada', rol)
      return { key: 'entregada', label: cfg.label || 'Entregada', icon: CheckCircle, action: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg }) }
    }
    if (canReciclar) {
      const cfg = getDespachoAction('reciclar', rol)
      return { key: 'reciclar', label: cfg.label || 'Reutilizar', icon: RefreshCcw, action: () => onReciclar(despacho) }
    }
    return { key: 'ver', label: 'Ver detalle', icon: Eye, action: () => setShowDetalle(true) }
  }

  const primaryAction = getPrimaryAction()
  const pColors = PRIMARY_ACTION_COLORS[primaryAction.key] || PRIMARY_ACTION_COLORS.ver

  // ── Acciones para el bottom sheet móvil ──
  function getMobileSheetActions() {
    const actions = []
    if (primaryAction.key !== 'ver')
      actions.push({ label: 'Ver detalle', icon: Eye, onClick: () => setShowDetalle(true) })
    actions.push({ label: 'Descargar PDF', icon: Download, onClick: descargarPDF, disabled: pdfLoading })
    if (canDespachar && primaryAction.key !== 'despachar') {
      const cfg = getDespachoAction('despachar', rol)
      actions.push({ label: cfg.label || 'Despachar', icon: Truck, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }), textColor: 'text-indigo-600' })
    }
    if (canEntregada && primaryAction.key !== 'entregada') {
      const cfg = getDespachoAction('entregada', rol)
      actions.push({ label: cfg.label || 'Entregada', icon: CheckCircle, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg }), textColor: 'text-emerald-600' })
    }
    if (canReciclar && primaryAction.key !== 'reciclar')
      actions.push({ label: getDespachoAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCcw, onClick: () => onReciclar(despacho), textColor: 'text-teal-600' })
    if (canAnular) {
      const cfg = getDespachoAction('anular', rol)
      actions.push({ label: cfg.label || 'Anular', icon: Ban, onClick: () => onAnular(despacho), danger: true })
    }
    return actions
  }

  // Resolver config del confirm modal
  const confirmConfig = accionPendiente?.actionConfig || {}

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-16 shrink-0 flex items-end justify-between px-4 pb-2"
        title={despacho.vendedor?.nombre ? `Vendedor: ${despacho.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        <div className="relative z-10 min-w-0">
          <p className="font-black text-white text-sm font-mono leading-tight drop-shadow">{numDisplay}</p>
          {despacho.cliente?.nombre && (
            <p className="text-[11px] font-medium truncate max-w-[120px] sm:max-w-[160px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {despacho.cliente.nombre}
            </p>
          )}
        </div>
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

      {/* ── Flow indicator ── */}
      <div className="px-4 pb-2">
        <DespachoFlowIndicator estado={despacho.estado} compact />
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

      {/* ══════════ MOBILE ACTIONS (< md) ══════════ */}
      <div className="md:hidden mt-auto border-t border-slate-100 p-2.5">
        {/* Botón primario — full width, thumb-friendly */}
        <button
          onClick={primaryAction.action}
          disabled={estadoCambiando}
          className={`w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${pColors.bg} ${pColors.text} ${pColors.active}`}
        >
          {estadoCambiando
            ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            : <primaryAction.icon size={16} />
          }
          {primaryAction.label}
        </button>

        {/* Fila secundaria: Ver + PDF + más */}
        <div className="flex items-center gap-1.5 mt-2">
          {primaryAction.key !== 'ver' && (
            <button onClick={() => setShowDetalle(true)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-50 active:bg-slate-100 transition-colors">
              <Eye size={14} /> Ver
            </button>
          )}
          <button onClick={descargarPDF} disabled={pdfLoading}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
            {pdfLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
            PDF
          </button>
          {getMobileSheetActions().length > 0 && (
            <button onClick={() => setShowSheet(true)}
              className="ml-auto flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors">
              <MoreHorizontal size={14} /> Más
            </button>
          )}
        </div>

        <MobileActionSheet
          isOpen={showSheet}
          onClose={() => setShowSheet(false)}
          actions={getMobileSheetActions()}
        />
      </div>

      {/* ══════════ DESKTOP ACTIONS (md+) ══════════ */}
      <div className="hidden md:flex mt-auto border-t border-slate-100 px-3 py-2 items-center gap-1.5 flex-wrap">
        {/* Ver detalle */}
        <button onClick={() => setShowDetalle(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light transition-colors">
          <Eye size={13} /> Ver
        </button>
        {canDespachar && (
          <button onClick={() => {
              const cfg = getDespachoAction('despachar', rol)
              setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg })
            }}
            disabled={estadoCambiando}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50">
            {estadoCambiando ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />}
            {getDespachoAction('despachar', rol).label || 'Despachar'}
          </button>
        )}
        {canEntregada && (
          <button onClick={() => {
              const cfg = getDespachoAction('entregada', rol)
              setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg })
            }}
            disabled={estadoCambiando}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">
            {estadoCambiando ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
            {getDespachoAction('entregada', rol).label || 'Entregada'}
          </button>
        )}
        {canReciclar && (
          <button onClick={() => onReciclar(despacho)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-teal-600 hover:bg-teal-50 transition-colors">
            <RefreshCcw size={13} /> {getDespachoAction('reciclar', rol).label || 'Reutilizar'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={descargarPDF} disabled={pdfLoading}
            title={pdfLoading ? 'Generando PDF...' : 'Descargar PDF'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50">
            {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
          {canAnular && (
            <button onClick={() => onAnular(despacho)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={13} /> {getDespachoAction('anular', rol).label || 'Anular'}
            </button>
          )}
        </div>
      </div>

      {/* Confirm despachar / entregada — con detalles de consecuencias */}
      <ConfirmModal
        isOpen={!!accionPendiente}
        onClose={() => setAccionPendiente(null)}
        onConfirm={async () => {
          if (!accionPendiente) return
          await onCambiarEstado(accionPendiente.id, accionPendiente.estado)
          setAccionPendiente(null)
        }}
        title={confirmConfig.confirmTitle || (accionPendiente?.estado === 'despachada' ? '¿Marcar como despachada?' : '¿Marcar como entregada?')}
        message={confirmConfig.confirmMessage || `El despacho ${numDisplay} cambiará de estado.`}
        details={confirmConfig.confirmDetails || ''}
        confirmText={confirmConfig.confirmText || 'Confirmar'}
        variant={confirmConfig.variant || 'default'}
      />

      <DetalleModal
        isOpen={showDetalle}
        onClose={() => setShowDetalle(false)}
        tipo="despacho"
        registro={despacho}
        tasa={tasa}
      />
    </div>
  )
})
