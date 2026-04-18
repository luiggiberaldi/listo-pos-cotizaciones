// src/views/ClientesView.jsx
// Vista principal del módulo de Clientes
// — Vendedor: ve y gestiona sus propios clientes
// — Supervisor: ve todos los clientes + puede reasignar
import { useState, useMemo, useRef, useEffect } from 'react'
import { Users, Plus, Search, RefreshCw, X, LayoutGrid, List, Filter, ChevronDown, Check } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useClientes, useDesactivarCliente, useVendedores } from '../hooks/useClientes'
import ClienteCard       from '../components/clientes/ClienteCard'
import ClienteRow        from '../components/clientes/ClienteRow'
import ClienteForm       from '../components/clientes/ClienteForm'
import ReasignacionModal from '../components/clientes/ReasignacionModal'
import { Modal }         from '../components/ui/Modal'
import ConfirmModal      from '../components/ui/ConfirmModal'
import EmptyState        from '../components/ui/EmptyState'
import Skeleton          from '../components/ui/Skeleton'
import Pagination        from '../components/ui/Pagination'
import PageHeader        from '../components/ui/PageHeader'

const ITEMS_POR_PAGINA = 12

// ─── Dropdown custom (reemplaza <select> nativo) ────────────────────────────
function Dropdown({ value, onChange, placeholder, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 text-sm font-semibold border rounded-xl pl-3 pr-2.5 py-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary ${
          value ? 'bg-primary-light border-primary/30 text-primary' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 min-w-[180px] bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 transition-colors ${
              !value ? 'bg-primary-light text-primary font-semibold' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {!value && <Check size={14} className="text-primary" />}
            <span className={!value ? '' : 'pl-[22px]'}>{placeholder}</span>
          </button>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 transition-colors ${
                value === opt.value ? 'bg-primary-light text-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {value === opt.value && <Check size={14} className="text-primary" />}
              <span className={value === opt.value ? '' : 'pl-[22px]'}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton de carga ────────────────────────────────────────────────────────
function SkeletonClientes() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-5 w-3/4 rounded-lg" />
          <Skeleton className="h-3.5 w-1/2 rounded-lg" />
          <Skeleton className="h-3.5 w-2/3 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function ClientesView() {
  const { perfil } = useAuthStore()

  // Búsqueda y filtros
  const [busqueda, setBusqueda] = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo]         = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [filtroCiudad, setFiltroCiudad]     = useState('')
  const [vistaMode, setVistaMode] = useState(() => localStorage.getItem('clientes_vista') || 'grid')
  const [pagina, setPagina] = useState(1)

  // Estados de modales
  const [modalFormOpen,    setModalFormOpen]    = useState(false)
  const [clienteEditando,  setClienteEditando]  = useState(null)
  const [clienteReasig,    setClienteReasig]    = useState(null)
  const [modalReasigOpen,  setModalReasigOpen]  = useState(false)
  const [clienteADesact,   setClienteADesact]   = useState(null)
  const [confirmDesactOpen,setConfirmDesactOpen]= useState(false)

  // Data + mutations
  const { data: clientes = [], isLoading, isError, refetch } = useClientes(busqueda)
  const { data: vendedores = [] } = useVendedores()
  const desactivar = useDesactivarCliente()

  // Opciones dinámicas de ciudad
  const ciudadesDisponibles = useMemo(() =>
    [...new Set(clientes.map(c => c.ciudad).filter(Boolean))].sort()
  , [clientes])

  // Filtrado local
  const clientesFiltrados = useMemo(() => {
    return clientes.filter(c => {
      if (filtroTipo     && c.tipo_cliente !== filtroTipo)               return false
      if (filtroVendedor && c.vendedor_id  !== filtroVendedor)           return false
      if (filtroCiudad   && (c.ciudad || '').toLowerCase() !== filtroCiudad.toLowerCase()) return false
      return true
    })
  }, [clientes, filtroTipo, filtroVendedor, filtroCiudad])

  const hayFiltros = filtroTipo || filtroVendedor || filtroCiudad

  function limpiarFiltros() {
    setFiltroTipo('')
    setFiltroVendedor('')
    setFiltroCiudad('')
    setPagina(1)
  }

  // Paginación (sobre clientes filtrados)
  const totalPaginas = Math.max(1, Math.ceil(clientesFiltrados.length / ITEMS_POR_PAGINA))
  const clientesPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return clientesFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [clientesFiltrados, pagina])

  // Debounce: actualizar búsqueda real 300ms después de dejar de teclear
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusqueda(textoBusqueda)
      setPagina(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [textoBusqueda])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function limpiarBusqueda() {
    setTextoBusqueda('')
    setBusqueda('')
    setPagina(1)
  }

  function cambiarVista(modo) {
    setVistaMode(modo)
    localStorage.setItem('clientes_vista', modo)
  }

  function abrirCrear() {
    setClienteEditando(null)
    setModalFormOpen(true)
  }

  function abrirEditar(cliente) {
    setClienteEditando(cliente)
    setModalFormOpen(true)
  }

  function abrirDesactivar(cliente) {
    setClienteADesact(cliente)
    setConfirmDesactOpen(true)
  }

  function abrirReasignar(cliente) {
    setClienteReasig(cliente)
    setModalReasigOpen(true)
  }

  async function confirmarDesactivar() {
    if (!clienteADesact) return
    try {
      await desactivar.mutateAsync(clienteADesact.id)
    } finally {
      setClienteADesact(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Users}
        title="Clientes"
        subtitle={isLoading ? 'Cargando...' : `${clientesFiltrados.length} cliente${clientesFiltrados.length !== 1 ? 's' : ''}`}
        action={
          <button onClick={abrirCrear} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            <Plus size={16} />Nuevo cliente
          </button>
        }
      />

      {/* ── Barra de búsqueda ──────────────────────────────────────────────── */}
      <form onSubmit={e => { e.preventDefault(); setBusqueda(textoBusqueda); setPagina(1) }} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={textoBusqueda}
            onChange={e => setTextoBusqueda(e.target.value)}
            placeholder="Buscar por nombre o RIF/cédula..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
          />
          {textoBusqueda && (
            <button
              type="button"
              onClick={limpiarBusqueda}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          title="Actualizar lista"
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>

        {/* Toggle cuadrícula / lista */}
        <div className="flex bg-slate-100 rounded-xl p-0.5">
          <button
            type="button"
            onClick={() => cambiarVista('grid')}
            title="Vista cuadrícula"
            className={`p-2 rounded-lg transition-colors ${vistaMode === 'grid' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            onClick={() => cambiarVista('list')}
            title="Vista lista"
            className={`p-2 rounded-lg transition-colors ${vistaMode === 'list' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <List size={16} />
          </button>
        </div>
      </form>

      {/* Chip de búsqueda activa */}
      {busqueda && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-light text-primary text-xs font-semibold border border-primary/20">
            Buscando: "{busqueda}"
            <button onClick={limpiarBusqueda} className="hover:text-primary/70 transition-colors">
              <X size={12} />
            </button>
          </span>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
          <Filter size={13} />
          Filtros:
        </div>

        {/* Tipo */}
        <Dropdown
          value={filtroTipo}
          onChange={v => { setFiltroTipo(v); setPagina(1) }}
          placeholder="Todos los tipos"
          options={[
            { value: 'natural', label: 'Natural' },
            { value: 'juridico', label: 'Jurídico' },
          ]}
        />

        {/* Ciudad */}
        <Dropdown
          value={filtroCiudad}
          onChange={v => { setFiltroCiudad(v); setPagina(1) }}
          placeholder="Todas las ciudades"
          options={ciudadesDisponibles.map(c => ({ value: c, label: c }))}
        />

        {/* Vendedor (solo supervisor) */}
        {perfil?.rol === 'supervisor' && (
          <Dropdown
            value={filtroVendedor}
            onChange={v => { setFiltroVendedor(v); setPagina(1) }}
            placeholder="Todos los vendedores"
            options={vendedores.map(v => ({ value: v.id, label: v.nombre }))}
          />
        )}

        {/* Limpiar filtros */}
        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-white border border-red-200 hover:border-red-500 rounded-xl px-3 py-2 bg-red-50 hover:bg-red-500 transition-all"
          >
            <X size={12} />
            Limpiar
          </button>
        )}
      </div>

      {/* ── Contenido principal ────────────────────────────────────────────── */}
      {isLoading ? (
        <SkeletonClientes />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar los clientes</p>
          <button
            onClick={() => refetch()}
            className="mt-3 text-sm underline text-red-600 hover:text-red-800"
          >
            Intentar de nuevo
          </button>
        </div>
      ) : clientes.length === 0 ? (
        <EmptyState
          icon={Users}
          title={busqueda ? 'Sin resultados' : 'No hay clientes aún'}
          description={
            busqueda
              ? `No se encontraron clientes con "${busqueda}".`
              : 'Crea tu primer cliente con el botón "Nuevo cliente".'
          }
          actionLabel={busqueda ? 'Limpiar búsqueda' : 'Nuevo cliente'}
          onAction={busqueda ? limpiarBusqueda : abrirCrear}
        />
      ) : clientesFiltrados.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="Sin resultados"
          description="No hay clientes que coincidan con los filtros aplicados."
          actionLabel="Limpiar filtros"
          onAction={limpiarFiltros}
        />
      ) : (
        vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {clientesPaginados.map(cliente => (
              <ClienteCard
                key={cliente.id}
                cliente={cliente}
                onEditar={abrirEditar}
                onDesactivar={abrirDesactivar}
                onReasignar={abrirReasignar}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {clientesPaginados.map(cliente => (
              <ClienteRow
                key={cliente.id}
                cliente={cliente}
                onEditar={abrirEditar}
                onDesactivar={abrirDesactivar}
                onReasignar={abrirReasignar}
              />
            ))}
          </div>
        )
      )}

      {/* ── Paginación ───────────────────────────────────────────────────────── */}
      {!isLoading && clientesFiltrados.length > ITEMS_POR_PAGINA && (
        <Pagination
          paginaActual={pagina}
          totalPaginas={totalPaginas}
          onCambiarPagina={setPagina}
        />
      )}

      {/* ── Modal: Crear / Editar cliente ──────────────────────────────────── */}
      <Modal
        isOpen={modalFormOpen}
        onClose={() => setModalFormOpen(false)}
        title={clienteEditando ? 'Editar cliente' : 'Nuevo cliente'}
      >
        <ClienteForm
          cliente={clienteEditando}
          onSuccess={() => setModalFormOpen(false)}
          onCancel={() => setModalFormOpen(false)}
        />
      </Modal>

      {/* ── Modal: Reasignar (solo supervisor) ─────────────────────────────── */}
      <ReasignacionModal
        cliente={clienteReasig}
        isOpen={modalReasigOpen}
        onClose={() => { setModalReasigOpen(false); setClienteReasig(null) }}
      />

      {/* ── Confirm: Desactivar cliente ─────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmDesactOpen}
        onClose={() => { setConfirmDesactOpen(false); setClienteADesact(null) }}
        onConfirm={confirmarDesactivar}
        title="¿Desactivar cliente?"
        message={`"${clienteADesact?.nombre}" quedará inactivo y no aparecerá en la lista.\nPuedes reactivarlo más adelante desde la base de datos.`}
        confirmText="Sí, desactivar"
        variant="danger"
      />

    </div>
  )
}
