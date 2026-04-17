// src/views/CotizacionesView.jsx
// Vista principal: lista de cotizaciones + builder integrado
// El builder reemplaza la lista in-page (sin navegación adicional)
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Plus, RefreshCw, Filter, GitBranch, AlertTriangle, PackageCheck, Loader2, X } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useCotizaciones, useAnularCotizacion, useActualizarEstado, useCrearVersion, useReciclarCotizacion } from '../hooks/useCotizaciones'
import { useCrearDespacho } from '../hooks/useDespachos'
import { useCotizacion } from '../hooks/useCotizaciones'
import CotizacionCard    from '../components/cotizaciones/CotizacionCard'
import CotizacionBuilder from '../components/cotizaciones/CotizacionBuilder'
import ConfirmModal      from '../components/ui/ConfirmModal'
import { Modal }         from '../components/ui/Modal'
import EmptyState        from '../components/ui/EmptyState'
import Skeleton          from '../components/ui/Skeleton'
import { useVendedores } from '../hooks/useClientes'
import CustomSelect      from '../components/ui/CustomSelect'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../utils/format'
import PageHeader from '../components/ui/PageHeader'

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
function ModalDespachar({ cotizacion, onConfirm, onCancel, cargando, tasa = 0 }) {
  const { data: detalle } = useCotizacion(cotizacion?.id)
  if (!cotizacion) return null

  const items = detalle?.items ?? []
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
            <table className="w-full text-sm">
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
                      <p className="font-medium text-slate-700 truncate max-w-[200px]">{item.nombre_snap}</p>
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
          )}
        </div>

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

        {/* Botones */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-base hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={cargando || items.length === 0}
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
            <GitBranch size={20} className="text-primary" />
          </div>
          <h3 className="font-black text-slate-800 text-lg">Crear nueva versión</h3>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>{num}</strong> ya fue enviada y no se puede modificar directamente.
            Se creará un <strong>Rev.{(cotizacion.version ?? 1) + 1}</strong> como borrador
            copiando los items actuales.
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
              : <><GitBranch size={16} />Crear Rev.{(cotizacion.version ?? 1) + 1}</>}
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
  const [cotizacionAAnular, setCotizacionAAnular] = useState(null)
  const [cotizacionADespachar, setCotizacionADespachar] = useState(null)
  const [cotizacionAReciclar, setCotizacionAReciclar] = useState(null)
  const [vendedorReciclar, setVendedorReciclar] = useState('')

  const { data: cotizaciones = [], isLoading, isError, refetch } = useCotizaciones({ estado: estadoFiltro })
  const { data: vendedores = [] } = useVendedores()
  const anular        = useAnularCotizacion()
  const cambiarEstado = useActualizarEstado()
  const crearDespacho = useCrearDespacho()
  const reciclar      = useReciclarCotizacion()

  async function confirmarAnular() {
    if (!cotizacionAAnular) return
    await anular.mutateAsync({ id: cotizacionAAnular.id, numero: cotizacionAAnular.numero })
    setCotizacionAAnular(null)
  }

  async function confirmarDespachar() {
    if (!cotizacionADespachar) return
    try {
      await crearDespacho.mutateAsync({ cotizacionId: cotizacionADespachar.id })
      setCotizacionADespachar(null)
    } catch (err) {
      alert(err.message || 'Error al crear despacho')
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
      alert(err.message || 'Error al reciclar cotización')
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
        subtitle={isLoading ? 'Cargando...' : `${cotizaciones.length} cotización${cotizaciones.length !== 1 ? 'es' : ''}`}
        action={
          <button onClick={onNueva} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            <Plus size={16} />Nueva cotización
          </button>
        }
      />

      {/* Filtros de estado */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Filter size={16} className="text-slate-500 shrink-0" />
        {ESTADOS_FILTRO.map(({ valor, label }) => (
          <button key={valor} onClick={() => setEstadoFiltro(valor)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors border ${
              estadoFiltro === valor
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-700 border-slate-200 hover:border-primary-focus'
            }`}>
            {label}
          </button>
        ))}
        <button onClick={() => refetch()} title="Recargar" className="ml-auto p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <SkeletonCotizaciones />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar cotizaciones</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : cotizaciones.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={estadoFiltro ? `Sin cotizaciones ${estadoFiltro}s` : 'No hay cotizaciones aún'}
          description={estadoFiltro ? 'Prueba con otro filtro.' : 'Crea tu primera cotización.'}
          actionLabel={estadoFiltro ? 'Ver todas' : 'Nueva cotización'}
          onAction={estadoFiltro ? () => setEstadoFiltro('') : onNueva}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {cotizaciones.map(c => (
            <CotizacionCard
              key={c.id}
              cotizacion={c}
              onEditar={handleEditar}
              onAnular={setCotizacionAAnular}
              onCambiarEstado={(id, estado) => cambiarEstado.mutate({ id, estado })}
              onDespachar={setCotizacionADespachar}
              onReciclar={abrirReciclar}
              tasa={tasaEfectiva}
            />
          ))}
        </div>
      )}

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
  const [versionandoCot, setVersionandoCot] = useState(null)   // cotizacion no-borrador para versionar

  // Si viene ?nueva=1 del dashboard, abrir wizard directamente
  useEffect(() => {
    if (searchParams.get('nueva') === '1') {
      setEditandoId(null)
      setModo('builder')
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { data: cotizacionParaEditar } = useCotizacion(editandoId)
  const crearVersion = useCrearVersion()

  function abrirNueva() {
    setEditandoId(null)
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

  // Cuando el usuario quiere "editar" una cotización NO borrador
  function iniciarVersionado(cot) {
    setVersionandoCot(cot)
  }

  async function confirmarVersionar() {
    if (!versionandoCot) return
    try {
      const nuevoId = await crearVersion.mutateAsync(versionandoCot.id)
      setVersionandoCot(null)
      // Abrir el nuevo borrador en el builder
      setEditandoId(nuevoId)
      setModo('builder')
    } catch (e) {
      setVersionandoCot(null)
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

      {/* Modal de versionado */}
      <ModalVersionar
        cotizacion={versionandoCot}
        onConfirm={confirmarVersionar}
        onCancel={() => setVersionandoCot(null)}
        cargando={crearVersion.isPending}
      />
    </>
  )
}
