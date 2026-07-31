// src/views/InventarioView.jsx
// Catálogo de productos
// — Vendedor: solo consulta (sin costo, sin edición)
// — Supervisor: vista completa + crear/editar/desactivar
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, Plus, Search, RefreshCw, X, Filter, AlertTriangle, ArrowLeftRight, FileText, ClipboardPaste, TrendingUp, FileSpreadsheet, EyeOff } from 'lucide-react'
import { smartSearchProductos } from '../utils/smartSearch'
import useAuthStore from '../store/useAuthStore'
import { useTasaCambio } from '../hooks/useTasaCambio'
import CustomSelect from '../components/ui/CustomSelect'
import { useInventario, useCategorias, useDesactivarProducto, useBorrarProducto, CATEGORY_GROUPS as CATEGORY_GROUPS_VIEW } from '../hooks/useInventario'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useStockComprometido } from '../hooks/useStockComprometido'
import ProductoCard  from '../components/inventario/ProductoCard'
import ProductoForm  from '../components/inventario/ProductoForm'
import MovimientoLoteModal from '../components/inventario/MovimientoLoteModal'
import MovimientosHistorial from '../components/inventario/MovimientosHistorial'
import KardexModal from '../components/inventario/KardexModal'
import ProductoDetalleModal from '../components/inventario/ProductoDetalleModal'
import ListaPreciosModal from '../components/inventario/ListaPreciosModal'
import BusquedaListaModal from '../components/inventario/BusquedaListaModal'
import ModalBatchPrice from '../components/ModalBatchPrice'
import ModalTransformacion from '../components/inventario/ModalTransformacion'
import IngresoLoteHubModal from '../components/inventario/IngresoLoteHubModal'
import ImportadorModal from '../components/inventario/ImportadorModal'
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const user = useAuthStore(useCallback(s => s.user, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esAdministracion = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  // Solo administracion, desarrollador y jefe pueden crear/editar/borrar productos
  const puedeGestionarInventario = esAdministracion || esDesarrollador || perfil?.rol === 'jefe'
  // Supervisor, admin y desarrollador ven costo, tabs, kardex, etc.
  const esPrivilegiado = esSupervisor || esAdministracion || esDesarrollador
  const { tasaEfectiva } = useTasaCambio()
  const { data: configNeg = {} } = useConfigNegocio()

  // URL params (para navegación desde notificaciones)
  const [searchParams, setSearchParams] = useSearchParams()

  // Filtros
  const [busqueda,      setBusqueda]      = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [categoria,     setCategoria]     = useState('')
  const [stockBajo,     setStockBajo]     = useState(() => searchParams.get('filtro') === 'stock_bajo')
  const [stockNegativo, setStockNegativo] = useState(false)
  const [soloDesactivados, setSoloDesactivados] = useState(false)
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
  const [kardexProducto,   setKardexProducto]   = useState(null)
  const [detalleProducto,  setDetalleProducto]  = useState(null)
  const [tabActivo,        setTabActivo]        = useState('productos') // 'productos' | 'movimientos'
  const [showListaPrecios, setShowListaPrecios] = useState(false)
  const [showBusquedaLista, setShowBusquedaLista] = useState(false)
  const [showBatchPrice, setShowBatchPrice] = useState(false)
  const [showTransformacion, setShowTransformacion] = useState(false)
  const [showIngresoLote, setShowIngresoLote] = useState(false)
  const [productoAClonar,  setProductoAClonar]  = useState(null)
  const [modalCloneMode,   setModalCloneMode]   = useState(false)
  const [showImportador,   setShowImportador]   = useState(false)

  // Data
  const { data: todosData, isLoading, isError, refetch } = useInventario({ pageSize: 1000, mostrarInactivos: esPrivilegiado })
  const todosProductos = todosData?.productos ?? todosData ?? []
  const catalogoTruncado = !!todosData?.truncado
  const esGrupoCategoria = categoria ? CATEGORY_GROUPS_VIEW.includes(categoria.toUpperCase().trim()) : false
  const productosRaw = useMemo(() => {
    if (!categoria) return todosProductos
    if (esGrupoCategoria) {
      const prefijo = categoria.toUpperCase().trim()
      return todosProductos.filter(p => (p.categoria || '').toUpperCase().trim().startsWith(prefijo))
    }
    return todosProductos.filter(p => p.categoria === categoria)
  }, [todosProductos, categoria, esGrupoCategoria])
  const { data: categorias = [] } = useCategorias({ mostrarInactivos: esPrivilegiado })
  const desactivar = useDesactivarProducto()
  const borrar = useBorrarProducto()
  const { data: stockComprometido = {} } = useStockComprometido()
  const categoriasBatch = useMemo(() => [...new Set(todosProductos.map(p => p.categoria).filter(Boolean))].sort(), [todosProductos])

  // Smart search client-side
  const productos = useMemo(() => {
    let list = productosRaw
    if (soloDesactivados) {
      list = list.filter(p => p.activo === false)
    }
    if (!busqueda.trim()) return list
    return smartSearchProductos(list, busqueda)
  }, [productosRaw, busqueda, soloDesactivados])

  // Filtrar por stock bajo / negativo
  const productosFiltrados = useMemo(() => {
    let list = productos
    if (stockNegativo) {
      list = list.filter(p => (Number(p.stock_actual) || 0) < 0)
    } else if (stockBajo) {
      list = list.filter(p => {
        const stock = Number(p.stock_actual) || 0
        const min = Number(p.stock_minimo) || 0
        return stock <= 0 || (min > 0 && stock <= min)
      })
    }
    return list.sort((a, b) => {
      const aStock = Number(a.stock_actual) || 0
      const bStock = Number(b.stock_actual) || 0
      const aZero = aStock <= 0 ? 1 : 0
      const bZero = bStock <= 0 ? 1 : 0
      if (aZero !== bZero) return aZero - bZero
      return aStock - bStock
    })
  }, [productos, stockBajo, stockNegativo])

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / ITEMS_POR_PAGINA))
  const productosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return productosFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [productosFiltrados, pagina])

  // Debounce
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
    setSoloDesactivados(false)
    setSearchParams({})
    setPagina(1)
  }

  function abrirCrear() {
    setProductoEditando(null)
    setModalCloneMode(false)
    setModalFormOpen(true)
  }

  function abrirEditar(producto) {
    setProductoEditando(producto)
    setModalCloneMode(false)
    setModalFormOpen(true)
  }

  function abrirClonar(producto) {
    setProductoEditando(producto)
    setModalCloneMode(true)
    setModalFormOpen(true)
  }

  function abrirDesactivar(producto) {
    setProductoADesact(producto)
    setConfirmDesactOpen(true)
  }

  function abrirBorrar(producto) {
    setProductoABorrar(producto)
    setConfirmBorrarOpen(true)
  }

  async function confirmarDesactivar() {
    if (!productoADesact) return
    try {
      await desactivar.mutateAsync({ id: productoADesact.id, activo: !productoADesact.activo })
    } finally {
      setConfirmDesactOpen(false)
      setProductoADesact(null)
    }
  }

  async function confirmarBorrar() {
    if (!productoABorrar) return
    try {
      await borrar.mutateAsync(productoABorrar.id)
    } finally {
      setConfirmBorrarOpen(false)
      setProductoABorrar(null)
    }
  }

  function toggleStockBajo() {
    const next = !stockBajo
    setStockBajo(next)
    if (next) setStockNegativo(false)
    setPagina(1)
    if (next) {
      setSearchParams({ filtro: 'stock_bajo' })
    } else {
      setSearchParams({})
    }
  }

  const hayFiltros = busqueda || categoria || stockBajo || stockNegativo || soloDesactivados

  // Guardarraíl: migrar posibles valores 'list' guardados en localStorage a 'grid'
  {
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const keys = businessId
      ? [`inventario_vista-${businessId}`, 'inventario_vista']
      : ['inventario_vista']
    keys.forEach(k => {
      if (localStorage.getItem(k) === 'list') localStorage.setItem(k, 'grid')
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 pb-24 lg:pb-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Package}
        title="Inventario"
        subtitle={<>{isLoading ? 'Cargando...' : `${productosFiltrados.length} producto${productosFiltrados.length !== 1 ? 's' : ''}${stockBajo ? ' con stock bajo' : ''}`}{!esPrivilegiado && <span className="ml-1 opacity-60">(catálogo de precios)</span>}</>}
        action={puedeGestionarInventario && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setModalLoteOpen(true)} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] bg-slate-700 hover:bg-slate-600 shrink-0">
              <ArrowLeftRight size={16} />
              <span className="hidden sm:inline">Ingreso / Egreso</span>
            </button>
            <button
              onClick={() => setShowBatchPrice(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-400 text-amber-700 font-bold text-sm hover:bg-amber-50 transition-all shadow-sm shrink-0"
            >
              <TrendingUp size={16} />
              <span className="hidden sm:inline">Actualizar Precios</span>
              <span className="sm:hidden">Precios</span>
            </button>
            <button
              onClick={() => setShowTransformacion(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-all shadow-sm shrink-0"
            >
              <ArrowLeftRight size={16} />
              <span className="hidden sm:inline">Transformar</span>
            </button>

            <button onClick={abrirCrear} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] shrink-0"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} />
              <span className="hidden sm:inline">Nuevo producto</span>
              <span className="sm:hidden">Nuevo</span>
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
              className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary placeholder:text-slate-400"
            />
            {textoBusqueda && (
              <button type="button" onClick={() => setTextoBusqueda('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
        </form>

        {/* Fila 2: Categoría + Botones de Acción Global */}
        <div className="flex items-center gap-2">
          {/* Filtro categoría */}
          {categorias.length > 0 && (
            <div className="flex-1 min-w-0">
              <CustomSelect
                options={[
                  { value: '', label: 'Todas las categorías' },
                  ...categorias,
                ]}
                value={categoria}
                onChange={val => { setCategoria(val); setPagina(1) }}
                placeholder="Todas las categorías"
                icon={Filter}
                clearable
              />
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Botón Lista de Precios */}
            <button type="button" onClick={() => setShowListaPrecios(true)} title="Lista de precios PDF"
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors border bg-white border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 shrink-0">
              <FileText size={14} />
              <span className="hidden sm:inline">Lista de precios</span>
            </button>

            <button type="button" onClick={() => refetch()} title="Actualizar"
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors shrink-0">
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Fila 3: Chips de filtro deslizable en móvil */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
          {/* Filtro stock bajo */}
          <button
            type="button"
            onClick={toggleStockBajo}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border shrink-0 ${
              stockBajo
                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-amber-600'
            }`}
          >
            <AlertTriangle size={14} />
            <span>Stock bajo</span>
          </button>

          {/* Filtro stock negativo (Venta Anticipada) */}
          <button
            type="button"
            onClick={() => {
              const next = !stockNegativo
              setStockNegativo(next)
              if (next) setStockBajo(false)
              setPagina(1)
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border shrink-0 ${
              stockNegativo
                ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100 ring-2 ring-red-200 shadow-sm'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-600'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
            <span>Stock Negativo</span>
          </button>

          {/* Filtro desactivados (solo administración/privilegiados) */}
          {esPrivilegiado && (
            <button
              type="button"
              onClick={() => { setSoloDesactivados(!soloDesactivados); setPagina(1); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border shrink-0 ${
                soloDesactivados
                  ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700 shadow-sm shadow-slate-200'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <EyeOff size={14} />
              <span>Solo desactivados</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs: Productos / Movimientos ─────────────────────────────────── */}
      {esPrivilegiado && (
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

      {/* ── Aviso de catálogo truncado (tope de seguridad de 5000) ─────────── */}
      {catalogoTruncado && !isLoading && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5 text-sm text-amber-800">
          El catálogo supera el límite de carga: se muestran {todosProductos.length.toLocaleString('es-VE')} de {(todosData?.totalCount ?? 0).toLocaleString('es-VE')} productos. Usa la búsqueda o filtros para encontrar el resto.
        </div>
      )}

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {tabActivo === 'movimientos' && esPrivilegiado ? (
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
          actionLabel={hayFiltros ? 'Limpiar filtros' : puedeGestionarInventario ? 'Nuevo producto' : undefined}
          onAction={hayFiltros ? limpiarFiltros : puedeGestionarInventario ? abrirCrear : undefined}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {productosPaginados.map((p, index) => (
            <ProductoCard
              key={p.id}
              index={index}
              producto={p}
              onEditar={abrirEditar}
              onClonar={abrirClonar}
              onDesactivar={abrirDesactivar}
              onBorrar={abrirBorrar}
              onKardex={setKardexProducto}
              onDetalle={setDetalleProducto}
              tasa={tasaEfectiva}
              comprometido={stockComprometido[p.id] || 0}
            />
          ))}
        </div>
      )}

      {/* ── Paginación (solo tab productos) ──────────────────────────────────── */}
      {tabActivo === 'productos' && !isLoading && productosFiltrados.length > ITEMS_POR_PAGINA && (
        <Pagination
          paginaActual={pagina}
          totalPaginas={totalPaginas}
          onCambiarPagina={setPagina}
        />
      )}

      {/* ── Modal: Crear / Editar ───────────────────────────────────────────── */}
      {puedeGestionarInventario && (
        <Modal
          isOpen={modalFormOpen}
          onClose={() => { setModalFormOpen(false); setModalCloneMode(false) }}
          title={modalCloneMode ? '📋 Crear producto similar' : productoEditando ? 'Editar producto' : 'Nuevo producto'}
          className="sm:max-w-4xl"
        >
          <ProductoForm
            producto={productoEditando}
            isClone={modalCloneMode}
            onSuccess={() => { setModalFormOpen(false); setModalCloneMode(false) }}
            onCancel={() => { setModalFormOpen(false); setModalCloneMode(false) }}
          />
        </Modal>
      )}

      {/* ── Confirm: Desactivar ─────────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmDesactOpen}
        onClose={() => { setConfirmDesactOpen(false); setProductoADesact(null) }}
        onConfirm={confirmarDesactivar}
        title={productoADesact?.activo === false ? "¿Activar producto?" : "¿Desactivar producto?"}
        message={
          productoADesact?.activo === false
            ? `"${productoADesact?.nombre}" volverá a estar disponible en el catálogo de ventas.`
            : `"${productoADesact?.nombre}" dejará de aparecer en el catálogo.`
        }
        confirmText={productoADesact?.activo === false ? "Sí, activar" : "Sí, desactivar"}
        variant={productoADesact?.activo === false ? "info" : "danger"}
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
      {puedeGestionarInventario && (
        <MovimientoLoteModal
          isOpen={modalLoteOpen}
          onClose={() => setModalLoteOpen(false)}
          productos={todosProductos}
        />
      )}

      {/* ── Modal: Kardex ─────────────────────────────────────────────────── */}
      {esPrivilegiado && (
        <KardexModal
          isOpen={!!kardexProducto}
          onClose={() => setKardexProducto(null)}
          producto={kardexProducto}
        />
      )}

      {/* ── Modal: Lista de Precios PDF ──────────────────────────────────── */}
      <ListaPreciosModal
        isOpen={showListaPrecios}
        onClose={() => setShowListaPrecios(false)}
        productos={productosFiltrados}
        tasa={tasaEfectiva}
        config={configNeg}
      />

      {/* ── Modal: Detalle de Producto (para screenshot/compartir) ─────── */}
      <ProductoDetalleModal
        isOpen={!!detalleProducto}
        onClose={() => setDetalleProducto(null)}
        producto={detalleProducto ? { ...detalleProducto, nombre: detalleProducto.nombre?.toUpperCase() } : null}
        tasa={tasaEfectiva}
      />

      {/* ── Modal: Búsqueda por Lista (procesar texto de clientes) ──────── */}
      <BusquedaListaModal
        open={showBusquedaLista}
        onClose={() => setShowBusquedaLista(false)}
        productos={todosProductos}
        tasa={tasaEfectiva}
        configNeg={configNeg}
      />

      <ModalBatchPrice
        isOpen={showBatchPrice}
        onClose={() => setShowBatchPrice(false)}
        cuentaId={user?.id}
        categorias={categoriasBatch}
        onSuccess={() => refetch()}
      />

      <ModalTransformacion
        isOpen={showTransformacion}
        onClose={() => setShowTransformacion(false)}
        productos={todosProductos}
        cuentaId={user?.id}
        onSuccess={refetch}
      />

      <IngresoLoteHubModal
        isOpen={showIngresoLote}
        onClose={() => setShowIngresoLote(false)}
        productos={todosProductos}
        categorias={categoriasBatch}
        onSuccess={refetch}
      />

      <ImportadorModal
        isOpen={showImportador}
        onClose={() => setShowImportador(false)}
        onSuccess={refetch}
      />
    </div>
  )
}
