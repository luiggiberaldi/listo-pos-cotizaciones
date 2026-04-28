// src/components/despachos/DespachoCard.jsx
import { useState, memo } from 'react'
import { FileText, Calendar, Truck, CheckCircle, Ban, RefreshCcw, Download, Loader2, Eye, MoreHorizontal, ChevronDown, Printer, Tag, Pencil } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import MobileActionSheet from '../cotizaciones/MobileActionSheet'
import ConfirmModal from '../ui/ConfirmModal'
import useAuthStore from '../../store/useAuthStore'
import { getDespachoAction, PRIMARY_ACTION_COLORS } from '../../utils/despachoActions'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import supabase from '../../services/supabase/client'
import { apiUrl } from '../../services/apiBase'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import DetalleModal from '../ui/DetalleModal'
import DescuentoModal from './DescuentoModal'
import EditDespachoModal from './EditDespachoModal'
import { showToast } from '../ui/Toast'

export default memo(function DespachoCard({ despacho, onCambiarEstado, onAnular, onReciclar, tasa = 0, config = {}, estadoCambiando = false }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esAdministracion = perfil?.rol === 'administracion'
  const esPrivilegiado = esSupervisor || esAdministracion || esDesarrollador
  const rol = perfil?.rol || 'vendedor'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [ordenLoading, setOrdenLoading] = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const [showDescuento, setShowDescuento] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showSheet, setShowSheet]     = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [accionPendiente, setAccionPendiente] = useState(null) // { id, estado, actionConfig }
  const { tasaBcv, tasaUsdt } = useTasaCambio()

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`
  const vendedorColor = despacho.vendedor?.color || '#64748b'

  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : '—'

  const canDespachar = (esAdministracion || esDesarrollador) && despacho.estado === 'pendiente'
  const canEntregar = (esPrivilegiado || perfil?.rol === 'logistica') && despacho.estado === 'despachada'
  const canAnular = esPrivilegiado && (despacho.estado === 'pendiente' || despacho.estado === 'despachada')
  const canReciclar = (esSupervisor || esDesarrollador) && despacho.estado === 'anulada' && onReciclar
  const canDescuento = (perfil?.rol === 'logistica' || esSupervisor || esDesarrollador) && ['pendiente', 'despachada'].includes(despacho.estado)
  const canEditar = despacho.estado === 'pendiente' && (esPrivilegiado || despacho.vendedor_id === perfil?.id)
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  const totalConDescuento = Number(despacho.total_usd || 0) - descuentoTotal

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const session = (await supabase.auth.getSession()).data.session
      const [{ generarDespachoPDF }, itemsRes, clienteData, vendedorRes, transportistaRes] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        supabase.from('cotizacion_items').select('codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden').eq('cotizacion_id', despacho.cotizacion_id).order('orden'),
        despacho.cliente_id
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: [despacho.cliente_id] }),
            }).then(r => r.ok ? r.json() : [])
          : Promise.resolve([]),
        despacho.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', despacho.vendedor_id).single() : Promise.resolve({ data: null }),
        despacho.transportista_id ? supabase.from('transportistas').select('id, nombre, rif, telefono, zona_cobertura, vehiculo, placa_chuto, placa_batea, color').eq('id', despacho.transportista_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const desConDatos = {
        ...despacho,
        cliente: clienteData?.[0] || despacho.cliente,
        vendedor: vendedorRes.data || despacho.vendedor,
        transportista: transportistaRes.data || despacho.transportista,
      }
      await generarDespachoPDF({ despacho: desConDatos, items: itemsRes.data ?? [], config, formaPago: despacho.forma_pago || '', monedaPDF: 'bs', tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  async function descargarOrdenDespacho() {
    setOrdenLoading(true)
    try {
      const session = (await supabase.auth.getSession()).data.session
      const [{ generarOrdenDespachoPDF }, itemsRes, clienteData, vendedorRes, transportistaRes] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        supabase.from('cotizacion_items').select('codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden').eq('cotizacion_id', despacho.cotizacion_id).order('orden'),
        despacho.cliente_id
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: [despacho.cliente_id] }),
            }).then(r => r.ok ? r.json() : [])
          : Promise.resolve([]),
        despacho.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', despacho.vendedor_id).single() : Promise.resolve({ data: null }),
        despacho.transportista_id ? supabase.from('transportistas').select('id, nombre, rif, telefono, zona_cobertura, vehiculo, placa_chuto, placa_batea, color').eq('id', despacho.transportista_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const desConDatos = {
        ...despacho,
        cliente: clienteData?.[0] || despacho.cliente,
        vendedor: vendedorRes.data || despacho.vendedor,
        transportista: transportistaRes.data || despacho.transportista,
      }
      await generarOrdenDespachoPDF({ despacho: desConDatos, items: itemsRes.data ?? [], config, formaPago: despacho.forma_pago || '', monedaPDF: '$', tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio })
    } catch (err) {
      showToast('Error al generar Orden de Despacho: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setOrdenLoading(false)
    }
  }

  // Helper: imprimir PDF blob (abre diálogo de impresión en PC y móvil)
  function printOrDownloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      // Abrir PDF en nueva pestaña — el visor nativo permite imprimir/compartir
      const w = window.open(url, '_blank')
      if (!w) {
        // Si el popup fue bloqueado, descargar como fallback
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

  async function imprimirDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const session = (await supabase.auth.getSession()).data.session
      const [{ generarDespachoPDF }, itemsRes, clienteData, vendedorRes, transportistaRes] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        supabase.from('cotizacion_items').select('codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden').eq('cotizacion_id', despacho.cotizacion_id).order('orden'),
        despacho.cliente_id
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: [despacho.cliente_id] }),
            }).then(r => r.ok ? r.json() : [])
          : Promise.resolve([]),
        despacho.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', despacho.vendedor_id).single() : Promise.resolve({ data: null }),
        despacho.transportista_id ? supabase.from('transportistas').select('id, nombre, rif, telefono, zona_cobertura, vehiculo, placa_chuto, placa_batea, color').eq('id', despacho.transportista_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const desConDatos = {
        ...despacho,
        cliente: clienteData?.[0] || despacho.cliente,
        vendedor: vendedorRes.data || despacho.vendedor,
        transportista: transportistaRes.data || despacho.transportista,
      }
      const blob = await generarDespachoPDF({ despacho: desConDatos, items: itemsRes.data ?? [], config, formaPago: despacho.forma_pago || '', monedaPDF: 'bs', tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio, returnBlob: true })
      printOrDownloadPdf(blob, `${numDisplay}-nota-entrega.pdf`)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function imprimirOrdenDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const session = (await supabase.auth.getSession()).data.session
      const [{ generarOrdenDespachoPDF }, itemsRes, clienteData, vendedorRes, transportistaRes] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        supabase.from('cotizacion_items').select('codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden').eq('cotizacion_id', despacho.cotizacion_id).order('orden'),
        despacho.cliente_id
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: [despacho.cliente_id] }),
            }).then(r => r.ok ? r.json() : [])
          : Promise.resolve([]),
        despacho.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', despacho.vendedor_id).single() : Promise.resolve({ data: null }),
        despacho.transportista_id ? supabase.from('transportistas').select('id, nombre, rif, telefono, zona_cobertura, vehiculo, placa_chuto, placa_batea, color').eq('id', despacho.transportista_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const desConDatos = {
        ...despacho,
        cliente: clienteData?.[0] || despacho.cliente,
        vendedor: vendedorRes.data || despacho.vendedor,
        transportista: transportistaRes.data || despacho.transportista,
      }
      const blob = await generarOrdenDespachoPDF({ despacho: desConDatos, items: itemsRes.data ?? [], config, formaPago: despacho.forma_pago || '', monedaPDF: '$', tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio, returnBlob: true })
      printOrDownloadPdf(blob, `${numDisplay}-orden-despacho.pdf`)
    } catch (err) {
      showToast('Error al imprimir orden: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  // ── Acción primaria para móvil ──
  function getPrimaryAction() {
    if (canDespachar) {
      const cfg = getDespachoAction('despachar', rol)
      return { key: 'despachar', label: cfg.label || 'Aprobar despacho', icon: Truck, action: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }) }
    }
    if (canEntregar) {
      const cfg = getDespachoAction('entregar', rol)
      return { key: 'entregar', label: cfg?.label || 'Marcar entregada', icon: CheckCircle, action: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg || { label: 'Marcar entregada', confirm: '¿Confirmar entrega realizada?', color: 'emerald' } }) }
    }
    if (canReciclar) {
      const cfg = getDespachoAction('reciclar', rol)
      return { key: 'reciclar', label: cfg.label || 'Reutilizar', icon: RefreshCcw, action: () => onReciclar(despacho) }
    }
    return { key: 'ver', label: 'Ver detalle', icon: Eye, action: () => setShowDetalle(true) }
  }

  const primaryAction = getPrimaryAction()
  const pColors = PRIMARY_ACTION_COLORS[primaryAction.key] || PRIMARY_ACTION_COLORS.ver

  // ── Acciones para el bottom sheet móvil (Más) ──
  function getMobileSheetActions() {
    const actions = []
    actions.push({ label: 'Ver detalle', icon: Eye, onClick: () => setShowDetalle(true) })
    if (canDescuento)
      actions.push({ label: `Descuento${descuentoTotal > 0 ? ' ✓' : ''}`, icon: Tag, onClick: () => setShowDescuento(true), textColor: 'text-amber-600' })
    if (canDespachar && primaryAction.key !== 'despachar') {
      const cfg = getDespachoAction('despachar', rol)
      actions.push({ label: cfg.label || 'Aprobar despacho', icon: Truck, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }), textColor: 'text-blue-600' })
    }
    if (canEntregar && primaryAction.key !== 'entregar') {
      const cfg = getDespachoAction('entregar', rol)
      actions.push({ label: cfg?.label || 'Marcar entregada', icon: CheckCircle, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg || { label: 'Marcar entregada', confirm: '¿Confirmar entrega realizada?', color: 'emerald' } }), textColor: 'text-emerald-600' })
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
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 flex flex-col" onClick={(e) => { if (e.target.closest('button') || e.target.closest('[data-no-click]') || showEdit || showDetalle || showDescuento) return; setShowDetalle(true) }}>

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-14 shrink-0 flex items-end justify-between px-3 pb-1.5 rounded-t-2xl overflow-hidden"
        title={despacho.vendedor?.nombre ? `Vendedor: ${despacho.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        <div className="relative z-10 min-w-0">
          <p className="font-black text-white font-mono leading-tight drop-shadow text-base">{numDisplay}</p>
          <span className="text-[9px] sm:text-[10px] font-mono text-white/60 bg-white/15 px-1 py-0.5 rounded whitespace-nowrap">{cotNum}</span>
        </div>
        <div className="relative z-10 shrink-0 ml-1">
          <EstadoBadge estado={despacho.estado} rol={rol} />
        </div>
      </div>

      {/* ── Fecha relevante + Cliente ── */}
      <div className="px-3 pt-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Calendar size={11} />
          {despacho.estado === 'entregada' && despacho.entregada_en
            ? <span className="text-teal-500 font-medium">Entregada {fmtFecha(despacho.entregada_en)}</span>
            : despacho.estado === 'despachada' && despacho.despachada_en
              ? <span className="text-indigo-400 font-medium">Despachada {fmtFecha(despacho.despachada_en)}</span>
              : <span>{fmtFecha(despacho.creado_en)}</span>
          }
        </div>
        {despacho.cliente?.nombre && (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-700 leading-snug">{despacho.cliente.nombre}</p>
            {esPrivilegiado && despacho.vendedor && (
              <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }}>
                {despacho.vendedor.nombre}
              </span>
            )}
          </div>
        )}
        {despacho.transportista?.nombre && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Truck size={11} className="shrink-0" />
            <span className="truncate">{despacho.transportista.nombre}</span>
          </div>
        )}
      </div>
      {(despacho.forma_pago_cliente || despacho.referencia_pago) && (
        <div className="mx-3 mb-1 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
          {despacho.forma_pago_cliente && (() => {
            try {
              const parsed = typeof despacho.forma_pago_cliente === 'string' ? JSON.parse(despacho.forma_pago_cliente) : despacho.forma_pago_cliente
              if (Array.isArray(parsed)) {
                return parsed.map((p, i) => (
                  <span key={i} className="font-medium">{p.metodo} {fmtUsd(Number(p.monto))}</span>
                ))
              }
              return <span className="font-medium">{despacho.forma_pago_cliente}</span>
            } catch {
              return <span className="font-medium">{despacho.forma_pago_cliente}</span>
            }
          })()}
          {despacho.forma_pago_cliente && despacho.referencia_pago && <span>·</span>}
          {despacho.referencia_pago && <span className="font-mono">Ref: {despacho.referencia_pago}</span>}
        </div>
      )}

      {/* ── Total ── */}
      <div className="mx-3 mb-2 bg-slate-50 rounded-xl px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">Total</span>
        <div className="text-right">
          {descuentoTotal > 0 ? (
            <>
              <span className="text-xs text-slate-400 line-through mr-1.5">{fmtUsd(despacho.total_usd)}</span>
              <span className="text-lg font-bold text-amber-700">{fmtUsd(totalConDescuento)}</span>
              {tasa > 0 && totalConDescuento > 0 && (
                <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(totalConDescuento, tasa))}</div>
              )}
            </>
          ) : (
            <>
              <span className="text-lg font-bold text-slate-800">{fmtUsd(despacho.total_usd)}</span>
              {tasa > 0 && despacho.total_usd > 0 && (
                <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(despacho.total_usd, tasa))}</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══════════ MOBILE ACTIONS (< md) ══════════ */}
      <div className="md:hidden mt-auto border-t border-slate-100 p-2.5">
        {/* Botón primario — full width */}
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

        {/* Fila de acciones: Imprimir + Descargar + Editar + Más */}
        <div className="flex items-center gap-1 mt-2">
          {/* Imprimir dropdown */}
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
                <button onClick={imprimirDespacho}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Printer size={14} /> Nota de Entrega
                  <span className="ml-auto text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded leading-none">Bs</span>
                </button>
                <button onClick={imprimirOrdenDespacho}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Printer size={14} /> Orden de Despacho
                  <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">USD</span>
                </button>
              </div>
            )}
          </div>

          {/* Descargar dropdown */}
          <div className="relative">
            <button onClick={() => setShowDownloadMenu(v => !v)}
              onBlur={() => setTimeout(() => setShowDownloadMenu(false), 200)}
              disabled={pdfLoading || ordenLoading}
              className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
              {(pdfLoading || ordenLoading) ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Download size={13} />}
              Descargar <ChevronDown size={9} />
            </button>
            {showDownloadMenu && (
              <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                onMouseDown={e => e.preventDefault()}>
                <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Download size={14} /> Nota de Entrega
                  <span className="ml-auto text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded leading-none">Bs</span>
                </button>
                <button onClick={() => { descargarOrdenDespacho(); setShowDownloadMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Download size={14} /> Orden de Despacho
                  <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">USD</span>
                </button>
              </div>
            )}
          </div>

          {canEditar && (
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
              <Pencil size={13} /> Editar
            </button>
          )}

          <button onClick={() => setShowSheet(true)}
            className="ml-auto flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors">
            <MoreHorizontal size={13} /> Más
          </button>
        </div>

        <MobileActionSheet
          isOpen={showSheet}
          onClose={() => setShowSheet(false)}
          actions={getMobileSheetActions()}
        />
      </div>

      {/* ══════════ DESKTOP ACTIONS (md+) ══════════ */}
      <div className="hidden md:flex mt-auto border-t border-slate-100 px-3 py-2 items-center gap-1 flex-wrap">
        {/* Botón primario */}
        {primaryAction.key !== 'ver' && (
          <button onClick={primaryAction.action}
            disabled={estadoCambiando}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap ${pColors.bg} ${pColors.text} ${pColors.active}`}>
            {estadoCambiando ? <Loader2 size={12} className="animate-spin" /> : <primaryAction.icon size={12} />}
            {primaryAction.label}
          </button>
        )}

        {/* Imprimir dropdown */}
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
              <button onClick={imprimirDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Printer size={14} /> Nota de Entrega
                <span className="ml-auto text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded leading-none">Bs</span>
              </button>
              <button onClick={imprimirOrdenDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Printer size={14} /> Orden de Despacho
                <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">USD</span>
              </button>
            </div>
          )}
        </div>

        {/* Descargar dropdown */}
        <div className="relative">
          <button onClick={() => setShowDownloadMenu(v => !v)}
            onBlur={() => setTimeout(() => setShowDownloadMenu(false), 200)}
            disabled={pdfLoading || ordenLoading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
            {(pdfLoading || ordenLoading) ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Descargar <ChevronDown size={9} />
          </button>
          {showDownloadMenu && (
            <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
              onMouseDown={e => e.preventDefault()}>
              <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Download size={14} /> Nota de Entrega
                <span className="ml-auto text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded leading-none">Bs</span>
              </button>
              <button onClick={() => { descargarOrdenDespacho(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Download size={14} /> Orden de Despacho
                <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">USD</span>
              </button>
            </div>
          )}
        </div>

        {canEditar && (
          <button onClick={() => setShowEdit(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors whitespace-nowrap">
            <Pencil size={12} /> Editar
          </button>
        )}

        {/* Más (···) dropdown desktop */}
        <div className="relative ml-auto">
          <button onClick={() => setShowMoreMenu(v => !v)}
            onBlur={() => setTimeout(() => setShowMoreMenu(false), 200)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 transition-colors whitespace-nowrap">
            <MoreHorizontal size={12} /> Más
          </button>
          {showMoreMenu && (
            <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
              onMouseDown={e => e.preventDefault()}>
              <button onClick={() => { setShowDetalle(true); setShowMoreMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Eye size={14} /> Ver detalle
              </button>
              {canDescuento && (
                <button onClick={() => { setShowDescuento(true); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 text-left">
                  <Tag size={14} /> Descuento {descuentoTotal > 0 && '✓'}
                </button>
              )}
              {canDespachar && primaryAction.key !== 'despachar' && (
                <button onClick={() => { const cfg = getDespachoAction('despachar', rol); setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 text-left">
                  <Truck size={14} /> {getDespachoAction('despachar', rol).label || 'Despachar'}
                </button>
              )}
              {canEntregar && primaryAction.key !== 'entregar' && (
                <button onClick={() => { const cfg = getDespachoAction('entregar', rol) || { label: 'Marcar entregada', confirm: '¿Confirmar entrega realizada?', color: 'emerald' }; setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg }); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 text-left">
                  <CheckCircle size={14} /> Marcar entregada
                </button>
              )}
              {canReciclar && primaryAction.key !== 'reciclar' && (
                <button onClick={() => { onReciclar(despacho); setShowMoreMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-teal-600 hover:bg-teal-50 text-left">
                  <RefreshCcw size={14} /> Reutilizar
                </button>
              )}
              {canAnular && (
                <>
                  <div className="border-t border-slate-100 my-1" />
                  <button onClick={() => { onAnular(despacho); setShowMoreMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 text-left">
                    <Ban size={14} /> Anular despacho
                  </button>
                </>
              )}
            </div>
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

      <DescuentoModal
        isOpen={showDescuento}
        onClose={() => setShowDescuento(false)}
        despacho={despacho}
      />

      <EditDespachoModal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        despacho={despacho}
      />
    </div>
  )
})
