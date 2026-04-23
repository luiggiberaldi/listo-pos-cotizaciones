// src/components/cotizaciones/CotizacionCard.jsx
import { useState, memo } from 'react'
import { FileText, User, Calendar, Pencil, Ban, CheckCircle, XCircle, FileDown, MessageCircle, Loader2, Truck, ChevronDown, DollarSign, RefreshCw, Eye, Clock, PackageCheck, MoreHorizontal, AlertTriangle } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
import QuoteFlowIndicator from './QuoteFlowIndicator'
import MobileActionSheet from './MobileActionSheet'
import useAuthStore from '../../store/useAuthStore'
import supabase from '../../services/supabase/client'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import { getAction, PRIMARY_ACTION_COLORS } from '../../utils/cotizacionActions'
import { apiUrl } from '../../services/apiBase'
import DetalleModal from '../ui/DetalleModal'
import { showToast } from '../ui/Toast'

// Helper: fetch cliente via Worker API (bypasses RLS)
async function fetchClienteViaAPI(clienteId) {
  if (!clienteId) return null
  try {
    const session = (await supabase.auth.getSession()).data.session
    const res = await fetch(apiUrl('/api/clientes/lookup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ ids: [clienteId] }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.[0] ?? null
  } catch { return null }
}

export default memo(function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado, onDespachar, onReciclar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const rol = perfil?.rol || 'vendedor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [waLoading, setWaLoading]     = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const [showSheet, setShowSheet]     = useState(false)
  const [showPdfMenu, setShowPdfMenu] = useState(false)
  const [monedaPdf, setMonedaPdf] = useState(() => localStorage.getItem('construacero_moneda_pdf') || '$')
  const { data: config = {} } = useConfigNegocio()
  const { tasaBcv, tasaUsdt } = useTasaCambio()

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  async function descargarPDF(monedaPDF = '$') {
    setPdfLoading(true)
    setShowPdfMenu(false)
    setMonedaPdf(monedaPDF)
    localStorage.setItem('construacero_moneda_pdf', monedaPDF)
    try {
      const [{ generarPDF }, itemsRes, clienteData, vendedorRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacion.id).order('orden'),
        fetchClienteViaAPI(cotizacion.cliente_id),
        cotizacion.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', cotizacion.vendedor_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const cotConDatos = {
        ...cotizacion,
        cliente: clienteData || cotizacion.cliente,
        vendedor: vendedorRes.data || cotizacion.vendedor,
      }
      await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, monedaPDF, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const [{ generarPDF }, itemsRes, clienteData, vendedorRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacion.id).order('orden'),
        fetchClienteViaAPI(cotizacion.cliente_id),
        cotizacion.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', cotizacion.vendedor_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const cliente = clienteData || cotizacion.cliente
      const vendedor = vendedorRes.data || cotizacion.vendedor
      const cotConDatos = { ...cotizacion, cliente, vendedor }
      const pdfBlob = await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, returnBlob: true, monedaPDF: monedaPdf, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio })
      const mensajeParams = {
        nombreNegocio: config.nombre_negocio,
        nombreCliente: cliente?.nombre,
        nombreVendedor: vendedor?.nombre,
        numDisplay,
        totalUsd: cotizacion.total_usd,
        validaHasta: cotizacion.valida_hasta,
        items: itemsRes.data ?? [],
      }
      const mensaje = generarMensaje(mensajeParams)
      await compartirPorWhatsApp({
        pdfBlob,
        pdfFilename: `${numDisplay.replace(/\s+/g, '_')}.pdf`,
        telefono: cliente?.telefono,
        mensaje,
        mensajeParams,
      })
    } catch (err) {
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
  const despacho = cotizacion.despacho
  const despachoAnulado = despacho?.estado === 'anulada'
  const canEdit = esBorrador
  const esPropietario = cotizacion.vendedor_id === perfil?.id
  const clienteAjeno = cotizacion.cliente?.vendedor_id && cotizacion.cliente.vendedor_id !== cotizacion.vendedor_id
  const canVersion = !esBorrador && !despachoAnulado && ['enviada', 'aceptada', 'rechazada'].includes(cotizacion.estado) && (!esSupervisor || esPropietario)
  const canPdf = cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada'
  const canWhatsApp = !despachoAnulado && (cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada')
  const canAcceptReject = esSupervisor && esEnviada
  const canDespachar = (esSupervisor || esPropietario) && cotizacion.estado === 'aceptada' && onDespachar && !despacho
  const canAnular = !despachoAnulado && cotizacion.estado !== 'anulada' && cotizacion.estado !== 'vencida' && cotizacion.estado !== 'rechazada' && (esBorrador || (esSupervisor && (esEnviada || (cotizacion.estado === 'aceptada' && !despacho))))
  const canReciclar = esSupervisor && (despachoAnulado || ['rechazada', 'anulada', 'vencida'].includes(cotizacion.estado))
  const hasSecondaryActions = canAcceptReject || canDespachar || canAnular

  // ── Acción primaria para móvil ──
  function getPrimaryAction() {
    if (esBorrador && canEdit)
      return { key: 'editar', label: getAction('editar', rol).label || 'Editar', icon: Pencil, action: () => onEditar(cotizacion) }
    if (esEnviada && esSupervisor)
      return { key: 'aceptar', label: getAction('aceptar', rol).label || 'Aprobar', icon: CheckCircle, action: () => onCambiarEstado(cotizacion.id, 'aceptada', cotizacion.numero, cotizacion.cliente?.nombre, cotizacion.total_usd, cotizacion.vendedor_id) }
    if (cotizacion.estado === 'aceptada' && canDespachar)
      return { key: 'despachar', label: getAction('despachar', rol).label || 'Despachar', icon: Truck, action: () => onDespachar(cotizacion) }
    if (canWhatsApp)
      return { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, action: handleWhatsApp, loading: waLoading }
    if (canReciclar)
      return { key: 'reciclar', label: getAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCw, action: () => onReciclar(cotizacion) }
    return { key: 'ver', label: 'Ver detalle', icon: Eye, action: () => setShowDetalle(true) }
  }

  const primaryAction = getPrimaryAction()
  const pColors = PRIMARY_ACTION_COLORS[primaryAction.key] || PRIMARY_ACTION_COLORS.ver

  // ── Acciones para el bottom sheet móvil ──
  function getMobileSheetActions() {
    const actions = []
    if (primaryAction.key !== 'ver')
      actions.push({ label: 'Ver detalle', icon: Eye, onClick: () => setShowDetalle(true) })
    if ((canEdit || canVersion) && primaryAction.key !== 'editar')
      actions.push({ label: canVersion ? (getAction('revisar', rol).label || 'Nueva versión') : (getAction('editar', rol).label || 'Editar'), icon: Pencil, onClick: () => onEditar(cotizacion), textColor: 'text-sky-600' })
    if (canPdf)
      actions.push({ label: 'Descargar PDF', icon: FileDown, onClick: descargarPDF, disabled: pdfLoading })
    if (canWhatsApp && primaryAction.key !== 'whatsapp')
      actions.push({ label: 'Compartir por WhatsApp', icon: MessageCircle, onClick: handleWhatsApp, disabled: waLoading, textColor: 'text-emerald-600' })
    if (canAcceptReject && primaryAction.key !== 'aceptar') {
      actions.push({ label: getAction('aceptar', rol).label || 'Aprobar', icon: CheckCircle, onClick: () => onCambiarEstado(cotizacion.id, 'aceptada', cotizacion.numero, cotizacion.cliente?.nombre, cotizacion.total_usd, cotizacion.vendedor_id), textColor: 'text-emerald-600' })
      actions.push({ label: getAction('rechazar', rol).label || 'Rechazar', icon: XCircle, onClick: () => onCambiarEstado(cotizacion.id, 'rechazada', cotizacion.numero, null, null, cotizacion.vendedor_id), textColor: 'text-orange-600' })
    }
    if (canDespachar && primaryAction.key !== 'despachar')
      actions.push({ label: getAction('despachar', rol).label || 'Despachar', icon: Truck, onClick: () => onDespachar(cotizacion), textColor: 'text-indigo-600' })
    if (canReciclar && primaryAction.key !== 'reciclar')
      actions.push({ label: getAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCw, onClick: () => onReciclar(cotizacion), textColor: 'text-teal-600' })
    if (canAnular)
      actions.push({ label: getAction('anular', rol).label || 'Cancelar', icon: Ban, onClick: () => onAnular(cotizacion), danger: true })
    return actions
  }

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-16 shrink-0 flex items-end justify-between px-4 pb-2"
        title={cotizacion.vendedor?.nombre ? `Vendedor: ${cotizacion.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        <div className="relative z-10 min-w-0">
          <p className="font-black text-white text-sm font-mono leading-tight drop-shadow">{numDisplay}</p>
        </div>
        <div className="relative z-10 shrink-0 flex flex-col items-end gap-1">
          <EstadoBadge estado={cotizacion.estado} />
          {despacho && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
              despacho.estado === 'entregada' ? 'bg-emerald-500 text-white' :
              despacho.estado === 'despachada' ? 'bg-blue-500 text-white' :
              despacho.estado === 'anulada' ? 'bg-red-400 text-white' :
              'bg-indigo-500 text-white'
            }`}>
              {despacho.estado === 'pendiente' ? <><Clock size={10} /> Despacho pendiente</> :
               despacho.estado === 'despachada' ? <><Truck size={10} /> En camino</> :
               despacho.estado === 'entregada' ? <><PackageCheck size={10} /> Entregada</> :
               despacho.estado === 'anulada' ? <><XCircle size={10} /> Despacho anulado</> : despacho.estado}
            </span>
          )}
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

      {/* ── Flow indicator ── */}
      <div className="px-4 pb-2">
        <QuoteFlowIndicator estado={cotizacion.estado} despacho={despacho} compact />
      </div>

      {/* ── Cliente ── */}
      {cotizacion.cliente?.nombre && (
        <div className="px-4 pb-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">Cliente</span>
          <span className="text-xs font-semibold truncate max-w-[200px]"
            style={{ color: cotizacion.cliente?.vendedor?.color || vendedorColor }}>
            {cotizacion.cliente.nombre}
          </span>
        </div>
      )}

      {clienteAjeno && (
        <div className="mx-4 mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={12} className="shrink-0" />
          Cliente de otro vendedor
        </div>
      )}

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

      {/* ══════════ MOBILE ACTIONS (< md) ══════════ */}
      <div className="md:hidden mt-auto border-t border-slate-100 p-2.5">
        {/* Botón primario — full width, thumb-friendly */}
        <button
          onClick={primaryAction.action}
          disabled={primaryAction.loading}
          className={`w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${pColors.bg} ${pColors.text} ${pColors.active}`}
        >
          {primaryAction.loading
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
          {canPdf && (
            <div className="relative">
              <button onClick={() => setShowPdfMenu(v => !v)} disabled={pdfLoading}
                onBlur={() => setTimeout(() => setShowPdfMenu(false), 200)}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
                {pdfLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <FileDown size={14} />}
                PDF <ChevronDown size={10} />
              </button>
              {showPdfMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-40 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                  onMouseDown={e => e.preventDefault()}>
                  {[
                    { key: '$', icon: <DollarSign size={14} className="text-emerald-500" />, label: 'USDT ($)' },
                    { key: 'bcv', icon: <span className="text-sm font-bold text-teal-500 w-[14px] text-center">$</span>, label: 'Dólar BCV' },
                    { key: 'bs', icon: <span className="text-sm font-bold text-blue-500 w-[14px] text-center">Bs</span>, label: 'Bolívares' },
                    { key: 'mixto', icon: <span className="text-xs font-bold text-amber-500 w-[18px] text-center shrink-0">$Bs</span>, label: 'Mixto USDT' },
                    { key: 'mixto_bcv', icon: <span className="text-xs font-bold text-orange-500 w-[18px] text-center shrink-0">$Bs</span>, label: 'Mixto BCV' },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => descargarPDF(opt.key)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
        {canEdit && (
          <button onClick={() => onEditar(cotizacion)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} /> {getAction('editar', rol).label}
          </button>
        )}
        {canVersion && (
          <button onClick={() => onEditar(cotizacion)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} /> {getAction('revisar', rol).label}
          </button>
        )}
        {canPdf && (
          <div className="relative">
            <button onClick={() => setShowPdfMenu(v => !v)} disabled={pdfLoading}
              onBlur={() => setTimeout(() => setShowPdfMenu(false), 200)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40">
              {pdfLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <FileDown size={13} />}
              PDF <ChevronDown size={10} />
            </button>
            {showPdfMenu && (
              <div className="absolute left-0 bottom-full mb-1 w-40 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                onMouseDown={e => e.preventDefault()}>
                {[
                  { key: '$', icon: <DollarSign size={14} className="text-emerald-500" />, label: 'USDT ($)' },
                  { key: 'bcv', icon: <span className="text-sm font-bold text-teal-500 w-[14px] text-center">$</span>, label: 'Dólar BCV' },
                  { key: 'bs', icon: <span className="text-sm font-bold text-blue-500 w-[14px] text-center">Bs</span>, label: 'Bolívares' },
                  { key: 'mixto', icon: <span className="text-xs font-bold text-amber-500 w-[18px] text-center shrink-0">$Bs</span>, label: 'Mixto' },
                ].map(opt => (
                  <button key={opt.key} onClick={() => descargarPDF(opt.key)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {canWhatsApp && (
          <button onClick={handleWhatsApp} disabled={waLoading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40">
            {waLoading ? <div className="w-3 h-3 border-[1.5px] border-emerald-400 border-t-transparent rounded-full animate-spin" /> : <MessageCircle size={13} />}
            WhatsApp
          </button>
        )}
        {canReciclar && (
          <button onClick={() => onReciclar(cotizacion)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-teal-600 hover:bg-teal-50 transition-colors">
            <RefreshCw size={13} /> {getAction('reciclar', rol).label}
          </button>
        )}
        {canDespachar && (
          <button onClick={() => onDespachar(cotizacion)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
            <Truck size={13} /> {getAction('despachar', rol).label || 'Despachar'}
          </button>
        )}

        {/* Desktop secondary dropdown */}
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
              <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                onMouseDown={e => e.preventDefault()}>
                {canAcceptReject && (
                  <>
                    <button onClick={() => { onCambiarEstado(cotizacion.id, 'aceptada', cotizacion.numero, cotizacion.cliente?.nombre, cotizacion.total_usd, cotizacion.vendedor_id); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors text-left">
                      <CheckCircle size={14} />{getAction('aceptar', rol).label || 'Aprobar'}
                    </button>
                    <button onClick={() => { onCambiarEstado(cotizacion.id, 'rechazada', cotizacion.numero, null, null, cotizacion.vendedor_id); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 transition-colors text-left">
                      <XCircle size={14} />{getAction('rechazar', rol).label || 'Rechazar'}
                    </button>
                  </>
                )}
                {canDespachar && (
                  <button onClick={() => { onDespachar(cotizacion); setShowActions(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors text-left">
                    <Truck size={14} />{getAction('despachar', rol).label || 'Despachar'}
                  </button>
                )}
                {canAnular && (
                  <>
                    {(canAcceptReject || canDespachar) && <div className="my-1 border-t border-slate-100" />}
                    <button onClick={() => { onAnular(cotizacion); setShowActions(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors text-left">
                      <Ban size={14} />{getAction('anular', rol).label || 'Anular'}
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
})
