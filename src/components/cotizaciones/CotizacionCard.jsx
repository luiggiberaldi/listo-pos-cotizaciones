// src/components/cotizaciones/CotizacionCard.jsx
import { useState, memo } from 'react'
import { FileText, User, Calendar, Pencil, Ban, XCircle, FileDown, MessageCircle, Loader2, Truck, ChevronDown, DollarSign, RefreshCw, Eye, Clock, PackageCheck, MoreHorizontal, AlertTriangle, Printer, Check, Download } from 'lucide-react'
import EstadoBadge from './EstadoBadge'
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

export default memo(function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado, onDespachar, onReciclar, onCambiarEstadoDespacho, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esAdministracion = perfil?.rol === 'administracion'
  const rol = perfil?.rol || 'vendedor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [waLoading, setWaLoading]     = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const [showSheet, setShowSheet]     = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [monedaPdf, setMonedaPdf] = useState(() => localStorage.getItem('construacero_moneda_pdf') || '$')
  const { data: config = {} } = useConfigNegocio()
  const { tasaBcv, tasaUsdt } = useTasaCambio()

  const numDisplay = `COT-${String(cotizacion.numero).padStart(5, '0')}`

  function seleccionarMoneda(moneda) {
    setMonedaPdf(moneda)
    localStorage.setItem('construacero_moneda_pdf', moneda)
  }

  const MONEDA_OPTIONS = [
    { key: '$', icon: <DollarSign size={14} className="text-emerald-500" />, label: 'USDT ($)' },
    { key: 'bcv', icon: <span className="text-sm font-bold text-teal-500 w-[14px] text-center">$</span>, label: 'Dólar BCV' },
    { key: 'bs', icon: <span className="text-sm font-bold text-blue-500 w-[14px] text-center">Bs</span>, label: 'Bolívares' },
    { key: 'mixto', icon: <span className="text-xs font-bold text-amber-500 w-[18px] text-center shrink-0">$Bs</span>, label: 'Mixto USDT' },
    { key: 'mixto_bcv', icon: <span className="text-xs font-bold text-orange-500 w-[18px] text-center shrink-0">$Bs</span>, label: 'Mixto BCV' },
  ]

  const monedaLabel = MONEDA_OPTIONS.find(o => o.key === monedaPdf)?.label || 'USDT ($)'

  async function descargarPDF() {
    setPdfLoading(true)
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
      await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, monedaPDF: monedaPdf, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  function printOrDownloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      const w = window.open(url, '_blank')
      if (!w) {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = 'none'
      iframe.src = url
      document.body.appendChild(iframe)
      iframe.onload = () => {
        try { iframe.contentWindow.print() } catch { window.open(url) }
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 60000)
      }
    }
  }

  async function imprimirCotizacion() {
    setPrintLoading(true)
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
      const blob = await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, monedaPDF: monedaPdf, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio, returnBlob: true })
      printOrDownloadPdf(blob, `${numDisplay.replace(/\s+/g, '_')}.pdf`)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
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
  const esPropietario = cotizacion.vendedor_id === perfil?.id
  const canEdit = esBorrador && !despacho && esPropietario
  const clienteAjeno = cotizacion.cliente?.vendedor_id && cotizacion.cliente.vendedor_id !== cotizacion.vendedor_id
  const canPdf = cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada'
  const canWhatsApp = !despachoAnulado && (cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada')
  const canDespachar = (esSupervisor || esPropietario) && ['enviada', 'aceptada'].includes(cotizacion.estado) && onDespachar && !despacho
  const canAnular = !despachoAnulado && cotizacion.estado !== 'anulada' && cotizacion.estado !== 'vencida' && cotizacion.estado !== 'rechazada' && (esBorrador || ((esSupervisor || esPropietario) && (esEnviada || (cotizacion.estado === 'aceptada' && !despacho))))
  const canReciclar = esSupervisor && (despachoAnulado || ['rechazada', 'anulada', 'vencida'].includes(cotizacion.estado))

  // ── Acción primaria ──
  function getPrimaryAction() {
    if (esBorrador && canEdit)
      return { key: 'editar', label: getAction('editar', rol).label || 'Editar', icon: Pencil, action: () => onEditar(cotizacion) }
    if (canDespachar)
      return { key: 'despachar', label: getAction('despachar', rol).label || 'Despachar', icon: Truck, action: () => onDespachar(cotizacion) }
    if (canWhatsApp)
      return { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, action: handleWhatsApp, loading: waLoading }
    if (canReciclar)
      return { key: 'reciclar', label: getAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCw, action: () => onReciclar(cotizacion) }
    return { key: 'ver', label: 'Ver detalle', icon: Eye, action: () => setShowDetalle(true) }
  }

  const primaryAction = getPrimaryAction()
  const pColors = PRIMARY_ACTION_COLORS[primaryAction.key] || PRIMARY_ACTION_COLORS.ver

  // ── Acciones para Más (móvil bottom sheet + desktop dropdown) ──
  function getMoreActions() {
    const actions = []
    actions.push({ label: 'Ver detalle', icon: Eye, onClick: () => setShowDetalle(true) })
    if (canEdit && primaryAction.key !== 'editar')
      actions.push({ label: getAction('editar', rol).label || 'Editar', icon: Pencil, onClick: () => onEditar(cotizacion), textColor: 'text-sky-600' })
    if (canWhatsApp && primaryAction.key !== 'whatsapp')
      actions.push({ label: 'WhatsApp', icon: MessageCircle, onClick: handleWhatsApp, disabled: waLoading, textColor: 'text-emerald-600' })
    if (canDespachar && primaryAction.key !== 'despachar')
      actions.push({ label: getAction('despachar', rol).label || 'Despachar', icon: Truck, onClick: () => onDespachar(cotizacion), textColor: 'text-indigo-600' })
    if (canReciclar && primaryAction.key !== 'reciclar')
      actions.push({ label: getAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCw, onClick: () => onReciclar(cotizacion), textColor: 'text-teal-600' })
    if (canAnular)
      actions.push({ label: getAction('anular', rol).label || 'Anular', icon: Ban, onClick: () => onAnular(cotizacion), danger: true })
    return actions
  }

  // Moneda selector dropdown content (shared between print & download)
  function MonedaSelector({ onSelect, onClose }) {
    return (
      <div className="border-b border-slate-100 pb-1 mb-1">
        {MONEDA_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => { seleccionarMoneda(opt.key); onSelect(opt.key) }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left whitespace-nowrap ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
            {opt.icon} {opt.label}
            {monedaPdf === opt.key && <Check size={14} className="ml-auto text-emerald-500" />}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-14 shrink-0 flex items-end justify-between px-3 pb-1.5 rounded-t-2xl overflow-hidden"
        title={cotizacion.vendedor?.nombre ? `Vendedor: ${cotizacion.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        <div className="relative z-10 min-w-0">
          <p className="font-black text-white font-mono leading-tight drop-shadow text-base">{numDisplay}</p>
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

      {/* ── Fecha + Cliente + Vendedor ── */}
      <div className="px-3 pt-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Calendar size={11} />
          {fmtFecha(cotizacion.creado_en)}
        </div>
        {cotizacion.cliente?.nombre && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 truncate">{cotizacion.cliente.nombre}</span>
            {(esSupervisor || esAdministracion) && cotizacion.vendedor && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2"
                style={{ backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }}>
                {cotizacion.vendedor.nombre}
              </span>
            )}
          </div>
        )}
      </div>

      {clienteAjeno && (
        <div className="mx-3 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={12} className="shrink-0" />
          Cliente de otro vendedor
        </div>
      )}

      {/* ── Total ── */}
      <div className="mx-3 mb-2 bg-slate-50 rounded-xl px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">Total</span>
        <div className="text-right">
          <span className="text-lg font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
          {tasa > 0 && cotizacion.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* ══════════ ADMIN DESPACHO ACTIONS ══════════ */}
      {esAdministracion && despacho && onCambiarEstadoDespacho && (
        <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setShowDetalle(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light transition-colors">
            <Eye size={13} /> Ver
          </button>
          {despacho.estado === 'pendiente' && (
            <button onClick={() => onCambiarEstadoDespacho(despacho.id, 'despachada')}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition-colors ml-auto">
              <Check size={13} /> Aprobar despacho
            </button>
          )}
          {despacho.estado === 'despachada' && (
            <button onClick={() => onCambiarEstadoDespacho(despacho.id, 'entregada')}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors ml-auto">
              <PackageCheck size={13} /> Marcar entregada
            </button>
          )}
          {['pendiente', 'despachada'].includes(despacho.estado) && (
            <button onClick={() => onCambiarEstadoDespacho(despacho.id, 'anulada')}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={13} /> Anular
            </button>
          )}
        </div>
      )}

      {/* ══════════ MOBILE ACTIONS (< md) ══════════ */}
      {!esAdministracion && (
      <div className="md:hidden mt-auto border-t border-slate-100 p-2.5">
        {/* Botón primario */}
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

        {/* Fila: Imprimir + Descargar + Más */}
        <div className="flex items-center gap-1 mt-2">
          {canPdf && (
            <>
              {/* Imprimir dropdown con moneda */}
              <div className="relative">
                <button onClick={() => setShowPrintMenu(v => !v)}
                  onBlur={() => setTimeout(() => setShowPrintMenu(false), 200)}
                  disabled={printLoading}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
                  {printLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Printer size={13} />}
                  Imprimir <ChevronDown size={9} />
                </button>
                {showPrintMenu && (
                  <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                    onMouseDown={e => e.preventDefault()}>
                    <MonedaSelector onSelect={() => {}} onClose={() => setShowPrintMenu(false)} />
                    <button onClick={() => { imprimirCotizacion(); setShowPrintMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                      <Printer size={14} /> Imprimir cotización
                    </button>
                  </div>
                )}
              </div>

              {/* Descargar dropdown con moneda */}
              <div className="relative">
                <button onClick={() => setShowDownloadMenu(v => !v)}
                  onBlur={() => setTimeout(() => setShowDownloadMenu(false), 200)}
                  disabled={pdfLoading}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
                  {pdfLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Download size={13} />}
                  Descargar <ChevronDown size={9} />
                </button>
                {showDownloadMenu && (
                  <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                    onMouseDown={e => e.preventDefault()}>
                    <MonedaSelector onSelect={() => {}} onClose={() => setShowDownloadMenu(false)} />
                    <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                      <Download size={14} /> Descargar PDF
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <button onClick={() => setShowSheet(true)}
            className="ml-auto flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors">
            <MoreHorizontal size={13} /> Más
          </button>
        </div>

        <MobileActionSheet
          isOpen={showSheet}
          onClose={() => setShowSheet(false)}
          actions={getMoreActions()}
        />
      </div>
      )}

      {/* ══════════ DESKTOP ACTIONS (md+) ══════════ */}
      {!esAdministracion && (
      <div className="hidden md:flex mt-auto border-t border-slate-100 px-3 py-2 items-center gap-1 flex-wrap">
        {/* Botón primario */}
        {primaryAction.key !== 'ver' && (
          <button onClick={primaryAction.action}
            disabled={primaryAction.loading}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap ${pColors.bg} ${pColors.text} ${pColors.active}`}>
            {primaryAction.loading ? <Loader2 size={12} className="animate-spin" /> : <primaryAction.icon size={12} />}
            {primaryAction.label}
          </button>
        )}

        {canPdf && (
          <>
            {/* Imprimir dropdown con moneda */}
            <div className="relative">
              <button onClick={() => setShowPrintMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowPrintMenu(false), 200)}
                disabled={printLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                {printLoading ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                Imprimir <ChevronDown size={9} />
              </button>
              {showPrintMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                  onMouseDown={e => e.preventDefault()}>
                  <MonedaSelector onSelect={() => {}} onClose={() => setShowPrintMenu(false)} />
                  <button onClick={() => { imprimirCotizacion(); setShowPrintMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                    <Printer size={14} /> Imprimir cotización
                  </button>
                </div>
              )}
            </div>

            {/* Descargar dropdown con moneda */}
            <div className="relative">
              <button onClick={() => setShowDownloadMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowDownloadMenu(false), 200)}
                disabled={pdfLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                {pdfLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Descargar <ChevronDown size={9} />
              </button>
              {showDownloadMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                  onMouseDown={e => e.preventDefault()}>
                  <MonedaSelector onSelect={() => {}} onClose={() => setShowDownloadMenu(false)} />
                  <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                    <Download size={14} /> Descargar PDF
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Más (···) dropdown desktop */}
        <div className="relative ml-auto">
          <button onClick={() => setShowMoreMenu(v => !v)}
            onBlur={() => setTimeout(() => setShowMoreMenu(false), 200)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 transition-colors whitespace-nowrap">
            <MoreHorizontal size={12} /> Más
          </button>
          {showMoreMenu && (
            <div className="absolute right-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
              onMouseDown={e => e.preventDefault()}>
              <button onClick={() => { setShowDetalle(true); setShowMoreMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Eye size={14} /> Ver detalle
              </button>
              {canEdit && primaryAction.key !== 'editar' && (
                <button onClick={() => { onEditar(cotizacion); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sky-600 hover:bg-sky-50 text-left">
                  <Pencil size={14} /> {getAction('editar', rol).label || 'Editar'}
                </button>
              )}
              {canWhatsApp && primaryAction.key !== 'whatsapp' && (
                <button onClick={() => { handleWhatsApp(); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 text-left">
                  <MessageCircle size={14} /> WhatsApp
                </button>
              )}
              {canDespachar && primaryAction.key !== 'despachar' && (
                <button onClick={() => { onDespachar(cotizacion); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 text-left">
                  <Truck size={14} /> {getAction('despachar', rol).label || 'Despachar'}
                </button>
              )}
              {canReciclar && primaryAction.key !== 'reciclar' && (
                <button onClick={() => { onReciclar(cotizacion); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-teal-600 hover:bg-teal-50 text-left">
                  <RefreshCw size={14} /> {getAction('reciclar', rol).label || 'Reutilizar'}
                </button>
              )}
              {canAnular && (
                <>
                  <div className="border-t border-slate-100 my-1" />
                  <button onClick={() => { onAnular(cotizacion); setShowMoreMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 text-left">
                    <Ban size={14} /> {getAction('anular', rol).label || 'Anular'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}

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
