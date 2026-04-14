// src/views/CotizacionesView.jsx
// Vista principal: lista de cotizaciones + builder integrado
// El builder reemplaza la lista in-page (sin navegación adicional)
import { useState } from 'react'
import { FileText, Plus, RefreshCw, Filter, GitBranch, AlertTriangle } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useCotizaciones, useAnularCotizacion, useActualizarEstado, useCrearVersion } from '../hooks/useCotizaciones'
import { useCotizacion } from '../hooks/useCotizaciones'
import CotizacionCard    from '../components/cotizaciones/CotizacionCard'
import CotizacionBuilder from '../components/cotizaciones/CotizacionBuilder'
import ConfirmModal      from '../components/ui/ConfirmModal'
import EmptyState        from '../components/ui/EmptyState'
import Skeleton          from '../components/ui/Skeleton'

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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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

// ─── Modal de confirmación para crear versión ─────────────────────────────────
function ModalVersionar({ cotizacion, onConfirm, onCancel, cargando }) {
  if (!cotizacion) return null
  const num = `COT-${String(cotizacion.numero).padStart(5, '0')}`
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-6 space-y-4">
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

        <div className="flex gap-3">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Creando...</>
              : <><GitBranch size={14} />Crear Rev.{(cotizacion.version ?? 1) + 1}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vista lista ──────────────────────────────────────────────────────────────
function ListaCotizaciones({ onNueva, onEditar, onVersionar }) {
  const { perfil } = useAuthStore()
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [cotizacionAAnular, setCotizacionAAnular] = useState(null)

  const { data: cotizaciones = [], isLoading, isError, refetch } = useCotizaciones({ estado: estadoFiltro })
  const anular        = useAnularCotizacion()
  const cambiarEstado = useActualizarEstado()

  async function confirmarAnular() {
    if (!cotizacionAAnular) return
    await anular.mutateAsync(cotizacionAAnular.id)
    setCotizacionAAnular(null)
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
    <div className="p-6 space-y-6 max-w-screen-xl">

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <FileText size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Cotizaciones</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${cotizaciones.length} cotización${cotizaciones.length !== 1 ? 'es' : ''}`}
            </p>
          </div>
        </div>
        <button onClick={onNueva}
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm">
          <Plus size={16} />
          Nueva cotización
        </button>
      </div>

      {/* Filtros de estado */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-slate-400 shrink-0" />
        {ESTADOS_FILTRO.map(({ valor, label }) => (
          <button key={valor} onClick={() => setEstadoFiltro(valor)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
              estadoFiltro === valor
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-600 border-slate-200 hover:border-primary-focus'
            }`}>
            {label}
          </button>
        ))}
        <button onClick={() => refetch()} className="ml-auto p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cotizaciones.map(c => (
            <CotizacionCard
              key={c.id}
              cotizacion={c}
              onEditar={handleEditar}
              onAnular={setCotizacionAAnular}
              onCambiarEstado={(id, estado) => cambiarEstado.mutate({ id, estado })}
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
    </div>
  )
}

// ─── Vista raíz ───────────────────────────────────────────────────────────────
export default function CotizacionesView() {
  const [modo,      setModo]      = useState('lista')           // 'lista' | 'builder'
  const [editandoId, setEditandoId] = useState(null)            // ID del borrador a editar
  const [versionandoCot, setVersionandoCot] = useState(null)   // cotizacion no-borrador para versionar

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
