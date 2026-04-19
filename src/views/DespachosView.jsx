// src/views/DespachosView.jsx
// Vista principal de notas de despacho
import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, PackageCheck, RefreshCw, Filter, RefreshCcw, AlertTriangle, LayoutGrid, List } from 'lucide-react'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useDespachos, useActualizarEstadoDespacho, useReciclarDespacho } from '../hooks/useDespachos'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import DespachoCard from '../components/despachos/DespachoCard'
import DespachoRow  from '../components/despachos/DespachoRow'
import DetalleModal from '../components/ui/DetalleModal'
import ConfirmModal from '../components/ui/ConfirmModal'
import EmptyState   from '../components/ui/EmptyState'
import Skeleton     from '../components/ui/Skeleton'
import PageHeader  from '../components/ui/PageHeader'
import Pagination  from '../components/ui/Pagination'
import { showToast } from '../components/ui/Toast'

// ─── Filtros de estado ──────────────────────────────────────────────────────
const ESTADOS_FILTRO = [
  { valor: '',           label: 'Todas' },
  { valor: 'pendiente',  label: 'Pendientes' },
  { valor: 'despachada', label: 'Despachadas' },
  { valor: 'entregada',  label: 'Entregadas' },
  { valor: 'anulada',    label: 'Anuladas' },
]

function SkeletonDespachos() {
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

export default function DespachosView() {
  const navigate = useNavigate()
  const { tasaEfectiva } = useTasaCambio()
  const { data: config = {} } = useConfigNegocio()
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [vistaMode, setVistaMode] = useState(() => localStorage.getItem('despachos_vista') || 'grid')
  const [despachoAAnular, setDespachoAAnular] = useState(null)
  const [despachoAReciclar, setDespachoAReciclar] = useState(null)
  const [despachoDetalle, setDespachoDetalle] = useState(null)

  const { data: despachos = [], isLoading, isError, refetch } = useDespachos({ estado: estadoFiltro })
  const cambiarEstado = useActualizarEstadoDespacho()
  const reciclar = useReciclarDespacho()

  const ITEMS_POR_PAGINA = 12
  const totalPaginas = Math.max(1, Math.ceil(despachos.length / ITEMS_POR_PAGINA))
  const despachosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return despachos.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [despachos, pagina])

  // Reset página al cambiar filtro
  useEffect(() => { setPagina(1) }, [estadoFiltro])

  async function confirmarAnular() {
    if (!despachoAAnular) return
    await cambiarEstado.mutateAsync({ despachoId: despachoAAnular.id, nuevoEstado: 'anulada' })
    setDespachoAAnular(null)
  }

  async function confirmarReciclar() {
    if (!despachoAReciclar) return
    try {
      await reciclar.mutateAsync(despachoAReciclar.id)
      setDespachoAReciclar(null)
      // Navegar a cotizaciones para que vea el nuevo borrador
      navigate('/cotizaciones')
    } catch (err) {
      showToast(err.message || 'Error al reciclar despacho', 'error')
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* Encabezado */}
      <PageHeader
        icon={PackageCheck}
        title="Notas de Despacho"
        subtitle={isLoading ? 'Cargando...' : `${despachos.length} despacho${despachos.length !== 1 ? 's' : ''}`}
      />

      {/* Filtros de estado */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-slate-400 shrink-0" />
        {ESTADOS_FILTRO.map(({ valor, label }) => (
          <button key={valor} onClick={() => setEstadoFiltro(valor)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
              estadoFiltro === valor
                ? 'bg-indigo-500 text-white border-indigo-500'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
            }`}>
            {label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <div className="flex bg-slate-100 rounded-xl p-0.5">
            <button type="button" onClick={() => { setVistaMode('grid'); localStorage.setItem('despachos_vista', 'grid') }} title="Vista cuadrícula"
              className={`p-2 rounded-lg transition-colors ${vistaMode === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <LayoutGrid size={16} />
            </button>
            <button type="button" onClick={() => { setVistaMode('list'); localStorage.setItem('despachos_vista', 'list') }} title="Vista lista"
              className={`p-2 rounded-lg transition-colors ${vistaMode === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <List size={16} />
            </button>
          </div>
          <button onClick={() => refetch()} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <SkeletonDespachos />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar despachos</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : despachos.length === 0 ? (
        <EmptyState
          icon={Package}
          title={estadoFiltro ? `Sin despachos ${estadoFiltro}s` : 'No hay notas de despacho'}
          description={estadoFiltro ? 'Prueba con otro filtro.' : 'Las notas se crean al despachar cotizaciones enviadas o aceptadas.'}
          actionLabel={estadoFiltro ? 'Ver todas' : undefined}
          onAction={estadoFiltro ? () => setEstadoFiltro('') : undefined}
        />
      ) : (
        <>
        {vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {despachosPaginados.map(d => (
              <DespachoCard
                key={d.id}
                despacho={d}
                onCambiarEstado={(id, estado) => cambiarEstado.mutateAsync({ despachoId: id, nuevoEstado: estado })}
                onAnular={setDespachoAAnular}
                onReciclar={setDespachoAReciclar}
                tasa={tasaEfectiva}
                config={config}
                estadoCambiando={cambiarEstado.isPending}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {despachosPaginados.map(d => (
              <DespachoRow
                key={d.id}
                despacho={d}
                onVer={setDespachoDetalle}
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
        isOpen={!!despachoDetalle}
        onClose={() => setDespachoDetalle(null)}
        tipo="despacho"
        registro={despachoDetalle}
        tasa={tasaEfectiva}
      />

      {/* Confirm anular */}
      <ConfirmModal
        isOpen={!!despachoAAnular}
        onClose={() => setDespachoAAnular(null)}
        onConfirm={confirmarAnular}
        title="¿Anular despacho?"
        message={`Se restaurará el stock de los productos al inventario.\nEsta acción no se puede deshacer.`}
        confirmText="Sí, anular"
        variant="danger"
      />

      {/* Confirm reciclar */}
      <ConfirmModal
        isOpen={!!despachoAReciclar}
        onClose={() => setDespachoAReciclar(null)}
        onConfirm={confirmarReciclar}
        title="¿Reciclar como cotización?"
        message={`Se creará una nueva cotización en borrador con los mismos productos y precios, lista para editar y enviar.\nEl despacho anulado permanecerá en el historial.`}
        confirmText="Sí, reciclar"
        variant="warning"
      />
    </div>
  )
}
