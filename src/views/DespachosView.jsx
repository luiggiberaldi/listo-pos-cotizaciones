// src/views/DespachosView.jsx
// Vista principal de notas de despacho
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, PackageCheck, RefreshCw as _RefreshCw, Filter as _Filter, LayoutGrid as _LayoutGrid, List as _List, FileDown as _FileDown, ChevronDown as _ChevronDown, Search as _Search, X as _X } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useDespachos, useActualizarEstadoDespacho, useReciclarDespacho, useStockCheckDespachos } from '../hooks/useDespachos'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useVendedores } from '../hooks/useClientes'
import { getDespachoAction } from '../utils/despachoActions'
import { getFiltrosDespacho } from '../utils/estadoLabels'
import _VendedorFilterPill from '../components/ui/VendedorFilterPill'
import _ToggleVistaPersonal from '../components/ui/ToggleVistaPersonal'
import _DespachoCard from '../components/despachos/DespachoCard'
import _DespachoRow  from '../components/despachos/DespachoRow'
import _EditDespachoModal from '../components/despachos/EditDespachoModal'
import _DetalleModal from '../components/ui/DetalleModal'
import _ConfirmModal from '../components/ui/ConfirmModal'
import _EmptyState   from '../components/ui/EmptyState'
import _Skeleton     from '../components/ui/Skeleton'
import _PageHeader  from '../components/ui/PageHeader'
import _Pagination  from '../components/ui/Pagination'
import { OnboardingSequence as _OnboardingSequence } from '../components/ui/OnboardingTooltip'
import { showToast } from '../components/ui/Toast'
import { rankEntities } from '../utils/entitySearch'

function SkeletonDespachos() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <_Skeleton className="h-4 w-1/2 rounded" />
          <_Skeleton className="h-5 w-3/4 rounded-lg" />
          <_Skeleton className="h-3.5 w-1/3 rounded" />
          <div className="pt-2 border-t border-slate-100">
            <_Skeleton className="h-5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EstadoDropdown({ filtros, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const activeLabel = filtros.find(f => f.valor === value)?.label || 'Todos'

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors bg-indigo-500 text-white border-indigo-500">
        <_Filter size={12} />
        {activeLabel}
        <_ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
          {filtros.map(({ valor, label }) => (
            <button key={valor} onClick={() => { onChange(valor); setOpen(false) }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                value === valor ? 'bg-indigo-50 text-indigo-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}
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
        <_FileDown size={15} />
        Plantilla vacía
        <_ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
          <button
            onClick={async () => {
              const { generarPlantillaNotaEntregaPDF } = await import('../services/pdf/plantillaNotaEntregaPDF')
              generarPlantillaNotaEntregaPDF({ config })
              setOpen(false)
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors text-slate-700"
          >
            Nota de Entrega
          </button>
          <button
            onClick={async () => {
              const { generarPlantillaOrdenDespachoPDF } = await import('../services/pdf/plantillaOrdenDespachoPDF')
              generarPlantillaOrdenDespachoPDF({ config, incluirTransporte: true })
              setOpen(false)
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors text-slate-700"
          >
            Orden de Despacho
          </button>
        </div>
      )}
    </div>
  )
}

// Alias con prefijo para que el linter identifique los componentes usados en JSX.
const _SkeletonDespachos = SkeletonDespachos
const _EstadoDropdown = EstadoDropdown
const _PlantillaDropdown = PlantillaDropdown

export default function DespachosView() {
  const navigate = useNavigate()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esAdministracion = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esLogistica = perfil?.rol === 'logistica'
  const esPrivilegiado = esSupervisor || esAdministracion || esDesarrollador
  const rol = perfil?.rol || 'vendedor'
  // "Hoy" es un filtro temporal de la vista; los filtros de estado puros
  // permanecen en estadoLabels para que puedan reutilizarse sin fecha implícita.
  const filtrosDespacho = useMemo(() => [
    { valor: 'hoy', label: 'Hoy' },
    ...getFiltrosDespacho(rol),
  ], [rol])
  const { tasaEfectiva } = useTasaCambio()
  const { data: config = {} } = useConfigNegocio()
  const { data: vendedores = [] } = useVendedores()
  const [estadoFiltro, setEstadoFiltro] = useState('hoy')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [busquedaGlobal, setBusquedaGlobal] = useState('')
  const [debouncedBusqueda, setDebouncedBusqueda] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [vistaMode, setVistaMode] = useState(() => {
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = businessId ? `despachos_vista-${businessId}` : 'despachos_vista'
    return localStorage.getItem(key) || 'grid'
  })
  const [despachoAAnular, setDespachoAAnular] = useState(null)
  const [despachoAReciclar, setDespachoAReciclar] = useState(null)
  const [despachoDetalle, setDespachoDetalle] = useState(null)
  const [despachoEditar, setDespachoEditar] = useState(null)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedBusqueda(busquedaGlobal)
    }, 450)
    return () => clearTimeout(handler)
  }, [busquedaGlobal])

  const { data: despachos = [], isLoading, isError, refetch } = useDespachos({
    estado: estadoFiltro === 'hoy' ? '' : estadoFiltro,
    veTodos: verTodos,
    busqueda: debouncedBusqueda,
    esHoy: estadoFiltro === 'hoy'
  })
  const cambiarEstado = useActualizarEstadoDespacho()
  const reciclar = useReciclarDespacho()

  // Filtrar los vendedores en el selector para mostrar solo los que tienen despachos en el rango/estado/búsqueda seleccionado
  const vendedoresFiltrados = useMemo(() => {
    if (!despachos || despachos.length === 0) return []
    
    // Filtro por fecha/estado/búsqueda similar al de despachosFiltrados, pero sin filtrar por vendedor
    let lista = despachos
    if (estadoFiltro === 'hoy') {
      const today = new Date()
      lista = lista.filter(d => {
        if (!d.creado_en || d.estado === 'anulada') return false
        const dateObj = new Date(d.creado_en)
        return (
          dateObj.getDate() === today.getDate() &&
          dateObj.getMonth() === today.getMonth() &&
          dateObj.getFullYear() === today.getFullYear()
        )
      })
    } else if (estadoFiltro) {
      lista = lista.filter(d => d.estado === estadoFiltro)
    } else {
      lista = lista.filter(d => d.estado !== 'anulada')
    }

    if (busquedaGlobal) {
      lista = rankEntities(lista, busquedaGlobal, [
        { get: d => `dsp-${String(d.numero).padStart(5, '0')} ${d.numero}`, weight: 10 },
        { get: d => d.cotizacion?.numero ? `cot-${String(d.cotizacion.numero).padStart(5, '0')} ${d.cotizacion.numero}` : '', weight: 9 },
        { get: d => d.cliente?.nombre, weight: 9 },
        { get: d => d.cliente?.rif_cedula, weight: 9 },
        { get: d => d.cliente?.codigo_cliente, weight: 8 },
        { get: d => d.cotizacion?.total_usd, weight: 7 },
      ])
    }

    const idsConDespachos = new Set(lista.map(d => d.vendedor_id).filter(Boolean))
    return vendedores.filter(v => idsConDespachos.has(v.id))
  }, [despachos, vendedores, estadoFiltro, busquedaGlobal])

  // Limpiar filtro de vendedor si el vendedor seleccionado ya no tiene despachos en el rango seleccionado
  useEffect(() => {
    if (!vendedorFiltro) return undefined
    const existe = vendedoresFiltrados.some(v => v.id === vendedorFiltro)
    if (existe) return undefined
    const resetId = setTimeout(() => setVendedorFiltro(''), 0)
    return () => clearTimeout(resetId)
  }, [vendedoresFiltrados, vendedorFiltro])

  // Filtrar por vendedor (solo supervisor)
  const despachosFiltrados = useMemo(() => {
    let lista = vendedorFiltro ? despachos.filter(d => d.vendedor_id === vendedorFiltro) : despachos
    
    // Filtro por estado o por fecha "Hoy"
    if (estadoFiltro === 'hoy') {
      const today = new Date()
      lista = lista.filter(d => {
        if (!d.creado_en || d.estado === 'anulada') return false
        const dateObj = new Date(d.creado_en)
        return (
          dateObj.getDate() === today.getDate() &&
          dateObj.getMonth() === today.getMonth() &&
          dateObj.getFullYear() === today.getFullYear()
        )
      })
    } else if (estadoFiltro) {
      lista = lista.filter(d => d.estado === estadoFiltro)
    } else {
      // Si el estadoFiltro es '' (Todos), excluir anulados por defecto
      lista = lista.filter(d => d.estado !== 'anulada')
    }

    // Ordenar:
    // 1. Los anulados siempre de último ("los anulados de ultimo")
    // 2. Por correlativos descendente (lo más nuevo arriba) si es "Todos", o por fecha de actualización descendente
    lista = [...lista].sort((a, b) => {
      const isAnuladoA = a.estado === 'anulada'
      const isAnuladoB = b.estado === 'anulada'
      if (isAnuladoA && !isAnuladoB) return 1
      if (!isAnuladoA && isAnuladoB) return -1
      
      if (estadoFiltro === '') {
        const numA = Number(a.numero || 0)
        const numB = Number(b.numero || 0)
        return numB - numA
      } else {
        const dateA = new Date(a.actualizado_en || a.creado_en || 0).getTime()
        const dateB = new Date(b.actualizado_en || b.creado_en || 0).getTime()
        return dateB - dateA
      }
    })
    if (busquedaGlobal) {
      lista = rankEntities(lista, busquedaGlobal, [
        { get: d => `dsp-${String(d.numero).padStart(5, '0')} ${d.numero}`, weight: 10 },
        { get: d => d.cotizacion?.numero ? `cot-${String(d.cotizacion.numero).padStart(5, '0')} ${d.cotizacion.numero}` : '', weight: 9 },
        { get: d => d.cliente?.nombre, weight: 9 },
        { get: d => d.cliente?.rif_cedula, weight: 9 },
        { get: d => d.cliente?.codigo_cliente, weight: 8 },
        { get: d => d.cotizacion?.total_usd, weight: 7 },
      ])
    }

    return lista
  }, [despachos, vendedorFiltro, estadoFiltro, busquedaGlobal])

  const ITEMS_POR_PAGINA = 12
  const totalPaginas = Math.max(1, Math.ceil(despachosFiltrados.length / ITEMS_POR_PAGINA))
  const despachosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return despachosFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [despachosFiltrados, pagina])

  // Chequeo de stock/ítems en lote para las tarjetas visibles (antes: 2 queries POR tarjeta)
  const { data: stockCheck } = useStockCheckDespachos(despachosPaginados, { enabled: esPrivilegiado })

  // Reset página al cambiar filtro
  useEffect(() => {
    const resetId = setTimeout(() => setPagina(1), 0)
    return () => clearTimeout(resetId)
  }, [estadoFiltro, vendedorFiltro, verTodos, busquedaGlobal])

  // Subir al inicio al cambiar de página
  useEffect(() => {
    const mainContainer = document.querySelector('main')
    if (mainContainer) {
      mainContainer.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [pagina])

  // Config de confirmación por rol
  const anularConfig = getDespachoAction('anular', rol)
  const reciclarConfig = getDespachoAction('reciclar', rol)

  const _anularNumDisplay = despachoAAnular
    ? `DES-${String(despachoAAnular.cotizacion?.numero || despachoAAnular.numero).padStart(5, '0')}`
    : ''

  async function confirmarAnular() {
    if (!despachoAAnular) return
    await cambiarEstado.mutateAsync({
      despachoId: despachoAAnular.id,
      nuevoEstado: 'anulada',
      numeroCotizacion: despachoAAnular.cotizacion?.numero || despachoAAnular.numero,
      clienteNombre: despachoAAnular.cliente?.nombre,
    })
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
      <_PageHeader
        icon={PackageCheck}
        title={esLogistica ? 'Entregas' : 'Notas de Despacho'}
        subtitle={isLoading ? 'Cargando...' : `${despachosFiltrados.length} ${esLogistica ? 'entrega' : 'despacho'}${despachosFiltrados.length !== 1 ? 's' : ''}`}
      />

      {/* Onboarding tips */}
      <_OnboardingSequence rol={rol} page="/despachos" />

      {/* ── Buscador Inteligente ── */}
      <div className="relative">
        <_Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          type="text"
          placeholder="Buscar por cliente, cédula/RIF, código, Nº despacho/cotización o monto..."
          value={busquedaGlobal}
          onChange={e => setBusquedaGlobal(e.target.value)}
          className="w-full pl-11 pr-10 py-3 rounded-2xl border-2 border-slate-200 bg-white text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
        />
        {busquedaGlobal && (
          <button onClick={() => setBusquedaGlobal('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-1 rounded-full transition-colors">
            <_X size={14} />
          </button>
        )}
      </div>

      {/* Filtros de estado + vendedor */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 pb-1">
          {/* Dropdown en móvil */}
          <div className="md:hidden shrink-0">
            <_EstadoDropdown filtros={filtrosDespacho} value={estadoFiltro} onChange={setEstadoFiltro} />
          </div>

          {/* Chips en desktop */}
          <div className="hidden md:flex items-center gap-2 overflow-x-auto scrollbar-none">
            <_Filter size={14} className="text-slate-400 shrink-0" />
            {filtrosDespacho.map(({ valor, label }) => (
              <button key={valor} onClick={() => setEstadoFiltro(valor)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border whitespace-nowrap shrink-0 ${
                  estadoFiltro === valor
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Toggle Mis datos / Todos — supervisor/dev */}
          {(esSupervisor || esDesarrollador) && (
            <_ToggleVistaPersonal value={verTodos} onChange={v => { setVerTodos(v); setVendedorFiltro(''); setPagina(1) }} />
          )}

          {/* Filtro por vendedor — desktop inline */}
          {((esAdministracion || esLogistica) || (esPrivilegiado && verTodos)) && vendedores.length > 1 && (
            <div className="hidden md:flex items-center gap-2">
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <_VendedorFilterPill vendedores={vendedoresFiltrados} value={vendedorFiltro} onChange={setVendedorFiltro} />
            </div>
          ) /* esAdministracion */}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <div className="flex bg-slate-100 rounded-xl p-0.5">
              <button type="button" onClick={() => {
                setVistaMode('grid')
                const businessId = perfil?.cuenta_id
                const key = businessId ? `despachos_vista-${businessId}` : 'despachos_vista'
                localStorage.setItem(key, 'grid')
              }} title="Vista cuadrícula"
                className={`p-2 rounded-lg transition-colors ${vistaMode === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <_LayoutGrid size={16} />
              </button>
              <button type="button" onClick={() => {
                setVistaMode('list')
                const businessId = perfil?.cuenta_id
                const key = businessId ? `despachos_vista-${businessId}` : 'despachos_vista'
                localStorage.setItem(key, 'list')
              }} title="Vista lista"
                className={`p-2 rounded-lg transition-colors ${vistaMode === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <_List size={16} />
              </button>
            </div>
            <button onClick={() => refetch()} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
              <_RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Filtro por vendedor — móvil segunda fila */}
        {((esAdministracion || esLogistica) || (esPrivilegiado && verTodos)) && vendedores.length > 1 && (
          <div className="md:hidden">
            <_VendedorFilterPill vendedores={vendedoresFiltrados} value={vendedorFiltro} onChange={setVendedorFiltro} />
          </div>
        )}
      </div>

      {/* Contenido */}
      {isLoading ? (
        <_SkeletonDespachos />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar despachos</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : despachosFiltrados.length === 0 ? (
        <_EmptyState
          icon={Package}
          title={estadoFiltro || vendedorFiltro ? 'Sin despachos con estos filtros' : 'No hay notas de despacho'}
          description={estadoFiltro || vendedorFiltro ? 'Intenta con otro filtro.' : 'Las notas se crean al despachar cotizaciones enviadas o aceptadas.'}
          actionLabel={estadoFiltro || vendedorFiltro ? 'Limpiar filtros' : undefined}
          onAction={estadoFiltro || vendedorFiltro ? () => { setEstadoFiltro(''); setVendedorFiltro('') } : undefined}
        />
      ) : (
        <>
        {vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {despachosPaginados.map(d => (
              <_DespachoCard
                key={d.id}
                despacho={d}
                stockCheckData={esPrivilegiado ? stockCheck : undefined}
                stockCheckPending={esPrivilegiado && !stockCheck}
                onCambiarEstado={(id, estado, motivoDev, motivoAnu) => cambiarEstado.mutateAsync({ despachoId: id, nuevoEstado: estado, numeroCotizacion: d.cotizacion?.numero || d.numero, clienteNombre: d.cliente?.nombre, vendedorId: d.vendedor_id, motivoDevolucion: motivoDev, motivoAnulacion: motivoAnu, ...(estado === 'entregada' ? { tasaBcv: tasaEfectiva } : {}) })}
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
              <_DespachoRow
                key={d.id}
                despacho={d}
                onVer={setDespachoDetalle}
                onEditar={setDespachoEditar}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        )}
        {totalPaginas > 1 && (
          <_Pagination paginaActual={pagina} totalPaginas={totalPaginas} onCambiarPagina={setPagina} />
        )}
        </>
      )}

      {/* Detalle modal para vista lista */}
      <_DetalleModal
        isOpen={!!despachoDetalle}
        onClose={() => setDespachoDetalle(null)}
        tipo="despacho"
        registro={despachoDetalle}
        tasa={tasaEfectiva}
      />

      {/* Edit modal para vista lista */}
      <_EditDespachoModal
        isOpen={!!despachoEditar}
        onClose={() => setDespachoEditar(null)}
        despacho={despachoEditar}
      />

      {/* Confirm anular — con mensajes por rol */}
      <_ConfirmModal
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
      <_ConfirmModal
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
