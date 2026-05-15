import { useState, useRef, useEffect, memo, Fragment } from 'react'
import { FileText, Calendar, Truck, CheckCircle, Ban, RefreshCcw, RefreshCw, Download, Loader2, Eye, MoreHorizontal, ChevronDown, Printer, Tag, Pencil, RotateCcw, AlertTriangle, Clock, CreditCard, DollarSign, Check, PackageCheck } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import MobileActionSheet from '../cotizaciones/MobileActionSheet'
import ConfirmModal from '../ui/ConfirmModal'
import useAuthStore from '../../store/useAuthStore'
import { getDespachoAction, PRIMARY_ACTION_COLORS } from '../../utils/despachoActions'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtFechaHora, fmtBs, usdToBs } from '../../utils/format'
import supabase from '../../services/supabase/client'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import DetalleModal from '../ui/DetalleModal'
import DescuentoModal from './DescuentoModal'
import EditDespachoModal from './EditDespachoModal'
import DevolverAnularModal from './DevolverAnularModal'
import { showToast } from '../ui/Toast'
import { MessageCircle } from 'lucide-react'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'

export default memo(function DespachoCard({ despacho, onCambiarEstado, onAnular, onReciclar, tasa = 0, config = {}, estadoCambiando = false }) {
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
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
  const printBtnRef = useRef(null)
  const downloadBtnRef = useRef(null)
  const [monedaPdf, setMonedaPdf] = useState(() => localStorage.getItem('construacero_moneda_pdf') || '$')
  const { tasaBcv, tasaUsdt } = useTasaCambio()

  function seleccionarMoneda(moneda) {
    setMonedaPdf(moneda)
    localStorage.setItem('construacero_moneda_pdf', moneda)
  }

  const MONEDA_OPTIONS = [
    { key: '$', icon: <DollarSign size={14} className="text-emerald-500" />, label: 'USDT ($)' },
    { key: 'bcv', icon: <span className="text-sm font-bold text-teal-500 w-[14px] text-center">$</span>, label: 'Dólar BCV' },
    { key: 'bs', icon: <span className="text-sm font-bold text-blue-500 w-[14px] text-center">Bs</span>, label: 'Bolívares' },
  ]

  function MonedaSelector() {
    return (
      <div className="border-b border-slate-100 pb-1 mb-1">
        {MONEDA_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => seleccionarMoneda(opt.key)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left whitespace-nowrap ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
            {opt.icon} {opt.label}
            {monedaPdf === opt.key && <Check size={14} className="ml-auto text-emerald-500" />}
          </button>
        ))}
      </div>
    )
  }

  // Cerrar modal de confirmación si el despacho cambió de estado (ej: anulado por otro usuario)
  useEffect(() => {
    if (accionPendiente && despacho.estado !== 'pendiente' && accionPendiente.estado === 'despachada') {
      setAccionPendiente(null)
    }
  }, [despacho.estado, accionPendiente])

  // Verificar stock insuficiente para Admin
  const [itemsFaltantes, setItemsFaltantes] = useState([])
  const hayFaltaStock = itemsFaltantes.length > 0

  useEffect(() => {
    if (['pendiente', 'despachada'].includes(despacho.estado) && esPrivilegiado) {
      async function checkStock() {
        try {
          const items = await fetchItemsDespacho()
          const ids = items.map(it => it.producto_id).filter(Boolean)
          if (ids.length === 0) return
          
          const { data: prods } = await supabase.from('productos').select('id, stock_actual').in('id', ids)
          
          const faltantes = items.filter(it => {
            const p = prods?.find(x => x.id === it.producto_id)
            return it.cantidad > (p?.stock_actual || 0)
          })
          setItemsFaltantes(faltantes)
        } catch (err) {
          console.error('Error verificando stock:', err)
        }
      }
      checkStock()
    } else {
      setItemsFaltantes([])
    }
  }, [despacho.id, despacho.estado])

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`
  const vendedorColor = despacho.vendedor?.color || '#64748b'

  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : '—'

  const canDespachar = (esAdministracion || esDesarrollador) && despacho.estado === 'pendiente'
  const canEntregar = (perfil?.rol === 'logistica' || esDesarrollador) && despacho.estado === 'despachada'
  const esVendedorPropio = perfil?.id === despacho.vendedor_id
  const canAnular = ((esAdministracion || esDesarrollador || esSupervisor) && (despacho.estado === 'pendiente' || despacho.estado === 'despachada'))
    || (esVendedorPropio && despacho.estado === 'pendiente')
  const canDevolver = (esAdministracion || esSupervisor || esDesarrollador || perfil?.rol === 'logistica') && despacho.estado === 'despachada'
  const canReciclar = ((esSupervisor || esDesarrollador) && despacho.estado === 'anulada' && onReciclar)
    || (rol === 'vendedor' && despacho.estado === 'anulada' && esVendedorPropio && onReciclar)
  const canDescuento = (esAdministracion || esDesarrollador) && ['pendiente', 'despachada'].includes(despacho.estado)
  const canEditar = despacho.estado === 'pendiente' && (esPrivilegiado || despacho.vendedor_id === perfil?.id)
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  const fleteUsd = Number(despacho.flete_usd || 0)
  const corteUsd = Number(despacho.corte_usd || 0)
  const totalBruto = Number(despacho.total_usd || 0) // ya incluye flete y corte
  const subtotalProductos = totalBruto - fleteUsd - corteUsd // solo productos sin servicios
  const totalFinal = totalBruto - descuentoTotal // total con flete+corte, menos descuento

  let isCtaPorCobrar = false
  let textVencimiento = null
  try {
    const fp = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : (despacho.forma_pago || [])
    if (Array.isArray(fp)) {
      const cta = fp.find(f => f.metodo === 'Cta por cobrar')
      if (cta && cta.diasVencimiento > 0) {
        isCtaPorCobrar = true
        const fCreacion = new Date(despacho.creado_en)
        const fVenc = new Date(fCreacion.getTime() + cta.diasVencimiento * 24 * 60 * 60 * 1000)
        const hoy = new Date()
        const restantes = Math.ceil((fVenc - hoy) / (1000 * 60 * 60 * 24))
        const vencido = restantes < 0
        textVencimiento = `${cta.diasVencimiento} días (${vencido ? `Vencido hace ${Math.abs(restantes)}d` : `${restantes}d restantes`})`
      } else if (cta) {
        isCtaPorCobrar = true
      }
    }
  } catch (e) {
    // ignore
  }
  // Helper: fetch notas_despacho_items con fallback offline
  async function fetchItemsDespacho() {
    const res = await supabase
      .from('notas_despacho_items')
      .select('id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden')
      .eq('despacho_id', despacho.id)
      .order('orden')
    if (res.error) throw new Error(res.error.message || 'Sin items en caché — conecta a internet al menos una vez para imprimir offline')
    return res.data ?? []
  }

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        fetchItemsDespacho(),
      ])
      await generarDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
      })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  async function descargarOrdenDespacho() {
    setOrdenLoading(true)
    try {
      const [{ generarOrdenDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        fetchItemsDespacho(),
      ])
      await generarOrdenDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: '$', tasa,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
      })
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
      const [{ generarDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
      })
      printOrDownloadPdf(blob, filename)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function compartirDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: 'bs', tasa,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
      })

      const clienteObj = despacho.cliente_factura || despacho.cliente
      const mensaje = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteObj?.nombre,
        numDisplay,
        totalUsd: totalFinal,
        nombreVendedor: despacho.vendedor?.nombre,
        tipo: 'Nota de Entrega'
      })

      await compartirPorWhatsApp({
        pdfBlob: blob,
        pdfFilename: filename,
        telefono: clienteObj?.telefono,
        mensaje,
        mensajeParams: {
          nombreNegocio: config.nombre_negocio,
          nombreCliente: clienteObj?.nombre,
          numDisplay,
          totalUsd: totalFinal,
          nombreVendedor: despacho.vendedor?.nombre,
          tipo: 'Nota de Entrega'
        }
      })
    } catch (err) {
      showToast('Error al compartir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function imprimirOrdenDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarOrdenDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarOrdenDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: '$', tasa,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
      })
      printOrDownloadPdf(blob, filename)
    } catch (err) {
      showToast('Error al imprimir orden: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function compartirOrdenDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarOrdenDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarOrdenDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: '$', tasa,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
      })

      const clienteObj = despacho.cliente_factura || despacho.cliente
      const mensaje = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteObj?.nombre,
        numDisplay,
        totalUsd: totalFinal,
        nombreVendedor: despacho.vendedor?.nombre,
        tipo: 'Orden de Despacho'
      })

      await compartirPorWhatsApp({
        pdfBlob: blob,
        pdfFilename: filename,
        telefono: clienteObj?.telefono,
        mensaje,
        mensajeParams: {
          nombreNegocio: config.nombre_negocio,
          nombreCliente: clienteObj?.nombre,
          numDisplay,
          totalUsd: totalFinal,
          nombreVendedor: despacho.vendedor?.nombre,
          tipo: 'Orden de Despacho'
        }
      })
    } catch (err) {
      showToast('Error al compartir orden: ' + (err.message || 'Error desconocido'), 'error')
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

  // ── Acciones para Más (bottom sheet móvil + dropdown desktop) ──
  function getMoreActions() {
    const actions = []
    actions.push({ label: 'Ver detalle', icon: Eye, onClick: () => setShowDetalle(true) })
    // if (canDescuento)
    //   actions.push({ label: `Descuento${descuentoTotal > 0 ? ' ✓' : ''}`, icon: Tag, onClick: () => setShowDescuento(true), textColor: 'text-amber-600' })
    if (canDespachar && primaryAction.key !== 'despachar') {
      const cfg = getDespachoAction('despachar', rol)
      actions.push({ label: cfg.label || 'Aprobar despacho', icon: Truck, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }), textColor: 'text-blue-600' })
    }
    if (canEntregar && primaryAction.key !== 'entregar') {
      const cfg = getDespachoAction('entregar', rol)
      actions.push({ label: cfg?.label || 'Marcar entregada', icon: CheckCircle, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg || { label: 'Marcar entregada', confirm: '¿Confirmar entrega realizada?', color: 'emerald' } }), textColor: 'text-emerald-600' })
    }
    if (canDevolver) {
      const cfg = getDespachoAction('devolver', rol)
      actions.push({ label: cfg.label || 'No entregado', icon: RotateCcw, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'pendiente', isDevolver: true, actionConfig: cfg }), textColor: 'text-amber-600' })
    }
    if (canReciclar && primaryAction.key !== 'reciclar')
      actions.push({ label: getDespachoAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCcw, onClick: () => onReciclar(despacho), textColor: 'text-teal-600' })
    if (canAnular) {
      const cfg = getDespachoAction('anular', rol)
      actions.push({ label: cfg.label || 'Anular', icon: Ban, onClick: () => {
        if (despacho.estado === 'despachada') {
          setAccionPendiente({ id: despacho.id, estado: 'anulada', isAnular: true, actionConfig: cfg })
        } else {
          onAnular(despacho)
        }
      }, danger: true })
    }
    return actions
  }

  const moreActions = getMoreActions()

  // Resolver config del confirm modal
  const confirmConfig = accionPendiente?.actionConfig || {}

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative shrink-0 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2 rounded-t-2xl overflow-hidden"
        title={despacho.vendedor?.nombre ? `Vendedor: ${despacho.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        <div className="relative z-10">
          <p className="font-black text-white font-mono leading-tight drop-shadow text-base">{numDisplay}</p>
        </div>
        <div className="relative z-10 shrink-0">
          <EstadoBadge estado={despacho.estado} rol={rol} />
        </div>
      </div>

      {/* ── Fecha relevante + Cliente ── */}
      <div className="px-3 pt-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Calendar size={11} />
          {despacho.estado === 'entregada' && despacho.entregada_en
            ? <span className="text-teal-500 font-medium">Entregada {fmtFechaHora(despacho.entregada_en)}</span>
            : despacho.estado === 'despachada' && despacho.despachada_en
              ? <span className="text-indigo-400 font-medium">Despachada {fmtFechaHora(despacho.despachada_en)}</span>
              : <span>{fmtFechaHora(despacho.actualizado_en || despacho.creado_en)}</span>
          }
        </div>
        {(despacho.cliente_factura || despacho.cliente)?.nombre && (
          <div className="space-y-1">
            <p className="text-sm font-bold leading-snug"
              style={{ color: (despacho.cliente_factura || despacho.cliente).vendedor?.color || '#334155' }}>
              {(despacho.cliente_factura || despacho.cliente).nombre}
            </p>
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
        {isCtaPorCobrar && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 font-medium mt-0.5">
            <CreditCard size={11} className="shrink-0" />
            <span>Cta. por cobrar {textVencimiento ? `- ${textVencimiento}` : ''}</span>
          </div>
        )}
      </div>

      {/* ── Total + Flete + Corte ── */}
      <div className="mx-3 mb-2 bg-slate-50 rounded-xl px-3 py-2 space-y-1">
        {(fleteUsd > 0 || corteUsd > 0) && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">Subtotal</span>
              <span className="text-xs font-semibold text-slate-500">{fmtUsd(subtotalProductos)}</span>
            </div>
            {fleteUsd > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400">Flete</span>
                <span className="text-xs font-semibold text-emerald-600">+{fmtUsd(fleteUsd)}</span>
              </div>
            )}
            {corteUsd > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400">Corte</span>
                <span className="text-xs font-semibold text-emerald-600">+{fmtUsd(corteUsd)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Total</span>
            {despacho.items_count?.[0] && (
              <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 mt-0.5">
                <PackageCheck size={11} />
                {despacho.items_count[0].count} {despacho.items_count[0].count === 1 ? 'Ítem' : 'Ítems'}
              </div>
            )}
          </div>
          <div className="text-right">
            {descuentoTotal > 0 ? (
              <>
                <span className="text-xs text-slate-400 line-through mr-1.5">{fmtUsd(totalBruto)}</span>
                <span className="text-lg font-bold text-amber-700">{fmtUsd(totalFinal)}</span>
                {tasa > 0 && totalFinal > 0 && (
                  <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(totalFinal, tasa))}</div>
                )}
              </>
            ) : (
              <>
                <span className="text-lg font-bold text-slate-800">{fmtUsd(totalBruto)}</span>
                {tasa > 0 && totalBruto > 0 && (
                  <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(totalBruto, tasa))}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Banner Advertencia Stock (Admin) */}
      {hayFaltaStock && ['pendiente', 'despachada'].includes(despacho.estado) && esPrivilegiado && (
        <div className="mx-3 mb-2 p-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-700 animate-in slide-in-from-top-2 duration-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-[10px] font-black uppercase leading-tight">Stock insuficiente en {itemsFaltantes.length} ítem(s)</span>
        </div>
      )}

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
        <div className="flex items-center gap-0.5 mt-2 flex-wrap -mx-1 px-1">
          {/* Imprimir */}
          <button ref={printBtnRef} onClick={() => { setShowPrintMenu(v => !v); setShowDownloadMenu(false) }}
            disabled={printLoading}
            className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 shrink-0">
            {printLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Printer size={13} />}
            Imprimir <ChevronDown size={9} />
          </button>

          {/* Descargar */}
          <button ref={downloadBtnRef} onClick={() => { setShowDownloadMenu(v => !v); setShowPrintMenu(false) }}
            disabled={pdfLoading || ordenLoading}
            className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 shrink-0">
            {(pdfLoading || ordenLoading) ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Download size={13} />}
            Descargar <ChevronDown size={9} />
          </button>

          {canEditar && (
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0">
              <Pencil size={13} /> Editar
            </button>
          )}

          {moreActions.length === 1 ? (
            <button onClick={moreActions[0].onClick}
              className="ml-auto flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors shrink-0">
              {moreActions[0].icon && (() => { const Icon = moreActions[0].icon; return <Icon size={13} />; })()} {moreActions[0].label}
            </button>
          ) : (
            <button onClick={() => setShowSheet(true)}
              className="ml-auto flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors shrink-0">
              <MoreHorizontal size={13} /> Más
            </button>
          )}
        </div>

        {/* Popover Imprimir — fixed posicionado sobre el botón */}
        {showPrintMenu && (() => {
          const r = printBtnRef.current?.getBoundingClientRect()
          const style = r ? { position: 'fixed', left: r.left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPrintMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              <MonedaSelector />
              <button onClick={imprimirDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Printer size={14} className="text-slate-400" /> Nota de Entrega
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              <button onClick={imprimirOrdenDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Printer size={14} className="text-slate-400" /> Orden de Despacho
                <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">USD</span>
              </button>
            </div>
          </>
        })()}

        {/* Popover Descargar — fixed posicionado sobre el botón */}
        {showDownloadMenu && (() => {
          const r = downloadBtnRef.current?.getBoundingClientRect()
          const style = r ? { position: 'fixed', left: r.left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDownloadMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              <MonedaSelector />
              <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Download size={14} /> Nota de Entrega
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              <button onClick={() => { descargarOrdenDespacho(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Download size={14} /> Orden de Despacho
                <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">USD</span>
              </button>
            </div>
          </>
        })()}

        {moreActions.length > 1 && (
        <MobileActionSheet
          isOpen={showSheet}
          onClose={() => setShowSheet(false)}
          actions={moreActions}
        />
        )}
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
              <MonedaSelector />
              <button onClick={imprimirDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Printer size={14} className="text-slate-400" /> Nota de Entrega
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              <button onClick={imprimirOrdenDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Printer size={14} className="text-slate-400" /> Orden de Despacho
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
              <MonedaSelector />
              <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <Download size={14} /> Nota de Entrega
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
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

        {/* Más (···) dropdown desktop — o botón directo si solo hay 1 acción */}
        {moreActions.length === 1 ? (
          <button onClick={moreActions[0].onClick}
            className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 transition-colors whitespace-nowrap">
            {moreActions[0].icon && (() => { const Icon = moreActions[0].icon; return <Icon size={12} />; })()} {moreActions[0].label}
          </button>
        ) : (
          <div className="relative ml-auto">
            <button onClick={() => setShowMoreMenu(v => !v)}
              onBlur={() => setTimeout(() => setShowMoreMenu(false), 200)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 transition-colors whitespace-nowrap">
              <MoreHorizontal size={12} /> Más
            </button>
            {showMoreMenu && (
              <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                onMouseDown={e => e.preventDefault()}>
                {moreActions.map((act, i) => (
                  <Fragment key={i}>
                    {act.danger && <div className="border-t border-slate-100 my-1" />}
                    <button onClick={() => { act.onClick(); setShowMoreMenu(false) }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${act.danger ? 'text-red-500 hover:bg-red-50' : act.textColor ? `${act.textColor} hover:bg-slate-50` : 'text-slate-700 hover:bg-slate-50'}`}>
                      {act.icon && <act.icon size={14} />} {act.label}
                    </button>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm despachar / entregada — con detalles de consecuencias */}
      <ConfirmModal
        isOpen={!!accionPendiente && !accionPendiente.isDevolver && !accionPendiente.isAnular}
        onClose={() => setAccionPendiente(null)}
        onConfirm={async () => {
          if (!accionPendiente) return
          await onCambiarEstado(accionPendiente.id, accionPendiente.estado)
          setAccionPendiente(null)
        }}
        title={confirmConfig.confirmTitle || (accionPendiente?.estado === 'despachada' ? '¿Marcar como despachada?' : '¿Marcar como entregada?')}
        message={
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-center">{confirmConfig.confirmMessage || `El despacho ${numDisplay} cambiará de estado.`}</p>
            
            {accionPendiente?.estado === 'despachada' && (
              <div className="w-full text-left bg-slate-50 p-3 rounded-xl text-sm border border-slate-200 mt-2 shadow-sm">
                <h4 className="font-bold text-slate-700 border-b border-slate-200 pb-1.5 mb-2">Resumen de la Operación</h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <span className="text-slate-500">Cliente:</span>
                  <span className="font-semibold text-slate-800 text-right line-clamp-2">{(despacho.cliente_factura || despacho.cliente)?.nombre || 'N/A'}</span>
                  
                  <span className="text-slate-500">Vendedor:</span>
                  <span className="font-semibold text-slate-800 text-right truncate">{despacho.vendedor?.nombre || 'N/A'}</span>

                  {despacho.transportista?.nombre && (
                    <>
                      <span className="text-slate-500">Transporte:</span>
                      <span className="font-semibold text-slate-800 text-right truncate">{despacho.transportista.nombre}</span>
                    </>
                  )}

                  <span className="col-span-2 border-t border-slate-200 my-0.5"></span>

                  <span className="text-slate-500">Subtotal:</span>
                  <span className="font-medium text-slate-700 text-right">{fmtUsd(subtotalProductos)}</span>
                  
                  {fleteUsd > 0 && (
                    <>
                      <span className="text-slate-500">Flete:</span>
                      <span className="font-medium text-emerald-600 text-right">+{fmtUsd(fleteUsd)}</span>
                    </>
                  )}
                  
                  {corteUsd > 0 && (
                    <>
                      <span className="text-slate-500">Corte:</span>
                      <span className="font-medium text-emerald-600 text-right">+{fmtUsd(corteUsd)}</span>
                    </>
                  )}

                  {descuentoTotal > 0 && (
                    <>
                      <span className="text-slate-500">Descuento:</span>
                      <span className="font-medium text-amber-600 text-right">-{fmtUsd(descuentoTotal)}</span>
                    </>
                  )}

                  <span className="col-span-2 border-t border-slate-200 my-0.5"></span>

                  <span className="font-bold text-slate-700 text-[13px] pt-0.5">Total USD:</span>
                  <span className="font-black text-slate-800 text-right text-[14px]">{fmtUsd(totalFinal)}</span>
                </div>
              </div>
            )}

            {hayFaltaStock && accionPendiente?.estado === 'despachada' && (
              <div className="w-full p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 font-bold text-xs flex items-center gap-2 mt-1">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="text-left">Hay productos sin stock suficiente. ¿Aprobar de todas formas?</span>
              </div>
            )}
          </div>
        }
        details={confirmConfig.confirmDetails || ''}
        confirmText={confirmConfig.confirmText || 'Confirmar'}
        variant={hayFaltaStock && accionPendiente?.estado === 'despachada' ? 'warning' : (confirmConfig.variant || 'default')}
      />

      {/* Modal especial para Devolver o Anular desde "despachada" */}
      <DevolverAnularModal
        isOpen={!!accionPendiente && (accionPendiente.isDevolver || accionPendiente.isAnular)}
        onClose={() => setAccionPendiente(null)}
        onConfirm={async (estadoDestino, motivo) => {
          if (!accionPendiente) return
          if (accionPendiente.isDevolver) {
            await onCambiarEstado(accionPendiente.id, estadoDestino, motivo, null)
          } else {
            await onCambiarEstado(accionPendiente.id, estadoDestino, null, motivo)
          }
          setAccionPendiente(null)
        }}
        accion={accionPendiente}
        despachoNum={numDisplay}
        isLoading={estadoCambiando}
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
