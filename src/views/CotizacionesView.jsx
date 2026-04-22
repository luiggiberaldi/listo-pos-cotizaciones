// src/views/CotizacionesView.jsx
// Vista principal: lista de cotizaciones + builder integrado
// El builder reemplaza la lista in-page (sin navegación adicional)
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Plus, RefreshCw, Copy, AlertTriangle, PackageCheck, Loader2, X, AlertCircle, LayoutGrid, List } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useCotizaciones, useAnularCotizacion, useActualizarEstado, useCrearVersion, useReciclarCotizacion } from '../hooks/useCotizaciones'
import { useCrearDespacho } from '../hooks/useDespachos'
import { useCotizacion } from '../hooks/useCotizaciones'
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
import CustomSelect      from '../components/ui/CustomSelect'
import VendedorFilterPill from '../components/ui/VendedorFilterPill'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../utils/format'
import { showToast } from '../components/ui/Toast'
import PageHeader from '../components/ui/PageHeader'
import Pagination from '../components/ui/Pagination'

// ─── Filtros de estado ────────────────────────────────────────────────────────
const ESTADOS_FILTRO = [
  { valor: '',          label: 'Todas' },
  { valor: 'borrador',  label: 'Borradores' },
  { valor: 'enviada',   label: 'Enviadas' },
  { valor: 'aceptada',  label: 'Aceptadas' },
  { valor: 'rechazada', label: 'Rechazadas' },
  { valor: 'vencida',   label: 'Vencidas' },
  { valor: 'anulada',   label: 'Anuladas' },
]

function SkeletonCotizaciones() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
  const [formaPago, setFormaPago] = useState('')
  const [stockMap, setStockMap] = useState({})

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

  const numDisplay = cotizacion.version > 1
    ? `COT-${String(cotizacion.numero).padStart(5, '0')} Rev.${cotizacion.version}`
    : `COT-${String(cotizacion.numero).padStart(5, '0')}`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg p-4 sm:p-6 space-y-4 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <PackageCheck size={20} className="text-indigo-500" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg">Crear orden de despacho</h3>
              <p className="text-sm text-slate-500 font-mono">{numDisplay}</p>
            </div>
          </div>
          <button onClick={onCancel} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Aviso */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Revise el detalle antes de confirmar. Al crear la orden de despacho,
            el <strong>stock se descontará automáticamente</strong> del inventario.
          </p>
        </div>

        {/* Cliente */}
        <div className="bg-slate-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm text-slate-500 font-semibold uppercase">Cliente</span>
          <span className="text-base font-bold text-slate-700 truncate ml-3">{cotizacion.cliente?.nombre ?? '—'}</span>
        </div>

        {/* Tabla de items */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <table className="w-full text-sm hidden sm:table">
                <thead>
                  <tr className="text-sm text-slate-500 uppercase border-b border-slate-100">
                    <th className="text-left py-2 font-semibold">Producto</th>
                    <th className="text-center py-2 font-semibold w-16">Cant.</th>
                    <th className="text-right py-2 font-semibold w-24">P. Unit.</th>
                    <th className="text-right py-2 font-semibold w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={item.id || i} className="border-b border-slate-50">
                      <td className="py-2 pr-2">
                        <p className="font-medium text-slate-700 truncate max-w-[120px] sm:max-w-[200px]">{item.nombre_snap}</p>
                        {item.codigo_snap && (
                          <p className="text-xs text-slate-500 font-mono">{item.codigo_snap}</p>
                        )}
                      </td>
                      <td className="py-2 text-center text-slate-600">
                        {Number(item.cantidad).toLocaleString('es-VE')} {item.unidad_snap}
                      </td>
                      <td className="py-2 text-right text-slate-600">{fmtUsd(item.precio_unit_usd)}</td>
                      <td className="py-2 text-right font-bold text-slate-700">{fmtUsd(item.total_linea_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-slate-100">
                {items.map((item, i) => (
                  <div key={item.id || i} className="py-2.5 px-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-700 text-sm truncate">{item.nombre_snap}</p>
                        {item.codigo_snap && (
                          <p className="text-xs text-slate-500 font-mono">{item.codigo_snap}</p>
                        )}
                      </div>
                      <span className="text-sm font-bold text-slate-700 shrink-0">{fmtUsd(item.total_linea_usd)}</span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-slate-500">
                      <span>{Number(item.cantidad).toLocaleString('es-VE')} {item.unidad_snap}</span>
                      <span>× {fmtUsd(item.precio_unit_usd)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Stock warnings */}
        {stockIssues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
              <AlertCircle size={15} className="shrink-0" />
              Stock insuficiente
            </div>
            {stockIssues.map(item => (
              <p key={item.id} className="text-xs text-red-600 ml-5">
                <span className="font-medium">{item.nombre_snap}</span>: necesita {Number(item.cantidad)} — disponible {stockMap[item.producto_id] ?? 0}
              </p>
            ))}
          </div>
        )}

        {/* Totales */}
        <div className="border-t border-slate-200 pt-3 space-y-1">
          {cotizacion.descuento_usd > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Subtotal</span>
              <span className="text-slate-600">{fmtUsd(cotizacion.subtotal_usd)}</span>
            </div>
          )}
          {cotizacion.descuento_usd > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Descuento ({cotizacion.descuento_global_pct}%)</span>
              <span className="text-red-500">-{fmtUsd(cotizacion.descuento_usd)}</span>
            </div>
          )}
          {cotizacion.costo_envio_usd > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Envío</span>
              <span className="text-slate-600">{fmtUsd(cotizacion.costo_envio_usd)}</span>
            </div>
          )}
          <div className="flex justify-between text-base pt-1">
            <span className="font-bold text-slate-700">Total</span>
            <div className="text-right">
              <span className="font-black text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
              {tasa > 0 && (
                <div className="text-sm text-slate-500">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
              )}
            </div>
          </div>
        </div>

        {/* Forma de pago */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Forma de pago <span className="text-red-500">*</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {FORMAS_PAGO.map(fp => (
              <button key={fp} type="button"
                onClick={() => setFormaPago(fp === formaPago ? '' : fp)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  formaPago === fp
                    ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                }`}>
                {fp}
              </button>
            ))}
          </div>
          {!formaPago && (
            <p className="text-xs text-slate-400">Selecciona una forma de pago para continuar</p>
          )}
        </div>

        {/* Botones — despachar */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-base hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={() => onConfirm(formaPago)} disabled={cargando || items.length === 0 || !formaPago}
            title={!formaPago ? 'Selecciona una forma de pago' : undefined}
            className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20">
            {cargando
              ? <><Loader2 size={16} className="animate-spin" />Procesando...</>
              : <><PackageCheck size={16} />Confirmar despacho</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de confirmación para crear versión ─────────────────────────────────
function ModalVersionar({ cotizacion, onConfirm, onCancel, cargando }) {
  if (!cotizacion) return null
  const num = `COT-${String(cotizacion.numero).padStart(5, '0')}`
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <Copy size={20} className="text-primary" />
          </div>
          <h3 className="font-black text-slate-800 text-lg">Crear copia editable</h3>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>{num}</strong> ya fue enviada y no se puede modificar. Se creará una <strong>copia editable</strong> (Rev.{(cotizacion.version ?? 1) + 1}) con los mismos datos, y la cotización original quedará <strong>anulada automáticamente</strong>.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-base hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={cargando}
            className="flex-1 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Creando...</>
              : <><Copy size={16} />Crear copia editable</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vista lista ──────────────────────────────────────────────────────────────
function ListaCotizaciones({ onNueva, onEditar, onVersionar }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { tasaEfectiva } = useTasaCambio()
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [vistaMode, setVistaMode] = useState(() => localStorage.getItem('cotizaciones_vista') || 'grid')
  const [cotizacionAAnular, setCotizacionAAnular] = useState(null)
  const [cotizacionADespachar, setCotizacionADespachar] = useState(null)
  const [cotizacionAReciclar, setCotizacionAReciclar] = useState(null)
  const [vendedorReciclar, setVendedorReciclar] = useState('')
  const [cotizacionDetalle, setCotizacionDetalle] = useState(null)

  const { data: cotizaciones = [], isLoading, isError, refetch } = useCotizaciones({ estado: estadoFiltro })
  const { data: vendedores = [] } = useVendedores()

  // Filtrar por vendedor (solo supervisor)
  const cotizacionesFiltradas = useMemo(() => {
    if (!vendedorFiltro) return cotizaciones
    return cotizaciones.filter(c => c.vendedor_id === vendedorFiltro)
  }, [cotizaciones, vendedorFiltro])

  const ITEMS_POR_PAGINA = 12
  const totalPaginas = Math.max(1, Math.ceil(cotizacionesFiltradas.length / ITEMS_POR_PAGINA))
  const cotizacionesPaginadas = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return cotizacionesFiltradas.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [cotizacionesFiltradas, pagina])

  // Reset página al cambiar filtro
  useEffect(() => { setPagina(1) }, [estadoFiltro, vendedorFiltro])

  const anular        = useAnularCotizacion()
  const cambiarEstado = useActualizarEstado()
  const crearDespacho = useCrearDespacho()
  const reciclar      = useReciclarCotizacion()

  async function confirmarAnular() {
    if (!cotizacionAAnular) return
    await anular.mutateAsync({ id: cotizacionAAnular.id, numero: cotizacionAAnular.numero })
    setCotizacionAAnular(null)
  }

  async function confirmarDespachar(formaPago = '') {
    if (!cotizacionADespachar) return
    try {
      await crearDespacho.mutateAsync({
        cotizacionId: cotizacionADespachar.id,
        formaPago: formaPago || null,
      })
      setCotizacionADespachar(null)
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

  // Al hacer click en "editar": si es borrador → editar directo; si no → versionar
  function handleEditar(cot) {
    if (cot.estado === 'borrador') {
      onEditar(cot)
    } else {
      onVersionar(cot)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* Encabezado */}
      <PageHeader
        icon={FileText}
        title="Cotizaciones"
        subtitle={isLoading ? 'Cargando...' : `${cotizacionesFiltradas.length} cotización${cotizacionesFiltradas.length !== 1 ? 'es' : ''}`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={onNueva} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} />Nueva
            </button>
          </div>
        }
      />

      {/* Filtros: fila 1 — tabs de estado (scroll horizontal) */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex items-center gap-1.5 w-max pb-0.5">
          {ESTADOS_FILTRO.map(({ valor, label }) => (
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

      {/* Filtros: fila 2 — vendedor + controles de vista */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {esSupervisor && vendedores.length > 1 && (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {cotizacionesPaginadas.map(c => (
              <CotizacionCard
                key={c.id}
                cotizacion={c}
                onEditar={handleEditar}
                onAnular={setCotizacionAAnular}
                onCambiarEstado={(id, estado, numero, clienteNombre, totalUsd, vendedorId) => cambiarEstado.mutate({ id, estado, numero, clienteNombre, totalUsd, vendedorId })}
                onDespachar={setCotizacionADespachar}
                onReciclar={abrirReciclar}
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

      {/* Confirm anular */}
      <ConfirmModal
        isOpen={!!cotizacionAAnular}
        onClose={() => setCotizacionAAnular(null)}
        onConfirm={confirmarAnular}
        title="¿Anular cotización?"
        message={`La cotización quedará anulada y no podrá editarse.\nEsta acción no se puede deshacer.`}
        confirmText="Sí, anular"
        variant="danger"
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
      <Modal
        isOpen={!!cotizacionAReciclar}
        onClose={() => { setCotizacionAReciclar(null); setVendedorReciclar('') }}
        title="Reciclar cotización"
      >
        {cotizacionAReciclar && (
          <div className="space-y-4">
            {/* Info de la cotización original */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cotización original</p>
              <p className="text-sm font-bold text-slate-800">
                COT-{String(cotizacionAReciclar.numero).padStart(5, '0')}
                <span className="ml-2 text-xs font-normal text-slate-500">({cotizacionAReciclar.estado})</span>
              </p>
              <p className="text-sm text-slate-600">{cotizacionAReciclar.cliente?.nombre ?? '—'}</p>
              <p className="text-sm text-slate-500">
                Vendedor anterior: <span className="font-semibold text-slate-700">{cotizacionAReciclar.vendedor?.nombre ?? '—'}</span>
              </p>
              <p className="text-sm font-bold text-slate-800">${Number(cotizacionAReciclar.total_usd || 0).toFixed(2)} USD</p>
            </div>

            {/* Selector de vendedor */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">Asignar a vendedor *</label>
              <CustomSelect
                options={vendedores.map(v => ({
                  value: v.id,
                  label: `${v.nombre}${v.id === cotizacionAReciclar.vendedor_id ? ' (anterior)' : ''}`,
                }))}
                value={vendedorReciclar}
                onChange={setVendedorReciclar}
                placeholder="Seleccionar vendedor..."
              />
            </div>

            <p className="text-xs text-slate-400">
              Se creará una nueva cotización en borrador con nuevo número de correlativo, asignada al vendedor seleccionado.
              La cotización original no se modifica.
            </p>

            {/* Botones */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setCotizacionAReciclar(null); setVendedorReciclar('') }}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarReciclar}
                disabled={!vendedorReciclar || reciclar.isPending}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {reciclar.isPending ? (
                  <><Loader2 size={16} className="animate-spin" /> Reciclando...</>
                ) : (
                  <><RefreshCw size={16} /> Reciclar</>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ─── Vista raíz ───────────────────────────────────────────────────────────────
export default function CotizacionesView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [modo,      setModo]      = useState('lista')           // 'lista' | 'builder'
  const [editandoId, setEditandoId] = useState(null)            // ID del borrador a editar
  const [clientePreseleccionado, setClientePreseleccionado] = useState(null) // cliente_id desde URL

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
  const crearVersion = useCrearVersion()

  function abrirNueva() {
    setEditandoId(null)
    setClientePreseleccionado(null)
    setModo('builder')
  }

  function abrirEditar(cot) {
    setEditandoId(cot.id)
    setModo('builder')
  }

  function volver() {
    setModo('lista')
    setEditandoId(null)
  }

  // Cuando el usuario quiere "editar" una cotización NO borrador → crear versión automáticamente
  async function iniciarVersionado(cot) {
    try {
      const nuevoId = await crearVersion.mutateAsync(cot.id)
      showToast(`Se creó Rev.${(cot.version || 1) + 1} como borrador editable. La cotización original fue anulada.`, 'success')
      setEditandoId(nuevoId)
      setModo('builder')
    } catch (e) {
      showToast(e.message || 'Error al crear versión', 'error')
    }
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
      />
    )
  }

  return (
    <>
      <ListaCotizaciones
        onNueva={abrirNueva}
        onEditar={abrirEditar}
        onVersionar={iniciarVersionado}
      />

    </>
  )
}
