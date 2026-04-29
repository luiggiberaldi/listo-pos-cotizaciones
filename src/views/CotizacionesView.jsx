// src/views/CotizacionesView.jsx
// Vista principal: lista de cotizaciones + builder integrado
// El builder reemplaza la lista in-page (sin navegación adicional)
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { FileText, Plus, RefreshCw, AlertTriangle, PackageCheck, Loader2, X, AlertCircle, LayoutGrid, List, ChevronDown, Truck, Receipt } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useCotizaciones, useAnularCotizacion, useActualizarEstado, useReabrirCotizacion, useReciclarCotizacion } from '../hooks/useCotizaciones'
import { useCrearDespacho, useActualizarEstadoDespacho } from '../hooks/useDespachos'
import { useCotizacion } from '../hooks/useCotizaciones'
import { useClientes } from '../hooks/useClientes'
import CotizacionCard    from '../components/cotizaciones/CotizacionCard'
import CotizacionRow     from '../components/cotizaciones/CotizacionRow'
import DetalleModal      from '../components/ui/DetalleModal'
import CotizacionBuilder from '../components/cotizaciones/CotizacionBuilder'
// CotizacionRapida desactivada temporalmente
// import CotizacionRapida  from '../components/cotizaciones/CotizacionRapida'
import ConfirmModal      from '../components/ui/ConfirmModal'
import { Modal }         from '../components/ui/Modal'
import EmptyState        from '../components/ui/EmptyState'
import Skeleton          from '../components/ui/Skeleton'
import { useVendedores } from '../hooks/useClientes'
import { useTransportistas, useCrearTransportista } from '../hooks/useTransportistas'
import VendedorFilterPill from '../components/ui/VendedorFilterPill'
import ToggleVistaPersonal from '../components/ui/ToggleVistaPersonal'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../utils/format'
import { showToast } from '../components/ui/Toast'
import PageHeader from '../components/ui/PageHeader'
import Pagination from '../components/ui/Pagination'
import { OnboardingSequence } from '../components/ui/OnboardingTooltip'
import { getAction } from '../utils/cotizacionActions'
import ReciclarCotizacionModal from '../components/cotizaciones/ReciclarCotizacionModal'
import ClienteFacturaBuscador from '../components/clientes/ClienteFacturaBuscador'

// ─── Filtros de estado ────────────────────────────────────────────────────────
const ESTADOS_FILTRO = [
  { valor: '',          label: 'Todas' },
  { valor: 'borrador',  label: 'Borradores' },
  { valor: 'enviada',   label: 'Enviadas' },
  { valor: 'aceptada',  label: 'Aprobadas' },
  { valor: 'anulada',   label: 'Canceladas' },
]

const ESTADOS_FILTRO_ADMIN = [
  { valor: '',          label: 'Todos' },
  { valor: 'pendiente', label: 'Por aprobar' },
  { valor: 'despachada', label: 'Aprobados' },
  { valor: 'entregada', label: 'Entregados' },
  { valor: 'anulada',   label: 'Anulados' },
]

function SkeletonCotizaciones() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-5 w-3/4 rounded-lg" />
          <Skeleton className="h-3.5 w-1/3 rounded" />
          <div className="pt-2 border-t border-slate-100">
            <Skeleton className="h-5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Modal de resumen para despachar ────────────────────────────────────────
const FORMAS_PAGO = ['Efectivo', 'Zelle', 'Pago Móvil', 'USDT', 'Transferencia', 'Cta por cobrar']

function ModalDespachar({ cotizacion, onConfirm, onCancel, cargando, tasa = 0 }) {
  const { data: detalle } = useCotizacion(cotizacion?.id)
  const { data: clientes = [] } = useClientes()
  const [formasPago, setFormasPago] = useState([]) // [{metodo, monto}]
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [referenciaPago, setReferenciaPago] = useState('')
  const [showTransportistaMenu, setShowTransportistaMenu] = useState(false)
  const [stockMap, setStockMap] = useState({})
  const [notas, setNotas] = useState('')
  const [clienteFacturaId, setClienteFacturaId] = useState('')
  const [showFacturacion, setShowFacturacion] = useState(false)
  const { data: transportistas = [] } = useTransportistas()
  const crearTransp = useCrearTransportista()
  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoRif, setNuevoRif] = useState('')
  const [nuevoVehiculo, setNuevoVehiculo] = useState('')
  const [nuevoColor, setNuevoColor] = useState('')
  const [nuevoPlaca, setNuevoPlaca] = useState('')
  const [nuevoPlacaChuto, setNuevoPlacaChuto] = useState('')
  const [nuevoPlacaBatea, setNuevoPlacaBatea] = useState('')
  const [nuevoError, setNuevoError] = useState('')

  const items = detalle?.items ?? []

  // Fetch stock for items when they load
  useEffect(() => {
    if (items.length === 0) return
    const productIds = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
    if (productIds.length === 0) return
    let cancelled = false
    supabase.rpc('obtener_stock_productos', { p_ids: productIds })
      .then(({ data }) => {
        if (!cancelled && data) setStockMap(Object.fromEntries(data.map(p => [p.id, p.stock_actual])))
      })
    return () => { cancelled = true }
  }, [detalle])

  if (!cotizacion) return null

  const stockIssues = items.filter(i => {
    const stock = stockMap[i.producto_id]
    return stock !== undefined && stock < Number(i.cantidad)
  })

  const numDisplay = `COT-${String(cotizacion.numero).padStart(5, '0')}`

  const totalSinFlete = Number(cotizacion?.total_usd || 0)
  const totalConFlete = totalSinFlete + Number(fleteUsd || 0)
  const montoAsignado = formasPago.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
  const pagoCuadrado = formasPago.length > 0 && Math.abs(montoAsignado - totalSinFlete) < 0.02

  const toggleForma = (metodo) => {
    setFormasPago(prev => {
      const existe = prev.find(fp => fp.metodo === metodo)
      if (existe) return prev.filter(fp => fp.metodo !== metodo)
      // Si es el primero, asignar el total restante automáticamente
      const restante = totalSinFlete - prev.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
      return [...prev, { metodo, monto: restante > 0 ? Number(restante.toFixed(2)) : '' }]
    })
  }

  const setMontoForma = (metodo, monto) => {
    setFormasPago(prev => prev.map(fp => fp.metodo === metodo ? { ...fp, monto } : fp))
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 lg:p-6 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
              <PackageCheck size={18} className="text-indigo-500" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-base leading-tight">Crear orden de despacho</h3>
              <p className="text-xs text-slate-400 font-mono">{numDisplay} · <span className="font-sans font-semibold text-slate-600">{cotizacion.cliente?.nombre ?? '—'}</span></p>
            </div>
          </div>
          <button onClick={onCancel} disabled={cargando}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* ── Body — 2 columnas en desktop ───────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">

          {/* ── Columna izquierda: resumen del pedido ── */}
          <div className="lg:flex-1 min-h-0 overflow-y-auto p-4 lg:p-5 space-y-3 border-b lg:border-b-0 lg:border-r border-slate-100">

            {/* Tabla compacta de items */}
            {items.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Producto</th>
                    <th className="text-center pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide w-14">Cant.</th>
                    <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide w-20 hidden sm:table-cell">P. Unit.</th>
                    <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide w-20">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={item.id || i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium text-slate-700 text-sm">{item.nombre_snap}</span>
                        {item.codigo_snap && (
                          <span className="text-[11px] text-slate-400 font-mono ml-1.5">· {item.codigo_snap}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-center text-slate-600 text-sm whitespace-nowrap">
                        {Number(item.cantidad).toLocaleString('es-VE')} <span className="text-xs text-slate-400">{item.unidad_snap}</span>
                      </td>
                      <td className="py-1.5 text-right text-slate-500 text-sm hidden sm:table-cell">{fmtUsd(item.precio_unit_usd)}</td>
                      <td className="py-1.5 text-right font-bold text-slate-700 text-sm">{fmtUsd(item.total_linea_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Stock warnings */}
            {stockIssues.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
                <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                  <AlertCircle size={14} className="shrink-0" /> Stock insuficiente
                </div>
                {stockIssues.map(item => (
                  <p key={item.id} className="text-xs text-red-600 ml-5">
                    <span className="font-medium">{item.nombre_snap}</span>: necesita {Number(item.cantidad)} — disponible {stockMap[item.producto_id] ?? 0}
                  </p>
                ))}
              </div>
            )}

            {/* Totales */}
            <div className="border-t border-slate-100 pt-3 space-y-1">
              {cotizacion.descuento_usd > 0 && (<>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Subtotal</span><span>{fmtUsd(cotizacion.subtotal_usd)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Descuento ({cotizacion.descuento_global_pct}%)</span>
                  <span className="text-red-400">-{fmtUsd(cotizacion.descuento_usd)}</span>
                </div>
              </>)}
              {cotizacion.costo_envio_usd > 0 && (
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Envío</span><span>{fmtUsd(cotizacion.costo_envio_usd)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-0.5">
                <span className="font-bold text-slate-700 text-sm">Total</span>
                <div className="text-right">
                  <span className="font-black text-slate-800 text-lg">{fmtUsd(cotizacion.total_usd)}</span>
                  {tasa > 0 && <div className="text-xs text-slate-400">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>}
                </div>
              </div>
              {Number(fleteUsd) > 0 && (
                <div className="flex justify-between text-xs text-indigo-500 font-medium">
                  <span>Con flete</span>
                  <span>{fmtUsd(totalConFlete)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Columna derecha: configuración del despacho ── */}
          <div className="lg:w-80 xl:w-96 min-h-0 overflow-y-auto p-4 lg:p-5 space-y-4">

            {/* Formas de pago */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Formas de pago <span className="text-red-500">*</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FORMAS_PAGO.map(fp => {
                  const activo = formasPago.some(f => f.metodo === fp)
                  return (
                    <button key={fp} type="button" onClick={() => toggleForma(fp)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        activo
                          ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                      }`}>
                      {fp}
                    </button>
                  )
                })}
              </div>
              {formasPago.length > 0 && (
                <div className="space-y-1.5 mt-1">
                  {formasPago.map(fp => (
                    <div key={fp.metodo} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500 w-24 truncate shrink-0">{fp.metodo}</span>
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input type="number" min="0" step="0.01" value={fp.monto}
                          onChange={e => setMontoForma(fp.metodo, e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-6 pr-2 py-1.5 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white"
                          disabled={cargando} />
                      </div>
                    </div>
                  ))}
                  <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                    pagoCuadrado ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
                  }`}>
                    <span>Asignado: {fmtUsd(montoAsignado)}</span>
                    <span>Total: {fmtUsd(totalSinFlete)}</span>
                    {pagoCuadrado ? <span>✓</span> : <span>Faltan {fmtUsd(totalSinFlete - montoAsignado)}</span>}
                  </div>
                </div>
              )}
              {formasPago.length === 0 && <p className="text-xs text-slate-400">Selecciona al menos una forma de pago</p>}
            </div>

            {/* Transportista */}
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transportista</p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <button type="button"
                    onClick={() => setShowTransportistaMenu(v => !v)}
                    onBlur={() => setTimeout(() => setShowTransportistaMenu(false), 200)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-slate-200 bg-slate-50 hover:border-indigo-300 transition-colors text-left"
                  >
                    <span className="flex items-center gap-2 truncate min-w-0">
                      <Truck size={13} className="text-slate-400 shrink-0" />
                      {transportistaId
                        ? <span className="text-slate-700 truncate">{transportistas.find(t => t.id === transportistaId)?.nombre || 'Seleccionado'}</span>
                        : <span className="text-slate-400 text-sm">Sin transportista</span>}
                    </span>
                    <ChevronDown size={13} className={`text-slate-400 shrink-0 transition-transform ${showTransportistaMenu ? 'rotate-180' : ''}`} />
                  </button>
                  {showTransportistaMenu && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20 max-h-44 overflow-y-auto"
                      onMouseDown={e => e.preventDefault()}>
                      <button onClick={() => { setTransportistaId(''); setFleteUsd(''); setShowTransportistaMenu(false) }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${!transportistaId ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-500 hover:bg-slate-50'}`}>
                        Sin transportista
                      </button>
                      {transportistas.map(t => (
                        <button key={t.id} onClick={() => { setTransportistaId(t.id); setShowTransportistaMenu(false) }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${transportistaId === t.id ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{t.nombre}</p>
                            {(t.vehiculo || t.placa_chuto) && (
                              <p className="text-xs text-slate-400 truncate">{[t.vehiculo, t.placa_chuto].filter(Boolean).join(' · ')}</p>
                            )}
                          </div>
                          {transportistaId === t.id && <span className="text-indigo-500 shrink-0">✓</span>}
                        </button>
                      ))}
                      {transportistas.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Sin registros</p>}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setShowNuevoTransp(true)} disabled={cargando}
                  className="shrink-0 w-9 h-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                  title="Nuevo transportista">
                  <Plus size={14} className="text-emerald-600" />
                </button>
              </div>
              {transportistaId && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0">Flete USD</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                    <input type="number" min="0" step="0.01" value={fleteUsd}
                      onChange={e => setFleteUsd(e.target.value)} placeholder="0.00"
                      className="w-full pl-6 pr-2 py-1.5 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white"
                      disabled={cargando} />
                  </div>
                </div>
              )}
            </div>

            {/* Notas */}
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notas <span className="font-normal normal-case text-slate-400">(opcional)</span></p>
              <textarea value={notas} onChange={e => setNotas(e.target.value)}
                placeholder="Observaciones internas..."
                className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white transition-colors resize-none"
                rows={2} disabled={cargando} />
            </div>

            {/* Facturar a otro cliente */}
            <div className="space-y-2">
              <button type="button"
                onClick={() => { setShowFacturacion(v => !v); if (showFacturacion) setClienteFacturaId('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  showFacturacion ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}>
                <Receipt size={13} className={showFacturacion ? 'text-violet-500' : 'text-slate-400'} />
                <span className="flex-1 text-left">¿Facturar a otro cliente?</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${showFacturacion ? 'bg-violet-200 text-violet-700' : 'bg-slate-200 text-slate-500'}`}>
                  {showFacturacion ? 'Activo' : 'Opcional'}
                </span>
              </button>
              {showFacturacion && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/30 p-2.5 space-y-2">
                  <p className="text-xs text-violet-600">CxC y PDF se emitirán a nombre de este cliente.</p>
                  <ClienteFacturaBuscador
                    clientes={clientes.filter(c => c.id !== cotizacion?.cliente_id)}
                    clienteId={clienteFacturaId}
                    onSelect={setClienteFacturaId}
                  />
                </div>
              )}
            </div>

          </div>{/* fin col derecha */}
        </div>{/* fin body */}

        {/* ── Footer — botones ───────────────────────────────────── */}
        <div className="flex gap-3 px-5 py-3.5 border-t border-slate-100 shrink-0">
          <button onClick={onCancel} disabled={cargando}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={() => {
              const fpJson = JSON.stringify(formasPago)
              onConfirm(fpJson, transportistaId || null, Number(fleteUsd) || 0, referenciaPago, fpJson, notas, clienteFacturaId || null)
            }} disabled={cargando || items.length === 0 || !pagoCuadrado}
            title={formasPago.length === 0 ? 'Selecciona forma de pago' : !pagoCuadrado ? 'Los montos no cuadran con el total' : undefined}
            className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20">
            {cargando
              ? <><Loader2 size={16} className="animate-spin" />Procesando...</>
              : <><PackageCheck size={16} />Confirmar despacho</>}
          </button>
        </div>
      </div>

      {/* ── Modal overlay: nuevo transportista ── */}
      {showNuevoTransp && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowNuevoTransp(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-100"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <Truck size={15} className="text-emerald-600" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm">Nuevo transportista</h4>
              </div>
              <button onClick={() => setShowNuevoTransp(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
                <X size={15} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {nuevoError && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{nuevoError}</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Nombre <span className="text-red-500">*</span></label>
                  <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                    placeholder="Nombre del transportista"
                    className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">RIF / Cédula</label>
                  <input value={nuevoRif} onChange={e => setNuevoRif(e.target.value)}
                    placeholder="J-12345678-9"
                    className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Vehículo</label>
                  <input value={nuevoVehiculo} onChange={e => setNuevoVehiculo(e.target.value)}
                    placeholder="Gandola, camión..."
                    className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Placa chuto</label>
                  <input value={nuevoPlacaChuto} onChange={e => setNuevoPlacaChuto(e.target.value)}
                    placeholder="ABC-123"
                    className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Placa batea</label>
                  <input value={nuevoPlacaBatea} onChange={e => setNuevoPlacaBatea(e.target.value)}
                    placeholder="XYZ-456"
                    className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Color de etiqueta</label>
                  <input type="color" value={nuevoColor || '#6366f1'} onChange={e => setNuevoColor(e.target.value)}
                    className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer px-1 py-1" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-3.5 border-t border-slate-100">
              <button onClick={() => { setShowNuevoTransp(false); setNuevoError('') }}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!nuevoNombre.trim()) { setNuevoError('El nombre es obligatorio'); return }
                  setNuevoError('')
                  try {
                    const result = await crearTransp.mutateAsync({
                      nombre: nuevoNombre.trim(),
                      rif: nuevoRif.trim() || null,
                      vehiculo: nuevoVehiculo.trim() || null,
                      color: nuevoColor || null,
                      placa_chuto: nuevoPlacaChuto.trim() || null,
                      placa_batea: nuevoPlacaBatea.trim() || null,
                    })
                    if (result?.id) setTransportistaId(result.id)
                    setShowNuevoTransp(false)
                    setNuevoNombre(''); setNuevoRif(''); setNuevoVehiculo('')
                    setNuevoColor(''); setNuevoPlacaChuto(''); setNuevoPlacaBatea('')
                    showToast('Transportista creado', 'success')
                  } catch (e) {
                    setNuevoError(e.message || 'Error al crear transportista')
                  }
                }}
                disabled={crearTransp.isPending}
                className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {crearTransp.isPending ? <><Loader2 size={14} className="animate-spin" />Guardando...</> : 'Guardar transportista'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista lista ──────────────────────────────────────────────────────────────
function ListaCotizaciones({ onNueva, onEditar, despacharCotizacion }) {
  const navigate = useNavigate()
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const esAdministracion = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const { tasaEfectiva } = useTasaCambio()
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [vistaMode, setVistaMode] = useState(() => localStorage.getItem('cotizaciones_vista') || (window.innerWidth < 768 ? 'list' : 'grid'))
  const [cotizacionAAnular, setCotizacionAAnular] = useState(null)
  const [cotizacionADespachar, setCotizacionADespachar] = useState(null)
  const [cotizacionAReciclar, setCotizacionAReciclar] = useState(null)
  const [vendedorReciclar, setVendedorReciclar] = useState('')
  const [cotizacionDetalle, setCotizacionDetalle] = useState(null)

  // Abrir modal de despacho cuando viene del builder
  useEffect(() => {
    if (despacharCotizacion) {
      setCotizacionADespachar(despacharCotizacion)
    }
  }, [despacharCotizacion])

  const { data: cotizaciones = [], isLoading, isError, refetch } = useCotizaciones({ estado: estadoFiltro, veTodos: verTodos })
  const { data: vendedores = [] } = useVendedores()

  // Filtrar por vendedor (solo supervisor) y adaptar para admin
  const cotizacionesFiltradas = useMemo(() => {
    let filtered = cotizaciones
    if (vendedorFiltro) filtered = filtered.filter(c => c.vendedor_id === vendedorFiltro)
    if (esAdministracion) {
      // Admin solo ve cotizaciones que tienen despacho
      filtered = filtered.filter(c => c.despacho)
      if (estadoFiltro) filtered = filtered.filter(c => c.despacho?.estado === estadoFiltro)
    }
    return filtered
  }, [cotizaciones, vendedorFiltro, esAdministracion, estadoFiltro])

  const ITEMS_POR_PAGINA = 12
  const totalPaginas = Math.max(1, Math.ceil(cotizacionesFiltradas.length / ITEMS_POR_PAGINA))
  const cotizacionesPaginadas = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return cotizacionesFiltradas.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [cotizacionesFiltradas, pagina])

  // Reset página al cambiar filtro
  useEffect(() => { setPagina(1) }, [estadoFiltro, vendedorFiltro, verTodos])

  const anular        = useAnularCotizacion()
  const cambiarEstado = useActualizarEstado()
  const crearDespacho = useCrearDespacho()
  const reciclar      = useReciclarCotizacion()
  const cambiarEstadoDespacho = useActualizarEstadoDespacho()

  function handleCambiarEstadoDespacho(despachoId, nuevoEstado) {
    cambiarEstadoDespacho.mutate({ despachoId, nuevoEstado })
  }

  async function confirmarAnular() {
    if (!cotizacionAAnular) return
    await anular.mutateAsync({ id: cotizacionAAnular.id, numero: cotizacionAAnular.numero })
    setCotizacionAAnular(null)
  }

  async function confirmarDespachar(formaPago = '', transportistaId = null, fleteUsd = 0, referenciaPago = '', formaPagoCliente = '', notas = '', clienteFacturaId = null) {
    if (!cotizacionADespachar) return
    try {
      await crearDespacho.mutateAsync({
        cotizacionId: cotizacionADespachar.id,
        formaPago: formaPago || null,
        transportistaId: transportistaId || null,
        fleteUsd: fleteUsd || 0,
        referenciaPago: referenciaPago || null,
        formaPagoCliente: formaPagoCliente || null,
        notas: notas || null,
        clienteFacturaId: clienteFacturaId || null,
      })
      setCotizacionADespachar(null)
      navigate('/despachos')
    } catch (err) {
      showToast(err.message || 'Error al crear despacho', 'error')
    }
  }

  async function confirmarReciclar() {
    if (!cotizacionAReciclar || !vendedorReciclar) return
    try {
      await reciclar.mutateAsync({
        cotizacionId: cotizacionAReciclar.id,
        vendedorDestinoId: vendedorReciclar,
      })
      setCotizacionAReciclar(null)
      setVendedorReciclar('')
    } catch (err) {
      showToast(err.message || 'Error al reciclar cotización', 'error')
    }
  }

  function abrirReciclar(cot) {
    setCotizacionAReciclar(cot)
    setVendedorReciclar(cot.vendedor_id || '')
  }

  // Interceptar cambio de estado
  function handleCambiarEstado(id, estado, numero, clienteNombre, totalUsd, vendedorId) {
    cambiarEstado.mutate({ id, estado, numero, clienteNombre, totalUsd, vendedorId })
  }

  function handleEditar(cot) {
    onEditar(cot)
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={esAdministracion ? PackageCheck : FileText}
        title={esAdministracion ? 'Despachos' : 'Cotizaciones'}
        subtitle={isLoading ? 'Cargando...' : `${cotizacionesFiltradas.length} ${esAdministracion ? 'despacho' : 'cotización'}${cotizacionesFiltradas.length !== 1 ? (esAdministracion ? 's' : 'es') : ''}`}
        action={
          !esAdministracion && (
          <div className="flex items-center gap-2">
            <button onClick={onNueva} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} />Nueva
            </button>
          </div>
          )
        }
      />

      {/* Onboarding tips por rol */}
      <OnboardingSequence rol={perfil?.rol} page="/cotizaciones" />

      {/* Filtros: fila 1 — tabs de estado (scroll horizontal) */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex items-center gap-1.5 w-max pb-0.5">
          {(esAdministracion ? ESTADOS_FILTRO_ADMIN : ESTADOS_FILTRO).map(({ valor, label }) => (
            <button key={valor} onClick={() => setEstadoFiltro(valor)}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors border whitespace-nowrap ${
                estadoFiltro === valor
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-primary/40'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros: fila 2 — toggle vista personal + vendedor + controles de vista */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {(esSupervisor || esDesarrollador) && (
            <ToggleVistaPersonal value={verTodos} onChange={v => { setVerTodos(v); setVendedorFiltro(''); setPagina(1) }} />
          )}
          {(esSupervisor || esDesarrollador) && verTodos && vendedores.length > 1 && (
            <VendedorFilterPill vendedores={vendedores} value={vendedorFiltro} onChange={setVendedorFiltro} />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex bg-slate-100 rounded-xl p-0.5">
            <button type="button" onClick={() => { setVistaMode('grid'); localStorage.setItem('cotizaciones_vista', 'grid') }} title="Vista cuadrícula"
              className={`p-2 rounded-lg transition-colors ${vistaMode === 'grid' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <LayoutGrid size={16} />
            </button>
            <button type="button" onClick={() => { setVistaMode('list'); localStorage.setItem('cotizaciones_vista', 'list') }} title="Vista lista"
              className={`p-2 rounded-lg transition-colors ${vistaMode === 'list' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <List size={16} />
            </button>
          </div>
          <button onClick={() => refetch()} title="Recargar" className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <SkeletonCotizaciones />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar cotizaciones</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : cotizacionesFiltradas.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={estadoFiltro || vendedorFiltro ? 'Sin cotizaciones con estos filtros' : '¡Aún no tienes cotizaciones!'}
          description={estadoFiltro || vendedorFiltro ? 'Prueba con otro filtro.' : 'Crea tu primera cotización para empezar a vender.'}
          actionLabel={estadoFiltro || vendedorFiltro ? 'Limpiar filtros' : 'Nueva cotización'}
          onAction={estadoFiltro || vendedorFiltro ? () => { setEstadoFiltro(''); setVendedorFiltro('') } : onNueva}
        />
      ) : (
        <>
        {vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {cotizacionesPaginadas.map(c => (
              <CotizacionCard
                key={c.id}
                cotizacion={c}
                onEditar={handleEditar}
                onAnular={setCotizacionAAnular}
                onCambiarEstado={handleCambiarEstado}
                onDespachar={setCotizacionADespachar}
                onReciclar={abrirReciclar}
                onCambiarEstadoDespacho={handleCambiarEstadoDespacho}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {cotizacionesPaginadas.map(c => (
              <CotizacionRow
                key={c.id}
                cotizacion={c}
                onEditar={handleEditar}
                onVer={setCotizacionDetalle}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        )}
        {totalPaginas > 1 && (
          <Pagination paginaActual={pagina} totalPaginas={totalPaginas} onCambiarPagina={setPagina} />
        )}
        </>
      )}

      {/* Detalle modal para vista lista */}
      <DetalleModal
        isOpen={!!cotizacionDetalle}
        onClose={() => setCotizacionDetalle(null)}
        tipo="cotizacion"
        registro={cotizacionDetalle}
        tasa={tasaEfectiva}
      />

      {/* Confirm anular — mensaje diferente según rol */}
      <ConfirmModal
        isOpen={!!cotizacionAAnular}
        onClose={() => setCotizacionAAnular(null)}
        onConfirm={confirmarAnular}
        title={getAction('anular', perfil?.rol).confirmTitle || '¿Anular cotización?'}
        message={getAction('anular', perfil?.rol).confirmMessage || 'Esta acción no se puede deshacer.'}
        confirmText={getAction('anular', perfil?.rol).confirmText || 'Sí, anular'}
        variant={getAction('anular', perfil?.rol).variant || 'danger'}
      />

      {/* Modal despachar con resumen */}
      <ModalDespachar
        cotizacion={cotizacionADespachar}
        onConfirm={confirmarDespachar}
        onCancel={() => setCotizacionADespachar(null)}
        cargando={crearDespacho.isPending}
        tasa={tasaEfectiva}
      />

      {/* Modal reciclar cotización */}
      <ReciclarCotizacionModal
        isOpen={!!cotizacionAReciclar}
        cotizacion={cotizacionAReciclar}
        vendedores={vendedores}
        vendedorSeleccionado={vendedorReciclar}
        onVendedorChange={setVendedorReciclar}
        onConfirm={confirmarReciclar}
        onClose={() => { setCotizacionAReciclar(null); setVendedorReciclar('') }}
        isPending={reciclar.isPending}
      />
    </div>
  )
}

// ─── Vista raíz ───────────────────────────────────────────────────────────────
export default function CotizacionesView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [modo,      setModo]      = useState('lista')           // 'lista' | 'builder'
  const [editandoId, setEditandoId] = useState(null)            // ID del borrador a editar
  const [clientePreseleccionado, setClientePreseleccionado] = useState(null) // cliente_id desde URL
  const [pendienteDespachar, setPendienteDespachar] = useState(null)

  // Si viene ?nueva=1 del dashboard o clientes, abrir wizard directamente
  useEffect(() => {
    if (searchParams.get('nueva') === '1') {
      setEditandoId(null)
      setClientePreseleccionado(searchParams.get('cliente') || null)
      setModo('builder')
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { data: cotizacionParaEditar } = useCotizacion(editandoId)
  const reabrirCotizacion = useReabrirCotizacion()

  function abrirNueva() {
    setEditandoId(null)
    setClientePreseleccionado(null)
    setModo('builder')
  }

  async function abrirEditar(cot) {
    // Si no es borrador, reabrir primero (cambiar estado a borrador)
    if (cot.estado !== 'borrador') {
      try {
        await reabrirCotizacion.mutateAsync(cot.id)
      } catch (e) {
        showToast(e.message || 'Error al reabrir cotización', 'error')
        return
      }
    }
    setEditandoId(cot.id)
    setModo('builder')
  }

  function volver() {
    setModo('lista')
    setEditandoId(null)
  }

  if (modo === 'builder') {
    // Si es edición, esperar que cargue la cotización con sus items
    if (editandoId && !cotizacionParaEditar) {
      return (
        <div className="flex items-center justify-center min-h-64">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )
    }

    return (
      <CotizacionBuilder
        cotizacionExistente={editandoId ? cotizacionParaEditar : null}
        clientePreseleccionado={clientePreseleccionado}
        onVolver={volver}
        onGuardado={volver}
        onDespachar={(cot) => { setPendienteDespachar(cot); volver() }}
      />
    )
  }

  return (
    <ListaCotizaciones
      onNueva={abrirNueva}
      onEditar={abrirEditar}
      despacharCotizacion={pendienteDespachar}
    />
  )
}
