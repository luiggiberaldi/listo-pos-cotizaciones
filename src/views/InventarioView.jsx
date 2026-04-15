// src/views/InventarioView.jsx
// Catálogo de productos
// — Vendedor: solo consulta (sin costo, sin edición)
// — Supervisor: vista completa + crear/editar/desactivar
import { useState, useMemo } from 'react'
import { Package, Plus, Search, RefreshCw, X, Filter, LayoutGrid, List } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useTasaCambio } from '../hooks/useTasaCambio'
import CustomSelect from '../components/ui/CustomSelect'
import { useInventario, useCategorias, useDesactivarProducto } from '../hooks/useInventario'
import ProductoCard  from '../components/inventario/ProductoCard'
import ProductoRow   from '../components/inventario/ProductoRow'
import ProductoForm  from '../components/inventario/ProductoForm'
import { Modal }     from '../components/ui/Modal'
import ConfirmModal  from '../components/ui/ConfirmModal'
import EmptyState    from '../components/ui/EmptyState'
import Skeleton      from '../components/ui/Skeleton'
import Pagination    from '../components/ui/Pagination'

const ITEMS_POR_PAGINA = 12

// ─── Skeleton de carga ────────────────────────────────────────────────────────
function SkeletonProductos() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
  const { tasaEfectiva } = useTasaCambio()

  // Filtros
  const [busqueda,      setBusqueda]      = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [categoria,     setCategoria]     = useState('')
  const [vistaMode,     setVistaMode]     = useState(() => localStorage.getItem('inventario_vista') || 'grid')
  const [pagina,        setPagina]        = useState(1)

  // Modales
  const [modalFormOpen,    setModalFormOpen]    = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [productoADesact,  setProductoADesact]  = useState(null)
  const [confirmDesactOpen,setConfirmDesactOpen]= useState(false)

  // Data
  const { data: productos = [], isLoading, isError, refetch } = useInventario({ busqueda, categoria })
  const { data: categorias = [] } = useCategorias()
  const desactivar = useDesactivarProducto()

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(productos.length / ITEMS_POR_PAGINA))
  const productosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return productos.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [productos, pagina])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleBuscar(e) {
    e.preventDefault()
    setBusqueda(textoBusqueda)
    setPagina(1)
  }

  function limpiarFiltros() {
    setTextoBusqueda('')
    setBusqueda('')
    setCategoria('')
    setPagina(1)
  }

  function cambiarVista(modo) {
    setVistaMode(modo)
    localStorage.setItem('inventario_vista', modo)
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
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-light rounded-xl flex items-center justify-center">
            <Package size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Inventario</h1>
            <p className="text-base text-slate-500">
              {isLoading ? 'Cargando...' : `${productos.length} producto${productos.length !== 1 ? 's' : ''}`}
              {!esSupervisor && <span className="ml-1 text-slate-500">(catálogo de precios)</span>}
            </p>
          </div>
        </div>

        {/* Nuevo producto: solo supervisor */}
        {esSupervisor && (
          <button
            onClick={abrirCrear}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-semibold text-base px-5 py-3 rounded-xl transition-colors shadow-sm"
          >
            <Plus size={16} />
            Nuevo producto
          </button>
        )}
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Fila 1: Búsqueda */}
        <form onSubmit={handleBuscar} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={textoBusqueda}
              onChange={e => setTextoBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código..."
              className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-500"
            />
            {textoBusqueda && (
              <button type="button" onClick={limpiarFiltros}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button type="submit"
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-base rounded-xl transition-colors shrink-0">
            Buscar
          </button>
        </form>

        {/* Fila 2: Categoría + controles */}
        <div className="flex items-center gap-2">
          {/* Filtro categoría */}
          {categorias.length > 0 && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <CustomSelect
                  options={[
                    { value: '', label: 'Todas las categorías' },
                    ...categorias.map(cat => ({ value: cat, label: cat })),
                  ]}
                  value={categoria}
                  onChange={val => { setCategoria(val); setPagina(1) }}
                  placeholder="Todas las categorías"
                  icon={Filter}
                  clearable
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button type="button" onClick={() => refetch()} title="Actualizar"
              className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
              <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
            </button>

            {/* Toggle cuadrícula / lista */}
            <div className="flex bg-slate-100 rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => cambiarVista('grid')}
                title="Vista cuadrícula"
                className={`p-2.5 rounded-lg transition-colors flex items-center gap-1.5 ${vistaMode === 'grid' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-600'}`}
              >
                <LayoutGrid size={16} />
                <span className="text-sm">Cuadrícula</span>
              </button>
              <button
                type="button"
                onClick={() => cambiarVista('list')}
                title="Vista lista"
                className={`p-2.5 rounded-lg transition-colors flex items-center gap-1.5 ${vistaMode === 'list' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-600'}`}
              >
                <List size={16} />
                <span className="text-sm">Lista</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <SkeletonProductos />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar el inventario</p>
          <button onClick={() => refetch()} className="mt-3 text-base underline">
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
        vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {productosPaginados.map(p => (
              <ProductoCard
                key={p.id}
                producto={p}
                onEditar={abrirEditar}
                onDesactivar={abrirDesactivar}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {productosPaginados.map(p => (
              <ProductoRow
                key={p.id}
                producto={p}
                onEditar={abrirEditar}
                onDesactivar={abrirDesactivar}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        )
      )}

      {/* ── Paginación ───────────────────────────────────────────────────────── */}
      {!isLoading && productos.length > ITEMS_POR_PAGINA && (
        <Pagination
          paginaActual={pagina}
          totalPaginas={totalPaginas}
          onCambiarPagina={setPagina}
        />
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
