// src/views/DespachosView.jsx
// Vista principal de notas de despacho
import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, PackageCheck, RefreshCw, Filter, LayoutGrid, List, FileDown, ChevronDown } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useDespachos, useActualizarEstadoDespacho, useReciclarDespacho } from '../hooks/useDespachos'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useVendedores } from '../hooks/useClientes'
import { getDespachoAction } from '../utils/despachoActions'
import VendedorFilterPill from '../components/ui/VendedorFilterPill'
import DespachoCard from '../components/despachos/DespachoCard'
import DespachoRow  from '../components/despachos/DespachoRow'
import DetalleModal from '../components/ui/DetalleModal'
import ConfirmModal from '../components/ui/ConfirmModal'
import EmptyState   from '../components/ui/EmptyState'
import Skeleton     from '../components/ui/Skeleton'
import PageHeader  from '../components/ui/PageHeader'
import Pagination  from '../components/ui/Pagination'
import { OnboardingSequence } from '../components/ui/OnboardingTooltip'
import { showToast } from '../components/ui/Toast'

import { generarPlantillaNotaEntregaPDF } from '../services/pdf/plantillaNotaEntregaPDF'
import { generarPlantillaOrdenDespachoPDF } from '../services/pdf/plantillaOrdenDespachoPDF'
const ESTADOS_FILTRO = [
  { valor: '',           label: 'Todas' },
  { valor: 'pendiente',  label: 'Pendientes' },
  { valor: 'despachada', label: 'Despachadas' },
  { valor: 'entregada',  label: 'Entregadas' },
  { valor: 'anulada',    label: 'Canceladas' },
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

function PlantillaDropdown({ config }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold border transition-all hover:shadow-sm active:scale-[0.98] min-h-[44px]"
        style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.06), rgba(184,134,11,0.06))', border: '1px solid rgba(27,54,93,0.18)', color: '#1B365D' }}
      >
        <FileDown size={15} />
        Plantilla vacía
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
          <button
            onClick={() => { generarPlantillaNotaEntregaPDF({ config }); setOpen(false) }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors text-slate-700"
          >
            Nota de Entrega
          </button>
          <button
            onClick={() => { generarPlantillaOrdenDespachoPDF({ config }); setOpen(false) }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors text-slate-700"
          >
            Orden de Despacho
          </button>
        </div>
      )}
    </div>
  )
}

export default function DespachosView() {
  const navigate = useNavigate()
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const rol = perfil?.rol || 'vendedor'
  const { tasaEfectiva } = useTasaCambio()
  const { data: config = {} } = useConfigNegocio()
  const { data: vendedores = [] } = useVendedores()
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [vistaMode, setVistaMode] = useState(() => localStorage.getItem('despachos_vista') || (window.innerWidth < 768 ? 'list' : 'grid'))
  const [despachoAAnular, setDespachoAAnular] = useState(null)
  const [despachoAReciclar, setDespachoAReciclar] = useState(null)
  const [despachoDetalle, setDespachoDetalle] = useState(null)

  const { data: despachos = [], isLoading, isError, refetch } = useDespachos({ estado: estadoFiltro })
  const cambiarEstado = useActualizarEstadoDespacho()
  const reciclar = useReciclarDespacho()

  // Filtrar por vendedor (solo supervisor)
  const despachosFiltrados = useMemo(() => {
    if (!vendedorFiltro) return despachos
    return despachos.filter(d => d.vendedor_id === vendedorFiltro)
  }, [despachos, vendedorFiltro])

  const ITEMS_POR_PAGINA = 12
  const totalPaginas = Math.max(1, Math.ceil(despachosFiltrados.length / ITEMS_POR_PAGINA))
  const despachosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return despachosFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [despachosFiltrados, pagina])

  // Reset página al cambiar filtro
  useEffect(() => { setPagina(1) }, [estadoFiltro, vendedorFiltro])

  // Config de confirmación por rol
  const anularConfig = getDespachoAction('anular', rol)
  const reciclarConfig = getDespachoAction('reciclar', rol)

  const anularNumDisplay = despachoAAnular
    ? `DES-${String(despachoAAnular.cotizacion?.numero || despachoAAnular.numero).padStart(5, '0')}`
    : ''

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
      navigate('/cotizaciones')
    } catch (err) {
      showToast(err.message || 'Error al reciclar despacho', 'error')
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={PackageCheck}
        title="Notas de Despacho"
        subtitle={isLoading ? 'Cargando...' : `${despachosFiltrados.length} despacho${despachosFiltrados.length !== 1 ? 's' : ''}`}
        action={
          <PlantillaDropdown config={config} />
        }
      />

      {/* Onboarding tips */}
      <OnboardingSequence rol={rol} page="/despachos" />

      {/* Filtros de estado + vendedor */}
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

        {/* Filtro por vendedor — solo supervisor */}
        {esSupervisor && vendedores.length > 1 && (
          <>
            <div className="w-px h-5 bg-slate-200 mx-1 hidden sm:block" />
            <VendedorFilterPill vendedores={vendedores} value={vendedorFiltro} onChange={setVendedorFiltro} />
          </>
        )}
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
      ) : despachosFiltrados.length === 0 ? (
        <EmptyState
          icon={Package}
          title={estadoFiltro || vendedorFiltro ? 'Sin despachos con estos filtros' : 'No hay notas de despacho'}
          description={estadoFiltro || vendedorFiltro ? 'Prueba con otro filtro.' : 'Las notas se crean al despachar cotizaciones enviadas o aceptadas.'}
          actionLabel={estadoFiltro || vendedorFiltro ? 'Limpiar filtros' : undefined}
          onAction={estadoFiltro || vendedorFiltro ? () => { setEstadoFiltro(''); setVendedorFiltro('') } : undefined}
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

      {/* Confirm anular — con mensajes por rol */}
      <ConfirmModal
        isOpen={!!despachoAAnular}
        onClose={() => setDespachoAAnular(null)}
        onConfirm={confirmarAnular}
        title={anularConfig.confirmTitle || '¿Anular despacho?'}
        message={anularConfig.confirmMessage || 'Se restaurará el stock de los productos al inventario.'}
        details={anularConfig.confirmDetails || 'Esta acción no se puede deshacer.'}
        confirmText={anularConfig.confirmText || 'Sí, anular'}
        variant={anularConfig.variant || 'danger'}
      />

      {/* Confirm reciclar — con mensajes por rol */}
      <ConfirmModal
        isOpen={!!despachoAReciclar}
        onClose={() => setDespachoAReciclar(null)}
        onConfirm={confirmarReciclar}
        title={reciclarConfig.confirmTitle || '¿Reciclar como cotización?'}
        message={reciclarConfig.confirmMessage || 'Se creará una nueva cotización en borrador con los mismos productos y precios.'}
        details={reciclarConfig.confirmDetails || 'El despacho anulado permanecerá en el historial.'}
        confirmText={reciclarConfig.confirmText || 'Sí, reciclar'}
        variant={reciclarConfig.variant || 'warning'}
      />
    </div>
  )
}
