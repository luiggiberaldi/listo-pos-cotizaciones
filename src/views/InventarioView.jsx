// src/views/InventarioView.jsx
// Catálogo de productos
// — Vendedor: solo consulta (sin costo, sin edición)
// — Supervisor: vista completa + crear/editar/desactivar
import { useState } from 'react'
import { Package, Plus, Search, RefreshCw, X, Filter } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useInventario, useCategorias, useDesactivarProducto } from '../hooks/useInventario'
import ProductoCard  from '../components/inventario/ProductoCard'
import ProductoForm  from '../components/inventario/ProductoForm'
import { Modal }     from '../components/ui/Modal'
import ConfirmModal  from '../components/ui/ConfirmModal'
import EmptyState    from '../components/ui/EmptyState'
import Skeleton      from '../components/ui/Skeleton'

// ─── Skeleton de carga ────────────────────────────────────────────────────────
function SkeletonProductos() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-3 w-1/3 rounded" />
          <Skeleton className="h-5 w-3/4 rounded-lg" />
          <Skeleton className="h-3 w-1/2 rounded" />
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-2/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function InventarioView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  // Filtros
  const [busqueda,      setBusqueda]      = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [categoria,     setCategoria]     = useState('')

  // Modales
  const [modalFormOpen,    setModalFormOpen]    = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [productoADesact,  setProductoADesact]  = useState(null)
  const [confirmDesactOpen,setConfirmDesactOpen]= useState(false)

  // Data
  const { data: productos = [], isLoading, isError, refetch } = useInventario({ busqueda, categoria })
  const { data: categorias = [] } = useCategorias()
  const desactivar = useDesactivarProducto()

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleBuscar(e) {
    e.preventDefault()
    setBusqueda(textoBusqueda)
  }

  function limpiarFiltros() {
    setTextoBusqueda('')
    setBusqueda('')
    setCategoria('')
  }

  function abrirCrear() {
    setProductoEditando(null)
    setModalFormOpen(true)
  }

  function abrirEditar(producto) {
    setProductoEditando(producto)
    setModalFormOpen(true)
  }

  function abrirDesactivar(producto) {
    setProductoADesact(producto)
    setConfirmDesactOpen(true)
  }

  async function confirmarDesactivar() {
    if (!productoADesact) return
    try {
      await desactivar.mutateAsync(productoADesact.id)
    } finally {
      setProductoADesact(null)
    }
  }

  const hayFiltros = busqueda || categoria

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-screen-xl">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <Package size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Inventario</h1>
            <p className="text-sm text-slate-500">
              {isLoading ? 'Cargando...' : `${productos.length} producto${productos.length !== 1 ? 's' : ''}`}
              {!esSupervisor && <span className="ml-1 text-slate-400">(catálogo de precios)</span>}
            </p>
          </div>
        </div>

        {/* Nuevo producto: solo supervisor */}
        {esSupervisor && (
          <button
            onClick={abrirCrear}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            <Plus size={16} />
            Nuevo producto
          </button>
        )}
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">

        {/* Búsqueda */}
        <form onSubmit={handleBuscar} className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={textoBusqueda}
              onChange={e => setTextoBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código..."
              className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
            />
            {textoBusqueda && (
              <button type="button" onClick={limpiarFiltros}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button type="submit"
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors">
            Buscar
          </button>
        </form>

        {/* Filtro categoría */}
        {categorias.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-slate-400 shrink-0" />
            <select
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="py-2.5 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-focus"
            >
              <option value="">Todas las categorías</option>
              {categorias.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}

        <button type="button" onClick={() => refetch()} title="Actualizar"
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <SkeletonProductos />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar el inventario</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">
            Intentar de nuevo
          </button>
        </div>
      ) : productos.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hayFiltros ? 'Sin resultados' : 'Inventario vacío'}
          description={
            hayFiltros
              ? 'No hay productos que coincidan con los filtros.'
              : esSupervisor
                ? 'Agrega tu primer producto con el botón "Nuevo producto".'
                : 'El catálogo de productos está vacío.'
          }
          actionLabel={hayFiltros ? 'Limpiar filtros' : esSupervisor ? 'Nuevo producto' : undefined}
          onAction={hayFiltros ? limpiarFiltros : esSupervisor ? abrirCrear : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {productos.map(p => (
            <ProductoCard
              key={p.id}
              producto={p}
              onEditar={abrirEditar}
              onDesactivar={abrirDesactivar}
            />
          ))}
        </div>
      )}

      {/* ── Modal: Crear / Editar ───────────────────────────────────────────── */}
      {esSupervisor && (
        <Modal
          isOpen={modalFormOpen}
          onClose={() => setModalFormOpen(false)}
          title={productoEditando ? 'Editar producto' : 'Nuevo producto'}
          className="max-w-lg"
        >
          <ProductoForm
            producto={productoEditando}
            onSuccess={() => setModalFormOpen(false)}
            onCancel={() => setModalFormOpen(false)}
          />
        </Modal>
      )}

      {/* ── Confirm: Desactivar ─────────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmDesactOpen}
        onClose={() => { setConfirmDesactOpen(false); setProductoADesact(null) }}
        onConfirm={confirmarDesactivar}
        title="¿Desactivar producto?"
        message={`"${productoADesact?.nombre}" dejará de aparecer en el catálogo.`}
        confirmText="Sí, desactivar"
        variant="danger"
      />
    </div>
  )
}
