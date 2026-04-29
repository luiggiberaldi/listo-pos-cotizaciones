// src/views/VentaRapidaView.jsx
// Venta rápida — wizard de 3 pasos: cliente+productos, pago, confirmar
import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, User, X, Plus, Minus, Package, ArrowLeft, ArrowRight, Loader2,
  Search, CheckCircle, ShoppingCart, DollarSign, Truck, CreditCard,
  AlertCircle, ChevronRight, ChevronLeft, UserPlus, ChevronUp, Hash, FileText, Trash2, Save,
} from 'lucide-react'
import { useClientes } from '../hooks/useClientes'
import ClienteForm from '../components/clientes/ClienteForm'
import { useInventario, useCategorias } from '../hooks/useInventario'
import { useProductSearch } from '../hooks/useProductSearch'
import { useLineItems } from '../hooks/useLineItems'
import { useVentaRapida } from '../hooks/useVentaRapida'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useTransportistas, useCrearTransportista } from '../hooks/useTransportistas'
import CustomSelect from '../components/ui/CustomSelect'
import useAuthStore from '../store/useAuthStore'
import { round2, mulR } from '../utils/dinero'
import { calcTotales } from '../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../utils/format'
import { guardarProductoReciente, getProductosRecientes } from '../components/cotizaciones/ProductosRecientes'
import { showToast } from '../components/ui/Toast'
import PageHeader from '../components/ui/PageHeader'

const FORMAS_PAGO = ['Efectivo', 'Zelle', 'Pago Móvil', 'USDT', 'Transferencia', 'Cta por cobrar']

// ─── Draft (retomar) helpers ──────────────────────────────────────────────────
const VR_DRAFT_KEY = 'construacero_venta_rapida_draft'

function getDraftKey(userId) {
  return userId ? `${VR_DRAFT_KEY}_${userId}` : VR_DRAFT_KEY
}

function saveDraft(state, userId) {
  try {
    localStorage.setItem(getDraftKey(userId), JSON.stringify({ ...state, _ts: Date.now(), _userId: userId }))
  } catch { /* ignorar */ }
}

function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(getDraftKey(userId))
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (Date.now() - draft._ts > 24 * 60 * 60 * 1000) { localStorage.removeItem(getDraftKey(userId)); return null }
    if (draft._userId && draft._userId !== userId) { localStorage.removeItem(getDraftKey(userId)); return null }
    return draft
  } catch { return null }
}

function clearDraft(userId) {
  try { localStorage.removeItem(getDraftKey(userId)) } catch { /* ignorar */ }
}

export default function VentaRapidaView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const navigate = useNavigate()
  const { data: clientes = [] } = useClientes()
  const { data: inventarioData } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()
  const { data: config = {} } = useConfigNegocio()
  const { data: transportistas = [] } = useTransportistas()
  const tasaHook = useTasaCambio()
  const ventaRapida = useVentaRapida()

  // Wizard step: 0=productos, 1=pago, 2=confirmar
  const [step, setStep] = useState(0)

  // Step 1: Cliente + Productos
  const [clienteId, setClienteId] = useState('')
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [clienteOpen, setClienteOpen] = useState(false)
  const [productoBusqueda, setProductoBusqueda] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const { items, setItems, agregarItem: _agregarItem, eliminarPorId: quitarItem, cambiarCantidad, setCantidadDirecta, cambiarPrecio, setStockMap } = useLineItems({ checkStock: true })

  // Mantener stock map actualizado para validación de cantidades
  useEffect(() => {
    if (productos.length > 0) {
      const map = {}
      productos.forEach(p => { map[p.id] = Number(p.stock_actual) || 0 })
      setStockMap(map)
    }
  }, [productos, setStockMap])

  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [confirmAjeno, setConfirmAjeno] = useState(null)

  // Step 2: Pago + Envío
  const [formasPago, setFormasPago] = useState([]) // [{metodo, monto}]
  const [referenciaPago, setReferenciaPago] = useState('')
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [notas, setNotas] = useState('')

  const clienteRef = useRef(null)
  const productoInputRef = useRef(null)

  // ─── Draft (retomar) ───────────────────────────────────────────────────────
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const draftRef = useRef(null)

  // Restaurar borrador al montar
  useEffect(() => {
    const draft = loadDraft(perfil?.id)
    if (draft && (draft.items?.length > 0 || draft.clienteId)) {
      draftRef.current = draft
      setShowDraftBanner(true)
    }
  }, [])

  // Auto-guardado debounced 1.5s
  useEffect(() => {
    if (ventaRapida.isPending) return
    const timer = setTimeout(() => {
      if (items.length > 0 || clienteId) {
        saveDraft({ step, clienteId, items, formasPago, referenciaPago, transportistaId, fleteUsd, notas }, perfil?.id)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [step, clienteId, items, formasPago, referenciaPago, transportistaId, fleteUsd, notas, ventaRapida.isPending])

  function restoreDraft() {
    const d = draftRef.current
    if (!d) return
    if (d.clienteId) setClienteId(d.clienteId)
    if (d.items?.length > 0) setItems(d.items)
    if (d.formasPago?.length > 0) setFormasPago(d.formasPago)
    else if (d.formaPago) setFormasPago([{ metodo: d.formaPago, monto: '' }])
    if (d.referenciaPago) setReferenciaPago(d.referenciaPago)
    if (d.transportistaId) setTransportistaId(d.transportistaId)
    if (d.fleteUsd) setFleteUsd(d.fleteUsd)
    if (d.notas) setNotas(d.notas)
    if (d.step != null && d.step >= 0 && d.step <= 2) setStep(d.step)
    setShowDraftBanner(false)
    draftRef.current = null
  }

  function discardDraft() {
    clearDraft(perfil?.id)
    setShowDraftBanner(false)
    draftRef.current = null
  }

  const costoEnvioUsd = 0
  const { subtotal, totalUsd } = calcTotales(items, 0, costoEnvioUsd)
  const tasa = tasaHook.tasaEfectiva || 0
  const totalBs = tasa > 0 ? mulR(totalUsd, tasa) : 0
  const flete = Math.max(0, Number(fleteUsd) || 0)
  const totalConFlete = round2(totalUsd + flete)

  const idsAgregados = new Set(items.map(it => it.productoId))
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)

  const preciosMap = useMemo(() => {
    const m = {}
    for (const p of productos) {
      if (p.precio_2 != null || p.precio_3 != null) {
        m[p.id] = { p1: Number(p.precio_usd) || 0, p2: p.precio_2 != null ? Number(p.precio_2) : null, p3: p.precio_3 != null ? Number(p.precio_3) : null }
      }
    }
    return m
  }, [productos])
  const totalItems = items.reduce((s, it) => s + it.cantidad, 0)
  const transportistaSeleccionado = transportistas.find(t => t.id === transportistaId)

  const montoAsignadoVR = formasPago.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
  const pagoCuadradoVR = formasPago.length > 0 && Math.abs(montoAsignadoVR - totalUsd) < 0.02

  // Validaciones
  const step1Valid = !!clienteId && items.length > 0
  const step2Valid = pagoCuadradoVR

  // Close cliente dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (clienteRef.current && !clienteRef.current.contains(e.target)) setClienteOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Block scroll when mobile cart is open
  useEffect(() => {
    if (mobileCartOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [mobileCartOpen])

  // Filtrar clientes
  const clientesFiltrados = clienteBusqueda.trim()
    ? clientes.filter(c =>
        c.nombre.toLowerCase().includes(clienteBusqueda.toLowerCase()) ||
        (c.rif_cedula ?? '').toLowerCase().includes(clienteBusqueda.toLowerCase()) ||
        (c.telefono ?? '').includes(clienteBusqueda)
      ).slice(0, 8)
    : clientes.slice(0, 8)

  // Filtrar productos con smart search (ranking por relevancia)
  const productosFiltrados = useProductSearch(productos, productoBusqueda, catActiva)

  const recientes = getProductosRecientes(perfil?.id)
    .map(r => productos.find(p => p.id === r.id))
    .filter(Boolean)
    .slice(0, 6)

  function elegirCliente(c) {
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    setClienteId(c.id)
    setClienteBusqueda('')
    setClienteOpen(false)
  }

  function agregarProducto(p) {
    guardarProductoReciente(perfil?.id, p)
    _agregarItem(p)
  }


  async function handleSubmit() {
    if (!step1Valid || !step2Valid) return
    const fpJson = JSON.stringify(formasPago)
    ventaRapida.mutate({
      clienteId,
      clienteNombre: clienteSeleccionado?.nombre,
      transportistaId: transportistaId || null,
      fleteUsd: flete,
      formaPago: fpJson,
      formaPagoCliente: fpJson,
      referenciaPago: referenciaPago || null,
      notas,
      notasCliente: null,
      items: items.map(it => ({
        productoId: it.productoId,
        cantidad: it.cantidad,
        precioUnitUsd: it.precioUnitUsd,
        descuentoPct: 0,
      })),
      costoEnvioUsd,
      tasaBcv: tasa,
    }, {
      onSuccess: () => {
        clearDraft(perfil?.id)
        // Reset form
        setStep(0)
        setClienteId('')
        setItems([])
        setFormasPago([])
        setReferenciaPago('')
        setTransportistaId('')
        setFleteUsd('')
        setNotas('')
        navigate('/despachos')
      },
    })
  }

  // ─── Step indicators ──────────────────────────────────────────────────────
  const steps = [
    { label: 'Productos', icon: Package },
    { label: 'Pago', icon: CreditCard },
    { label: 'Confirmar', icon: CheckCircle },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Venta rápida"
        subtitle="Cotización + despacho en un solo paso"
        icon={Zap}
      />

      {showDraftBanner && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl mx-4 mt-3 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Save size={16} className="text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800 truncate">Tienes una venta sin terminar</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={restoreDraft} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg">Retomar</button>
            <button onClick={discardDraft} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">Descartar</button>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 sm:gap-2 px-4 py-2 bg-white/60 border-b border-slate-200/60">
        {steps.map((s, i) => {
          const Icon = s.icon
          const active = i === step
          const done = i < step
          return (
            <div key={i} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && <div className={`w-6 sm:w-10 h-0.5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              <button
                onClick={() => { if (done) setStep(i) }}
                disabled={!done && !active}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  active ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-300' :
                  done ? 'bg-emerald-50 text-emerald-700 cursor-pointer hover:bg-emerald-100' :
                  'bg-slate-100 text-slate-400'
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {step === 0 && (
          <Step1Productos
            clienteRef={clienteRef}
            clienteId={clienteId}
            clienteSeleccionado={clienteSeleccionado}
            clienteBusqueda={clienteBusqueda}
            setClienteBusqueda={setClienteBusqueda}
            clienteOpen={clienteOpen}
            setClienteOpen={setClienteOpen}
            clientesFiltrados={clientesFiltrados}
            elegirCliente={elegirCliente}
            setClienteId={setClienteId}
            confirmAjeno={confirmAjeno}
            setConfirmAjeno={setConfirmAjeno}
            esSupervisor={esSupervisor}
            showNuevoCliente={showNuevoCliente}
            setShowNuevoCliente={setShowNuevoCliente}
            clientes={clientes}
            productoBusqueda={productoBusqueda}
            setProductoBusqueda={setProductoBusqueda}
            productoInputRef={productoInputRef}
            categorias={categorias}
            catActiva={catActiva}
            setCatActiva={setCatActiva}
            productosFiltrados={productosFiltrados}
            recientes={recientes}
            idsAgregados={idsAgregados}
            agregarProducto={agregarProducto}
            items={items}
            cambiarCantidad={cambiarCantidad}
            setCantidadDirecta={setCantidadDirecta}
            cambiarPrecio={cambiarPrecio}
            quitarItem={quitarItem}
            preciosMap={preciosMap}
            totalItems={totalItems}
            totalUsd={totalUsd}
            totalBs={totalBs}
            tasa={tasa}
            mobileCartOpen={mobileCartOpen}
            setMobileCartOpen={setMobileCartOpen}
            step1Valid={step1Valid}
            onSiguiente={() => setStep(1)}
          />
        )}

        {step === 1 && (
          <Step2Pago
            formasPago={formasPago}
            setFormasPago={setFormasPago}
            totalConFlete={totalUsd}
            referenciaPago={referenciaPago}
            setReferenciaPago={setReferenciaPago}
            transportistas={transportistas}
            transportistaId={transportistaId}
            setTransportistaId={setTransportistaId}
            fleteUsd={fleteUsd}
            setFleteUsd={setFleteUsd}
            notas={notas}
            setNotas={setNotas}
          />
        )}

        {step === 2 && (
          <Step3Confirmar
            clienteSeleccionado={clienteSeleccionado}
            items={items}
            subtotal={subtotal}
            totalUsd={totalUsd}
            flete={flete}
            totalConFlete={totalConFlete}
            totalBs={totalBs}
            tasa={tasa}
            formasPago={formasPago}
            referenciaPago={referenciaPago}
            transportistaSeleccionado={transportistaSeleccionado}
            notas={notas}
          />
        )}
      </div>

      {/* Bottom bar with nav buttons — hidden on step 0 (use cart FAB instead) */}
      {step > 0 && (
      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 z-20">
        <button onClick={() => setStep(step - 1)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
          <ArrowLeft size={16} /> Atrás
        </button>

        {step < 2 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!step2Valid}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Siguiente <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={ventaRapida.isPending || !step1Valid || !step2Valid}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {ventaRapida.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Crear venta rápida
          </button>
        )}
      </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Swipe-to-delete wrapper (mobile only)
// ─────────────────────────────────────────────────────────────────────────────
function SwipeToDelete({ children, enabled, onDelete }) {
  const ref = useRef(null)
  const startX = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)

  if (!enabled) return children

  function handleTouchStart(e) {
    startX.current = e.touches[0].clientX
    currentX.current = 0
    swiping.current = false
    if (ref.current) ref.current.style.transition = 'none'
  }

  function handleTouchMove(e) {
    const dx = e.touches[0].clientX - startX.current
    // Only allow swipe left (negative dx)
    const offset = Math.min(0, Math.max(-80, dx))
    currentX.current = offset
    if (offset < -10) swiping.current = true
    if (ref.current) ref.current.style.transform = `translateX(${offset}px)`
  }

  function handleTouchEnd() {
    if (!ref.current) return
    ref.current.style.transition = 'transform 0.25s ease'
    if (currentX.current < -50) {
      // Snap to reveal delete
      ref.current.style.transform = 'translateX(-72px)'
    } else {
      ref.current.style.transform = 'translateX(0)'
    }
  }

  // Prevent click propagation when swiping
  function handleClick(e) {
    if (swiping.current) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Delete button behind */}
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute right-0 top-0 bottom-0 w-[72px] flex items-center justify-center bg-red-500 text-white rounded-r-xl active:bg-red-600 transition-colors">
        <div className="flex flex-col items-center gap-0.5">
          <Trash2 size={16} />
          <span className="text-[9px] font-bold">Quitar</span>
        </div>
      </button>
      {/* Swipeable content */}
      <div ref={ref}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClickCapture={handleClick}
        className="relative z-[1] bg-white rounded-xl"
      >
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Cliente + Productos
// ─────────────────────────────────────────────────────────────────────────────
function Step1Productos({
  clienteRef, clienteId, clienteSeleccionado, clienteBusqueda, setClienteBusqueda,
  clienteOpen, setClienteOpen, clientesFiltrados, elegirCliente, setClienteId,
  confirmAjeno, setConfirmAjeno, esSupervisor,
  showNuevoCliente, setShowNuevoCliente, clientes,
  productoBusqueda, setProductoBusqueda, productoInputRef,
  categorias, catActiva, setCatActiva,
  productosFiltrados, recientes, idsAgregados, agregarProducto,
  items, cambiarCantidad, setCantidadDirecta, cambiarPrecio, quitarItem,
  totalItems, totalUsd, totalBs, tasa,
  mobileCartOpen, setMobileCartOpen,
  step1Valid, onSiguiente,
  preciosMap = {},
}) {
  // Scroll arrows for categories
  const scrollRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [sheetState, setSheetState] = useState('closed')
  const sheetOpen = sheetState !== 'closed'
  const setSheetOpen = (v) => setSheetState(v ? 'normal' : 'closed')
  const sheetRef = useRef(null)
  const handleRef = useRef(null)
  const sheetStateRef = useRef(sheetState)
  sheetStateRef.current = sheetState
  const [editQty, setEditQty] = useState(null) // { productoId, nombre, cantidad }
  const editQtyRef = useRef(null)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll, { passive: true })
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect() }
  }, [categorias])

  function scrollCats(dir) {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  // Block scroll when sheet is open
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sheetOpen])

  // Tap en handle → toggle expand/normal
  const handleTapToggle = () => {
    setSheetState(s => s === 'expanded' ? 'normal' : 'expanded')
  }

  // Touch events para swipe en el handle del sheet
  useEffect(() => {
    const el = handleRef.current
    if (!el) return

    let startY = 0
    let moved = false

    const onTouchStart = (e) => {
      startY = e.touches[0].clientY
      moved = false
      if (sheetRef.current) sheetRef.current.style.transition = 'none'
    }

    const onTouchMove = (e) => {
      const dy = e.touches[0].clientY - startY
      if (Math.abs(dy) > 5) moved = true
      if (!moved) return
      e.preventDefault()
      if (!sheetRef.current) return
      const factor = dy < 0 ? 0.4 : 1
      sheetRef.current.style.transform = `translateY(${dy * factor}px)`
    }

    const onTouchEnd = (e) => {
      const dy = e.changedTouches[0].clientY - startY
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 0.3s ease, height 0.3s ease'
        sheetRef.current.style.transform = ''
      }
      if (!moved) return // tap handled by onClick
      const st = sheetStateRef.current
      if (dy < -40) {
        setSheetState('expanded')
      } else if (dy > 80) {
        setSheetState('closed')
      } else if (dy > 40 && st === 'expanded') {
        setSheetState('normal')
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // Ordenar: productos con stock primero, luego sin stock
  const productosOrdenados = useMemo(() => {
    return [...productosFiltrados].sort((a, b) => {
      const aStock = (Number(a.stock_actual) || 0) > 0 ? 0 : 1
      const bStock = (Number(b.stock_actual) || 0) > 0 ? 0 : 1
      return aStock - bStock
    })
  }, [productosFiltrados])

  const productosVisibles = productosOrdenados.slice(0, 60)

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 pb-0 lg:p-3 lg:pb-0">
      {/* Nuevo cliente modal */}
      {showNuevoCliente && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-slate-800">Nuevo cliente</h3>
              <button onClick={() => setShowNuevoCliente(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              <ClienteForm onSuccess={(nuevo) => {
                setClienteId(nuevo.id)
                setShowNuevoCliente(false)
              }} onCancel={() => setShowNuevoCliente(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Confirm ajeno modal */}
      {confirmAjeno && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3">
            <p className="text-sm font-medium text-amber-700 flex items-center gap-2">
              <AlertCircle size={16} /> Este cliente pertenece a otro vendedor
            </p>
            <p className="text-sm text-slate-600">{confirmAjeno.nombre}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAjeno(null)} className="flex-1 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200">Cancelar</button>
              <button onClick={() => { setClienteId(confirmAjeno.id); setConfirmAjeno(null); setClienteOpen(false) }}
                className="flex-1 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600">Continuar</button>
            </div>
          </div>
        </div>
      )}

      {/* Cliente selector — compact inline */}
      <div ref={clienteRef} className="relative shrink-0 mb-1.5">
        {clienteSeleccionado ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border" style={{ backgroundColor: (clienteSeleccionado.vendedor?.color || '#10b981') + '12', borderColor: (clienteSeleccionado.vendedor?.color || '#10b981') + '40' }}>
            <User size={14} className="shrink-0" style={{ color: clienteSeleccionado.vendedor?.color || '#10b981' }} />
            <p className="font-medium text-sm truncate" style={{ color: clienteSeleccionado.vendedor?.color || '#1e293b' }}>{clienteSeleccionado.nombre}</p>
            {clienteSeleccionado.rif_cedula && <span className="text-xs text-slate-400">{clienteSeleccionado.rif_cedula}</span>}
            <button onClick={() => setClienteId('')} className="ml-auto p-1 rounded-lg hover:bg-slate-100">
              <X size={14} className="text-slate-400" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" placeholder="Buscar cliente..."
                value={clienteBusqueda}
                onChange={e => { setClienteBusqueda(e.target.value); setClienteOpen(true) }}
                onFocus={() => setClienteOpen(true)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none"
              />
              {clienteOpen && clientesFiltrados.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                  {clientesFiltrados.map(c => (
                    <button key={c.id} onClick={() => elegirCliente(c)}
                      className="w-full text-left px-3 py-2 hover:bg-sky-50 text-sm flex items-center gap-2 border-b border-slate-50 last:border-0">
                      <User size={14} className="shrink-0" style={{ color: c.vendedor?.color || '#94a3b8' }} />
                      <span className="truncate font-medium" style={{ color: c.vendedor?.color || '#334155' }}>{c.nombre}</span>
                      {c.rif_cedula && <span className="text-xs text-slate-400 shrink-0">{c.rif_cedula}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowNuevoCliente(true)}
              className="px-3 py-2 rounded-xl bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200">
              <UserPlus size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ── Split: catálogo izquierda + carrito derecha (desktop) ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-3">
      {/* ── Columna izquierda: Productos ── */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto lg:pr-1 pb-16 lg:pb-0">

        {/* ── Barra de búsqueda (estilo Fase 2) ── */}
        <div className="relative mb-1.5">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input ref={productoInputRef}
            type="text" placeholder="Buscar por nombre o código..."
            value={productoBusqueda}
            onChange={e => setProductoBusqueda(e.target.value)}
            className="w-full pl-10 pr-10 py-2 rounded-xl border border-slate-200 bg-slate-50 shadow-inner text-sm focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400 transition-all"
          />
          {productoBusqueda && (
            <button type="button" onClick={() => setProductoBusqueda('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Categorías en pills scrollables con flechas ── */}
        {categorias.length > 0 && (
          <div className="relative flex items-center gap-1 mb-1.5">
            <button type="button" onClick={() => scrollCats(-1)}
              className={`shrink-0 p-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <ChevronLeft size={14} />
            </button>
            <div ref={scrollRef} className="flex-1 overflow-x-auto scrollbar-hide">
              <div className="flex gap-1.5 py-0.5 w-max">
                <button onClick={() => setCatActiva('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                    !catActiva ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  Todos
                </button>
                {categorias.map(cat => (
                  <button key={cat} onClick={() => setCatActiva(cat === catActiva ? '' : cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                      cat === catActiva ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => scrollCats(1)}
              className={`shrink-0 p-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* ── Tarjetas de productos ── */}
        {/* Vista grid compacta (móvil < md) */}
        <div className="grid grid-cols-3 gap-1 md:hidden">
          {productosVisibles.map(p => {
            const added = idsAgregados.has(p.id)
            const itemInCart = added ? items.find(it => it.productoId === p.id) : null
            const stock = Number(p.stock_actual) || 0
            const sinStock = stock <= 0
            const tieneMultiprecios = p.precio_2 != null || p.precio_3 != null
            return (
              <div key={p.id}
                className={`relative bg-white rounded-xl border px-1.5 py-1.5 flex flex-col items-center text-center transition-all active:scale-95 ${
                  sinStock
                    ? 'opacity-40 cursor-not-allowed border-slate-100'
                    : added
                      ? 'border-emerald-300 bg-emerald-50/50 shadow-sm shadow-emerald-100/80'
                      : 'border-slate-200 hover:border-primary/50'
                }`}
                onClick={() => !added && !sinStock && agregarProducto(p)}
              >
                {added && (
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl bg-emerald-400" />
                )}
                <p className={`text-[10px] font-bold leading-tight line-clamp-2 mb-0.5 w-full ${
                  added ? 'text-emerald-700' : 'text-slate-700'
                }`}>
                  {p.nombre}
                </p>
                <p className={`text-[11px] font-black ${added ? 'text-emerald-600' : 'text-slate-800'}`}>
                  {fmtUsd(p.precio_usd)}
                </p>
                {tieneMultiprecios && (
                  <p className="text-[8px] font-bold text-primary/60">{[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios</p>
                )}
                {tasa > 0 && (
                  <p className="text-[8px] text-slate-400 leading-tight">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>
                )}
                <p className={`text-[8px] font-medium mt-0.5 ${
                  sinStock ? 'text-red-500' : stock <= 5 ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  {sinStock ? 'Agotado' : `${stock} disp.`}
                </p>
                {/* Stepper para productos agregados */}
                {added && itemInCart && (
                  <div className="flex items-center gap-0.5 mt-1" onClick={e => e.stopPropagation()}>
                    <button type="button"
                      onClick={() => itemInCart.cantidad <= 1 ? quitarItem(p.id) : cambiarCantidad(p.id, -1)}
                      className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 active:bg-red-100 active:text-red-500 transition-colors">
                      {itemInCart.cantidad <= 1 ? <Trash2 size={10} strokeWidth={2.5} /> : <Minus size={11} strokeWidth={3} />}
                    </button>
                    <input
                      key={`grid-qty-${p.id}-${itemInCart.cantidad}`}
                      type="text"
                      inputMode="numeric"
                      defaultValue={itemInCart.cantidad}
                      onClick={e => e.target.select()}
                      onFocus={e => e.target.select()}
                      onBlur={e => {
                        const num = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setCantidadDirecta(p.id, num);
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                      className="w-9 h-6 rounded-md bg-white border border-slate-200 text-center text-[10px] font-black text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none"
                    />
                    <button type="button"
                      onClick={() => cambiarCantidad(p.id, 1)}
                      className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center text-emerald-600 active:bg-emerald-100 transition-colors">
                      <Plus size={11} strokeWidth={3} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Vista grid (desktop md+) */}
        <div className="hidden md:grid md:grid-cols-5 lg:grid-cols-6 gap-1.5">
          {productosVisibles.map(p => {
            const added = idsAgregados.has(p.id)
            const stock = Number(p.stock_actual) || 0
            const sinStock = stock <= 0
            const tieneMultiprecios = p.precio_2 != null || p.precio_3 != null
            return (
              <button key={p.id} type="button"
                onClick={() => !added && !sinStock && agregarProducto(p)}
                disabled={sinStock}
                className={`relative bg-white rounded-xl border p-1.5 flex flex-col items-center text-center transition-all active:scale-95 hover:shadow-sm ${
                  sinStock
                    ? 'opacity-40 cursor-not-allowed border-slate-100'
                    : added
                      ? 'border-emerald-300 shadow-sm shadow-emerald-100/80'
                      : 'border-slate-200 hover:border-primary/50'
                }`}>
                <p className={`text-[10px] font-bold leading-tight line-clamp-2 mb-0.5 ${
                  added ? 'text-emerald-700' : 'text-slate-700'
                }`}>
                  {p.nombre}
                </p>
                <p className={`text-[11px] font-black ${added ? 'text-emerald-600' : 'text-slate-800'}`}>
                  {fmtUsd(p.precio_usd)}
                </p>
                {tieneMultiprecios && (
                  <p className="text-[8px] font-bold text-primary/60">{[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios</p>
                )}
                {tasa > 0 && (
                  <p className="text-[9px] text-slate-400 leading-tight">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>
                )}
                <p className={`text-[9px] font-medium mt-0.5 ${
                  sinStock ? 'text-red-500' : stock <= 5 ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  {sinStock ? 'Agotado' : `${stock} disp.`}
                </p>
              </button>
            )
          })}
        </div>

        {productosFiltrados.length === 0 && productoBusqueda && (
          <div className="text-center py-10">
            <Search size={28} className="mx-auto text-slate-200 mb-3" />
            <p className="text-sm font-bold text-slate-400">Sin resultados</p>
            <p className="text-xs text-slate-300 mt-1">Prueba con otro término o categoría</p>
          </div>
        )}
      </div>{/* ── Fin scroll area ── */}
      </div>{/* ── Fin columna izquierda ── */}

      {/* ── Columna derecha: Carrito (desktop) ── */}
      <div className="hidden lg:flex w-72 xl:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 flex-col overflow-hidden shadow-sm">
        <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <ShoppingCart size={18} style={{ color: '#1B365D' }} />
          <h3 className="font-black text-slate-800 text-base">Carrito</h3>
          <span className="ml-auto text-xs font-bold text-slate-400">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
        </div>
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-300">
            <ShoppingCart size={32} className="mb-2 opacity-40" />
            <p className="text-sm font-medium">Carrito vacío</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 divide-y divide-slate-50">
              {items.map(it => {
                const linea = round2(it.precioUnitUsd * it.cantidad)
                return (
                  <div key={it.productoId} className="py-2">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="flex-1 text-[12px] font-bold text-slate-700 leading-snug line-clamp-2">{it.nombreSnap}</p>
                      <span className="text-[11px] font-black text-slate-800 shrink-0">{fmtUsd(linea)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
                      <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                        <button type="button"
                          onClick={() => it.cantidad <= 1 ? quitarItem(it.productoId) : cambiarCantidad(it.productoId, -1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90">
                          <Minus size={12} strokeWidth={3} />
                        </button>
                        <input
                          key={`cart-qty-${it.productoId}-${it.cantidad}`}
                          type="text"
                          inputMode="numeric"
                          defaultValue={it.cantidad}
                          onFocus={e => e.target.select()}
                          onClick={e => e.target.select()}
                          onBlur={e => {
                            const num = Math.max(1, parseInt(e.target.value, 10) || 1)
                            setCantidadDirecta(it.productoId, num)
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          className="w-9 h-7 text-center text-[12px] font-black text-slate-700 bg-white border-x border-slate-100 outline-none focus:bg-sky-50 focus:border-sky-300"
                        />
                        <button type="button"
                          onClick={() => cambiarCantidad(it.productoId, 1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90">
                          <Plus size={12} strokeWidth={3} />
                        </button>
                      </div>
                      <button type="button" onClick={() => quitarItem(it.productoId)}
                        className="w-7 h-7 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors active:scale-95">
                        <Trash2 size={12} className="text-red-400" />
                      </button>
                    </div>
                    {preciosMap[it.productoId] && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {[{ label: 'Detal', value: preciosMap[it.productoId].p1 }, { label: 'Mayor', value: preciosMap[it.productoId].p2 }, { label: 'Especial', value: preciosMap[it.productoId].p3 }]
                          .filter(n => n.value != null && Number(n.value) > 0)
                          .map(n => {
                            const active = Math.abs(Number(it.precioUnitUsd) - Number(n.value)) < 0.001
                            return (
                              <button key={n.label} type="button"
                                onClick={() => cambiarPrecio(it.productoId, Number(n.value))}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                                  active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/40'
                                }`}>
                                {n.label} {fmtUsd(n.value)}
                              </button>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="shrink-0 border-t border-slate-200 p-3 space-y-2 bg-white">
              <div className="flex justify-between items-end px-1">
                <div>
                  <span className="text-[12px] font-black text-slate-400 uppercase tracking-wider">Subtotal</span>
                  {tasa > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(totalBs)}</p>}
                </div>
                <span className="text-xl font-black text-slate-800">{fmtUsd(totalUsd)}</span>
              </div>
              <button type="button"
                onClick={() => { if (step1Valid) onSiguiente() }}
                disabled={!step1Valid}
                className="w-full flex items-center justify-center gap-2 py-3 text-white font-bold text-sm rounded-xl transition-all active:scale-[0.98] shadow-lg disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>
      </div>{/* ── Fin split layout ── */}

      {/* ── Mobile-only: Modal cantidad, FAB, Bottom Sheet ── */}
      <div className="lg:hidden">
      {/* ── Modal para editar cantidad exacta ── */}
      {editQty && (
        <div className="fixed inset-0 z-[101] bg-black/40 flex items-center justify-center p-4 md:hidden"
          onClick={() => setEditQty(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-[280px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cantidad</p>
            <p className="text-sm font-bold text-slate-700 truncate mb-3">{editQty.nombre}</p>
            <input
              ref={editQtyRef}
              type="text"
              inputMode="numeric"
              autoFocus
              min={1}
              max={editQty.stock || 99999}
              defaultValue={editQty.cantidad}
              onFocus={e => e.target.select()}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = Math.max(1, Math.floor(Number(e.target.value) || 1))
                  setCantidadDirecta(editQty.productoId, val)
                  setEditQty(null)
                }
              }}
              className="w-full text-center text-2xl font-black text-slate-800 py-3 rounded-xl border-2 border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 outline-none"
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditQty(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-600">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const val = Math.max(1, Math.floor(Number(editQtyRef.current?.value) || 1))
                  setCantidadDirecta(editQty.productoId, val)
                  setEditQty(null)
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700">
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FAB flotante (visible cuando hay items y sheet cerrado) ── */}
      {items.length > 0 && !sheetOpen && (
        <button type="button"
          onClick={() => setSheetOpen(true)}
          className="fixed bottom-[5rem] left-3 right-3 z-[96] p-3 rounded-2xl shadow-xl flex items-center justify-between active:scale-[0.97] transition-all md:bottom-16"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', boxShadow: '0 8px 30px rgba(27,54,93,0.35)' }}>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <ShoppingCart size={18} className="text-white" />
            </div>
            <div className="text-left">
              <div className="text-[10px] font-bold text-white/70 uppercase tracking-wider">Ver Carrito</div>
              <div className="text-white font-black text-sm">{totalItems} item{totalItems !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-black text-white leading-none">{fmtUsd(totalUsd)}</div>
            {tasa > 0 && <div className="text-[10px] font-bold text-white/70 mt-0.5">{fmtBs(totalBs)}</div>}
          </div>
        </button>
      )}

      {/* ── Bottom Sheet del carrito ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setSheetOpen(false)}>
          <div ref={sheetRef}
            className="bg-white w-full rounded-t-3xl shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]"
            style={{
              height: sheetState === 'expanded' ? '92vh' : '50vh',
              transition: 'transform 0.3s ease, height 0.3s ease',
            }}
            onClick={e => e.stopPropagation()}>
            {/* Handle + Header - zona de swipe */}
            <div ref={handleRef} className="shrink-0 cursor-grab active:cursor-grabbing select-none"
              onClick={handleTapToggle}
              style={{ touchAction: 'none' }}>
              {/* Handle visual */}
              <div className="flex flex-col items-center pt-3 pb-2 gap-0.5">
                <div className={`w-12 h-1.5 rounded-full transition-colors ${sheetState === 'expanded' ? 'bg-primary' : 'bg-slate-300'}`} />
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                  {sheetState === 'normal' ? '↑ Expandir' : '↓ Reducir'}
                </span>
              </div>
              {/* Header */}
              <div className="px-4 pb-3 flex items-center justify-between border-b border-slate-200">
                <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                  <ShoppingCart size={18} style={{ color: '#1B365D' }} /> Carrito
                </h3>
                <button onClick={(e) => { e.stopPropagation(); setSheetOpen(false) }}
                  className="p-1.5 rounded-lg hover:bg-slate-100">
                  <X size={18} className="text-slate-400" />
                </button>
              </div>
            </div>
            {/* Items list */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 divide-y divide-slate-50" style={{ WebkitOverflowScrolling: 'touch' }}>
              {items.map(it => {
                const linea = round2(it.precioUnitUsd * it.cantidad)
                return (
                  <div key={it.productoId} className="py-2">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="flex-1 text-[12px] font-bold text-slate-700 leading-snug line-clamp-2">{it.nombreSnap}</p>
                      <span className="text-[11px] font-black text-slate-800 shrink-0">{fmtUsd(linea)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
                      <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                        <button type="button"
                          onClick={() => it.cantidad <= 1 ? quitarItem(it.productoId) : cambiarCantidad(it.productoId, -1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90">
                          <Minus size={12} strokeWidth={3} />
                        </button>
                        <button type="button"
                          onClick={() => setEditQty({ productoId: it.productoId, nombre: it.nombreSnap, cantidad: it.cantidad, stock: null })}
                          className="w-8 h-7 text-center text-[12px] font-black text-slate-700 bg-white border-x border-slate-100 leading-7 active:bg-sky-50 active:border-sky-300">
                          {it.cantidad}
                        </button>
                        <button type="button"
                          onClick={() => cambiarCantidad(it.productoId, 1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90">
                          <Plus size={12} strokeWidth={3} />
                        </button>
                      </div>
                      <button type="button" onClick={() => quitarItem(it.productoId)}
                        className="w-7 h-7 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors active:scale-95">
                        <Trash2 size={12} className="text-red-400" />
                      </button>
                    </div>
                    {preciosMap[it.productoId] && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {[{ label: 'Detal', value: preciosMap[it.productoId].p1 }, { label: 'Mayor', value: preciosMap[it.productoId].p2 }, { label: 'Especial', value: preciosMap[it.productoId].p3 }]
                          .filter(n => n.value != null && Number(n.value) > 0)
                          .map(n => {
                            const active = Math.abs(Number(it.precioUnitUsd) - Number(n.value)) < 0.001
                            return (
                              <button key={n.label} type="button"
                                onClick={() => cambiarPrecio(it.productoId, Number(n.value))}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                                  active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/40'
                                }`}>
                                {n.label} {fmtUsd(n.value)}
                              </button>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Footer */}
            <div className="border-t border-slate-200 p-3 pb-6 space-y-2 bg-white">
              <div className="flex justify-between items-end px-1">
                <div>
                  <span className="text-[12px] font-black text-slate-400 uppercase tracking-wider">Subtotal</span>
                  {tasa > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(totalBs)}</p>}
                </div>
                <span className="text-xl font-black text-slate-800">{fmtUsd(totalUsd)}</span>
              </div>
              <button type="button"
                onClick={() => { setSheetOpen(false); if (step1Valid) onSiguiente() }}
                disabled={!step1Valid}
                className="w-full flex items-center justify-center gap-2 py-3 text-white font-bold text-sm rounded-xl transition-all active:scale-[0.98] shadow-lg disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* ── Fin lg:hidden ── */}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Pago y Envío
// ─────────────────────────────────────────────────────────────────────────────
function Step2Pago({
  formasPago, setFormasPago, totalConFlete,
  referenciaPago, setReferenciaPago,
  transportistas, transportistaId, setTransportistaId,
  fleteUsd, setFleteUsd, notas, setNotas,
}) {
  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const crearTransp = useCrearTransportista()
  const [transpError, setTranspError] = useState('')

  const montoAsignado = formasPago.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
  const pagoCuadrado = formasPago.length > 0 && Math.abs(montoAsignado - totalConFlete) < 0.02
  const diferencia = montoAsignado - totalConFlete
  const hayVuelto = formasPago.length > 0 && diferencia > 0.02
  const faltante = formasPago.length > 0 && diferencia < -0.02

  const toggleForma = (metodo) => {
    setFormasPago(prev => {
      const existe = prev.find(fp => fp.metodo === metodo)
      if (existe) return prev.filter(fp => fp.metodo !== metodo)
      const restante = totalConFlete - prev.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
      return [...prev, { metodo, monto: restante > 0 ? Number(restante.toFixed(2)) : '' }]
    })
  }

  const setMontoForma = (metodo, monto) => {
    setFormasPago(prev => prev.map(fp => fp.metodo === metodo ? { ...fp, monto } : fp))
  }

  async function handleCrearTransportista(campos) {
    setTranspError('')
    try {
      const nuevo = await crearTransp.mutateAsync(campos)
      setTransportistaId(nuevo.id)
      setShowNuevoTransp(false)
      showToast('Transportista creado y seleccionado', 'success')
    } catch (e) {
      setTranspError(e.message ?? 'Error al crear transportista')
    }
  }

  return (
    <div className="p-4 flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col lg:flex-row lg:gap-6">
      {/* ── Columna izquierda: Formas de pago ── */}
      <div className="flex-1 min-w-0">
      {/* Forma de pago del cliente */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 block">
          Formas de pago <span className="text-red-400">*</span>
        </label>

        {/* Métodos activos — fila con monto inline */}
        <div className="space-y-2 mb-3">
          {formasPago.map(fp => (
            <div key={fp.metodo} className="flex items-center gap-2 bg-sky-50 border border-sky-300 rounded-xl px-3 py-2">
              <span className="text-sm font-bold text-sky-700 w-24 shrink-0 truncate">{fp.metodo}</span>
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={fp.monto}
                  onChange={e => setMontoForma(fp.metodo, e.target.value)}
                  onFocus={e => e.target.select()}
                  placeholder="0.00"
                  className="w-full pl-6 pr-2 py-1.5 rounded-lg text-sm font-semibold border border-sky-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 text-slate-800"
                />
              </div>
              <button onClick={() => toggleForma(fp.metodo)}
                className="p-1 rounded-lg hover:bg-sky-100 text-sky-400 hover:text-sky-600 transition-colors shrink-0">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Métodos inactivos — chips para agregar */}
        {FORMAS_PAGO.some(m => !formasPago.find(f => f.metodo === m)) && (
          <div className="flex flex-wrap gap-1.5">
            {FORMAS_PAGO.filter(m => !formasPago.find(f => f.metodo === m)).map(m => (
              <button key={m} onClick={() => toggleForma(m)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95">
                <Plus size={11} strokeWidth={2.5} />{m}
              </button>
            ))}
          </div>
        )}

        {/* Barra de totales */}
        {formasPago.length > 0 && (
          <div className={`flex items-center justify-between mt-3 px-3 py-2 rounded-xl text-sm font-semibold ${
            pagoCuadrado ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : hayVuelto ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <span>Asignado: ${montoAsignado.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span>Total: ${totalConFlete.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {pagoCuadrado
              ? <CheckCircle size={16} className="text-emerald-500" />
              : hayVuelto
                ? <span className="text-xs font-bold text-amber-600">Sobran ${diferencia.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                : <span className="text-xs font-bold text-red-600">Faltan ${Math.abs(diferencia).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            }
          </div>
        )}
      </div>

      </div>{/* ── Fin columna izquierda ── */}

      {/* ── Columna derecha: Transportista + Flete + Notas ── */}
      <div className="lg:w-80 xl:w-96 shrink-0 flex flex-col gap-5">
      {/* Transportista */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
          Transportista (opcional)
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <CustomSelect
              value={transportistaId}
              onChange={setTransportistaId}
              placeholder="— Sin transportista —"
              clearable
              icon={Truck}
              options={transportistas.map(t => ({
                value: t.id,
                label: t.nombre,
                sub: t.vehiculo || undefined,
              }))}
            />
          </div>
          <button type="button"
            onClick={() => setShowNuevoTransp(!showNuevoTransp)}
            className="shrink-0 w-10 h-10 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 flex items-center justify-center transition-colors active:scale-95"
            title="Crear nuevo transportista">
            <Plus size={16} className="text-sky-600" />
          </button>
        </div>

        {/* Modal para crear transportista */}
        {showNuevoTransp && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-auto">
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Truck size={16} className="text-sky-500" />
                  Nuevo transportista
                </h3>
                <button onClick={() => { setShowNuevoTransp(false); setTranspError('') }} className="p-1.5 rounded-lg hover:bg-slate-100">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4">
                {transpError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700 mb-3">
                    {transpError}
                  </div>
                )}
                <TransportistaFormCompact
                  onGuardar={handleCrearTransportista}
                  onCancelar={() => { setShowNuevoTransp(false); setTranspError('') }}
                  cargando={crearTransp.isPending}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Flete */}
      {transportistaId && (
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
            Monto del flete (USD)
          </label>
          <input type="text" inputMode="decimal" value={fleteUsd} onChange={e => { const v = e.target.value; if (/^[0-9]*[.,]?[0-9]*$/.test(v)) setFleteUsd(v) }}
            placeholder="0.00"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
        </div>
      )}

      {/* Notas */}
      <div className="flex flex-col flex-1 min-h-0">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
          Notas (opcional)
        </label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          placeholder="Observaciones internas..."
          className="flex-1 min-h-[80px] w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none resize-none" />
      </div>
      </div>{/* ── Fin columna derecha ── */}
      </div>{/* ── Fin flex row ── */}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers RIF para formulario de transportista
// ─────────────────────────────────────────────────────────────────────────────
const PREFIJOS_RIF_VR = ['V', 'J', 'E', 'G', 'P']

function parsearRifVR(rif) {
  if (!rif) return { prefijo: 'V', numero: '' }
  const limpio = rif.trim().toUpperCase()
  const match = limpio.match(/^([VJEGP])-?(.*)$/)
  if (match) return { prefijo: match[1], numero: match[2].replace(/\./g, '') }
  return { prefijo: 'V', numero: limpio.replace(/\./g, '') }
}

function formatearRifVR(prefijo, numero) {
  const limpio = numero.replace(/[^\d-]/g, '')
  if (!limpio) return ''
  if (prefijo === 'V') return `V${limpio.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
  return `${prefijo}-${limpio}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulario compacto para crear transportista inline
// ─────────────────────────────────────────────────────────────────────────────
function TransportistaFormCompact({ onGuardar, onCancelar, cargando }) {
  const [rifPrefijo, setRifPrefijo] = useState('V')
  const [rifNumero, setRifNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [placa, setPlaca] = useState('')
  const [placaChuto, setPlacaChuto] = useState('')
  const [placaBatea, setPlacaBatea] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    onGuardar({
      nombre,
      rif: formatearRifVR(rifPrefijo, rifNumero),
      color,
      vehiculo,
      zona_cobertura: placa,
      placa_chuto: placaChuto,
      placa_batea: placaBatea,
    })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Nombre *</label>
          <input value={nombre} onChange={e => { setNombre(e.target.value.replace(/(^|\s)\S/g, c => c.toUpperCase())); setError('') }}
            placeholder="Nombre del transportista" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Cédula / RIF</label>
          <div className="flex gap-1 mb-1">
            {PREFIJOS_RIF_VR.map(p => (
              <button key={p} type="button" disabled={cargando}
                onClick={() => setRifPrefijo(p)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  rifPrefijo === p ? 'bg-sky-500 text-white shadow-sm scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                } disabled:opacity-50`}>
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <span className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[42px]">
              {rifPrefijo}{rifPrefijo !== 'V' ? '-' : ''}
            </span>
            <input value={rifNumero} onChange={e => {
              if (rifPrefijo === 'V') {
                setRifNumero(e.target.value.replace(/\D/g, '').slice(0, 9))
              } else {
                const val = e.target.value.replace(/[^\d-]/g, '')
                if (val.replace(/-/g, '').length > 10) return
                setRifNumero(val)
              }
            }}
              placeholder={rifPrefijo === 'V' ? '24457713' : '30123456-7'}
              className={`${inputCls} !rounded-l-none`} disabled={cargando} inputMode="numeric" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Color</label>
          <input value={color} onChange={e => setColor(e.target.value)}
            placeholder="Ej: Rojo, Blanco" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Vehículo</label>
          <input value={vehiculo} onChange={e => setVehiculo(e.target.value)}
            placeholder="Ej: Mack Granite 2020" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa</label>
          <input value={placa} onChange={e => setPlaca(e.target.value.toUpperCase())}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa chuto</label>
          <input value={placaChuto} onChange={e => setPlacaChuto(e.target.value.toUpperCase())}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa batea</label>
          <input value={placaBatea} onChange={e => setPlacaBatea(e.target.value.toUpperCase())}
            placeholder="Ej: XY456ZW" className={inputCls} disabled={cargando} />
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Creando...' : 'Crear transportista'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Confirmar
// ─────────────────────────────────────────────────────────────────────────────
function Step3Confirmar({
  clienteSeleccionado, items, subtotal, totalUsd, flete, totalConFlete,
  totalBs, tasa, formasPago, referenciaPago, transportistaSeleccionado, notas,
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-4 p-4 overflow-y-auto">
      {/* ── Columna izquierda: Cliente + Productos ── */}
      <div className="min-w-0 flex flex-col gap-3 lg:flex-1">
        {/* Cliente */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 shrink-0">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cliente</h3>
          <div className="flex items-center gap-2">
            <User size={14} className="text-slate-400" />
            <span className="font-medium text-sm text-slate-800">{clienteSeleccionado?.nombre}</span>
          </div>
          {clienteSeleccionado?.direccion && (
            <p className="text-xs text-slate-400 mt-0.5 ml-5">{clienteSeleccionado.direccion}</p>
          )}
        </div>

        {/* Items */}
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Productos ({items.length})
          </h3>
          <div className="space-y-1.5 max-h-60 lg:max-h-none overflow-y-auto">
            {items.map(it => (
              <div key={it.productoId} className="flex items-center justify-between text-sm py-1">
                <div className="flex-1 min-w-0">
                  <span className="text-slate-700 truncate block text-sm">{it.nombreSnap}</span>
                  <span className="text-xs text-slate-400">{it.cantidad} × {fmtUsd(it.precioUnitUsd)}</span>
                </div>
                <span className="font-semibold text-slate-800 shrink-0 ml-2">{fmtUsd(round2(it.cantidad * it.precioUnitUsd))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Columna derecha: Totales + Pago + Transporte + Notas ── */}
      <div className="lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3 mt-3 lg:mt-0">
        {/* Totales */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-slate-700">{fmtUsd(subtotal)}</span>
          </div>
          {flete > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Flete</span>
              <span className="text-slate-700">{fmtUsd(flete)}</span>
            </div>
          )}
          <div className="border-t border-slate-100 pt-1.5 flex justify-between items-end">
            <span className="font-semibold text-slate-800">Total</span>
            <div className="text-right">
              <p className="font-bold text-lg text-slate-800">{fmtUsd(totalConFlete)}</p>
              {tasa > 0 && <p className="text-xs text-slate-400">≈ {fmtBs(totalBs)}</p>}
            </div>
          </div>
        </div>

        {/* Pago */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Pago</h3>
          {formasPago.map(fp => (
            <div key={fp.metodo} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <CreditCard size={12} className="text-slate-400" />
                <span className="text-slate-700">{fp.metodo}</span>
              </div>
              <span className="font-semibold text-slate-800">{fmtUsd(Number(fp.monto) || 0)}</span>
            </div>
          ))}
        </div>

        {/* Transportista */}
        {transportistaSeleccionado && (
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Transporte</h3>
            <div className="flex items-center gap-2 text-sm">
              <Truck size={12} className="text-slate-400" />
              <span className="text-slate-700">{transportistaSeleccionado.nombre}</span>
              {transportistaSeleccionado.vehiculo && (
                <span className="text-xs text-slate-400">— {transportistaSeleccionado.vehiculo}</span>
              )}
            </div>
          </div>
        )}

        {/* Notas */}
        {notas && (
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notas</h3>
            <p className="text-sm text-slate-600">{notas}</p>
          </div>
        )}
      </div>
    </div>
  )
}
