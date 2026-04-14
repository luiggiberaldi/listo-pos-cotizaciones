// src/views/ClientesView.jsx
// Vista principal del módulo de Clientes
// — Vendedor: ve y gestiona sus propios clientes
// — Supervisor: ve todos los clientes + puede reasignar
import { useState } from 'react'
import { Users, Plus, Search, RefreshCw, X } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useClientes, useDesactivarCliente } from '../hooks/useClientes'
import ClienteCard       from '../components/clientes/ClienteCard'
import ClienteForm       from '../components/clientes/ClienteForm'
import ReasignacionModal from '../components/clientes/ReasignacionModal'
import { Modal }         from '../components/ui/Modal'
import ConfirmModal      from '../components/ui/ConfirmModal'
import EmptyState        from '../components/ui/EmptyState'
import Skeleton          from '../components/ui/Skeleton'

// ─── Skeleton de carga ────────────────────────────────────────────────────────
function SkeletonClientes() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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

  // Búsqueda
  const [busqueda, setBusqueda] = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')

  // Estados de modales
  const [modalFormOpen,    setModalFormOpen]    = useState(false)
  const [clienteEditando,  setClienteEditando]  = useState(null)
  const [clienteReasig,    setClienteReasig]    = useState(null)
  const [modalReasigOpen,  setModalReasigOpen]  = useState(false)
  const [clienteADesact,   setClienteADesact]   = useState(null)
  const [confirmDesactOpen,setConfirmDesactOpen]= useState(false)

  // Data + mutations
  const { data: clientes = [], isLoading, isError, refetch } = useClientes(busqueda)
  const desactivar = useDesactivarCliente()

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleBuscar(e) {
    e.preventDefault()
    setBusqueda(textoBusqueda)
  }

  function limpiarBusqueda() {
    setTextoBusqueda('')
    setBusqueda('')
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
    await desactivar.mutateAsync(clienteADesact.id)
    setClienteADesact(null)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-screen-xl">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Clientes</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${clientes.length} cliente${clientes.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <button
          onClick={abrirCrear}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          <Plus size={16} />
          Nuevo cliente
        </button>
      </div>

      {/* ── Barra de búsqueda ──────────────────────────────────────────────── */}
      <form onSubmit={handleBuscar} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={textoBusqueda}
            onChange={e => setTextoBusqueda(e.target.value)}
            placeholder="Buscar por nombre o RIF/cédula..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 placeholder:text-slate-400"
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
          type="submit"
          className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors"
        >
          Buscar
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          title="Actualizar lista"
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </form>

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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {clientes.map(cliente => (
            <ClienteCard
              key={cliente.id}
              cliente={cliente}
              onEditar={abrirEditar}
              onDesactivar={abrirDesactivar}
              onReasignar={abrirReasignar}
            />
          ))}
        </div>
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
