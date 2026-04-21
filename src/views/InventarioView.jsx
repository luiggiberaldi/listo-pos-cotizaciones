// src/views/InventarioView.jsx
// Catálogo de productos
// — Vendedor: solo consulta (sin costo, sin edición)
// — Supervisor: vista completa + crear/editar/desactivar
import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, Plus, Search, RefreshCw, X, Filter, LayoutGrid, List, AlertTriangle, ArrowLeftRight } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useTasaCambio } from '../hooks/useTasaCambio'
import CustomSelect from '../components/ui/CustomSelect'
import { useInventario, useCategorias, useDesactivarProducto, useBorrarProducto } from '../hooks/useInventario'
import { useStockComprometido } from '../hooks/useStockComprometido'
import ProductoCard  from '../components/inventario/ProductoCard'
import ProductoRow   from '../components/inventario/ProductoRow'
import ProductoForm  from '../components/inventario/ProductoForm'
import MovimientoLoteModal from '../components/inventario/MovimientoLoteModal'
import MovimientosHistorial from '../components/inventario/MovimientosHistorial'
import { Modal }     from '../components/ui/Modal'
import ConfirmModal  from '../components/ui/ConfirmModal'
import EmptyState    from '../components/ui/EmptyState'
import Skeleton      from '../components/ui/Skeleton'
import Pagination    from '../components/ui/Pagination'
import PageHeader   from '../components/ui/PageHeader'

const ITEMS_POR_PAGINA = 24

// ─── Skeleton de carga ────────────────────────────────────────────────────────
function SkeletonProductos() {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
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

  // URL params (para navegación desde notificaciones)
  const [searchParams, setSearchParams] = useSearchParams()

  // Filtros
  const [busqueda,      setBusqueda]      = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [categoria,     setCategoria]     = useState('')
  const [stockBajo,     setStockBajo]     = useState(() => searchParams.get('filtro') === 'stock_bajo')
  const [vistaMode,     setVistaMode]     = useState(() => localStorage.getItem('inventario_vista') || 'grid')
  const [pagina,        setPagina]        = useState(1)

  // Sincronizar URL param con estado
  useEffect(() => {
    if (searchParams.get('filtro') === 'stock_bajo' && !stockBajo) {
      setStockBajo(true)
    }
  }, [searchParams])

  // Modales
  const [modalFormOpen,    setModalFormOpen]    = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [productoADesact,  setProductoADesact]  = useState(null)
  const [confirmDesactOpen,setConfirmDesactOpen]= useState(false)
  const [productoABorrar,  setProductoABorrar]  = useState(null)
  const [confirmBorrarOpen,setConfirmBorrarOpen]= useState(false)
  const [modalLoteOpen,    setModalLoteOpen]    = useState(false)
  const [tabActivo,        setTabActivo]        = useState('productos') // 'productos' | 'movimientos'

  // Data — todos los productos (sin filtro de búsqueda) para el modal de movimientos
  const { data: inventarioData, isLoading, isError, refetch } = useInventario({ busqueda, categoria, pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const { data: todosData } = useInventario({ pageSize: 1000 })
  const todosProductos = todosData?.productos ?? todosData ?? []
  const { data: categorias = [] } = useCategorias()
  const desactivar = useDesactivarProducto()
  const borrar = useBorrarProducto()
  const { data: stockComprometido = {} } = useStockComprometido()

  // Filtrar por stock bajo (client-side)
  const productosFiltrados = useMemo(() => {
    if (!stockBajo) return productos
    return productos.filter(p => p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo)
  }, [productos, stockBajo])

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / ITEMS_POR_PAGINA))
  const productosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return productosFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [productosFiltrados, pagina])

  // Debounce: actualizar búsqueda real 300ms después de dejar de teclear
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusqueda(textoBusqueda)
      setPagina(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [textoBusqueda])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function limpiarFiltros() {
    setTextoBusqueda('')
    setBusqueda('')
    setCategoria('')
    setStockBajo(false)
    setSearchParams({})
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

  function abrirBorrar(producto) {
    setProductoABorrar(producto)
    setConfirmBorrarOpen(true)
  }

  async function confirmarBorrar() {
    if (!productoABorrar) return
    try {
      await borrar.mutateAsync(productoABorrar.id)
    } finally {
      setProductoABorrar(null)
    }
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

  function toggleStockBajo() {
    const next = !stockBajo
    setStockBajo(next)
    setPagina(1)
    if (next) {
      setSearchParams({ filtro: 'stock_bajo' })
    } else {
      setSearchParams({})
    }
  }

  const hayFiltros = busqueda || categoria || stockBajo

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Package}
        title="Inventario"
        subtitle={<>{isLoading ? 'Cargando...' : `${productosFiltrados.length} producto${productosFiltrados.length !== 1 ? 's' : ''}${stockBajo ? ' con stock bajo' : ''}`}{!esSupervisor && <span className="ml-1 opacity-60">(catálogo de precios)</span>}</>}
        action={esSupervisor && (
          <div className="flex items-center gap-2">
            <button onClick={() => setModalLoteOpen(true)} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] bg-slate-700 hover:bg-slate-600">
              <ArrowLeftRight size={16} />
              <span className="hidden sm:inline">Ingreso / Egreso</span>
            </button>
            <button onClick={abrirCrear} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} />Nuevo producto
            </button>
          </div>
        )}
      />

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Fila 1: Búsqueda */}
        <form onSubmit={e => { e.preventDefault(); setBusqueda(textoBusqueda); setPagina(1) }} className="flex gap-2">
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
              <button type="button" onClick={() => setTextoBusqueda('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
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

          {/* Filtro stock bajo */}
          <button
            type="button"
            onClick={toggleStockBajo}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors border shrink-0 ${
              stockBajo
                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-amber-600'
            }`}
          >
            <AlertTriangle size={14} />
            <span className="hidden sm:inline">Stock bajo</span>
          </button>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button type="button" onClick={() => refetch()} title="Actualizar"
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
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
          </div>
        </div>
      </div>

      {/* ── Tabs: Productos / Movimientos ─────────────────────────────────── */}
      {esSupervisor && (
        <div className="flex bg-slate-100 rounded-xl p-1 w-fit">
          <button type="button" onClick={() => setTabActivo('productos')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              tabActivo === 'productos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            Productos
          </button>
          <button type="button" onClick={() => setTabActivo('movimientos')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
              tabActivo === 'movimientos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            Movimientos
          </button>
        </div>
      )}

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {tabActivo === 'movimientos' && esSupervisor ? (
        <MovimientosHistorial />
      ) : isLoading ? (
        <SkeletonProductos />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar el inventario</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">
            Intentar de nuevo
          </button>
        </div>
      ) : productosFiltrados.length === 0 ? (
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
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {productosPaginados.map(p => (
              <ProductoCard
                key={p.id}
                producto={p}
                onEditar={abrirEditar}
                onDesactivar={abrirDesactivar}
                onBorrar={abrirBorrar}
                tasa={tasaEfectiva}
                comprometido={stockComprometido[p.id] || 0}
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
                onBorrar={abrirBorrar}
                tasa={tasaEfectiva}
                comprometido={stockComprometido[p.id] || 0}
              />
            ))}
          </div>
        )
      )}

      {/* ── Paginación ───────────────────────────────────────────────────────── */}
      {!isLoading && productosFiltrados.length > ITEMS_POR_PAGINA && (
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

      {/* ── Confirm: Borrar ──────────────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmBorrarOpen}
        onClose={() => { setConfirmBorrarOpen(false); setProductoABorrar(null) }}
        onConfirm={confirmarBorrar}
        title="¿Borrar producto?"
        message={`Esta acción eliminará permanentemente "${productoABorrar?.nombre}" y no se puede deshacer.`}
        confirmText="Sí, borrar"
        variant="danger"
      />

      {/* ── Modal: Ingreso/Egreso por lotes ────────────────────────────────── */}
      {esSupervisor && (
        <MovimientoLoteModal
          isOpen={modalLoteOpen}
          onClose={() => setModalLoteOpen(false)}
          productos={todosProductos}
        />
      )}
    </div>
  )
}
