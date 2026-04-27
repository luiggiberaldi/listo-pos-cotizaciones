// src/components/cotizaciones/CotizacionBuscador.jsx
// Buscador de productos con selector de precios, tarjetas e ítems de línea
import { useState, useRef, useEffect } from 'react'
import {
  Search, X, Plus, Minus, Package, ChevronLeft, ChevronRight,
  CheckCircle, Camera, Trash2, Eye, ChevronDown,
} from 'lucide-react'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useInventario, useCategorias } from '../../hooks/useInventario'
import { useStockComprometido } from '../../hooks/useStockComprometido'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { round2 } from '../../utils/dinero'
import { guardarProductoReciente } from './ProductosRecientes'

// ─── Selector de nivel de precio (desktop: compacto / mobile: full-width) ──
export function PrecioSelector({ precios, currentPrice, onSelect, tasa = 0, mobile = false }) {
  if (!precios) return null
  const niveles = [
    { label: 'P1', value: precios.p1 },
    { label: 'P2', value: precios.p2 },
    { label: 'P3', value: precios.p3 },
  ].filter(n => n.value != null && Number(n.value) > 0)
  if (niveles.length <= 1) return null

  if (mobile) {
    return (
      <div className="col-span-2 space-y-1.5">
        <label className="text-xs font-medium text-slate-500">Nivel de precio</label>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${niveles.length}, 1fr)` }}>
          {niveles.map(n => {
            const active = Number(currentPrice) === Number(n.value)
            return (
              <button key={n.label} type="button"
                onClick={() => onSelect(Number(n.value))}
                className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 transition-all active:scale-[0.96] touch-manipulation ${
                  active
                    ? 'border-primary bg-primary text-white shadow-md'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-primary/40'
                }`}
              >
                <span className={`text-[11px] font-bold uppercase tracking-widest ${active ? 'text-white/80' : 'text-slate-400'}`}>{n.label}</span>
                <span className={`text-base font-black mt-0.5 ${active ? 'text-white' : 'text-slate-800'}`}>${Number(n.value).toFixed(2)}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-0.5 mt-1">
      {niveles.map(n => {
        const active = Number(currentPrice) === Number(n.value)
        return (
          <button key={n.label} type="button"
            onClick={() => onSelect(Number(n.value))}
            className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all ${
              active
                ? 'bg-primary text-white'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
            }`}
            title={`${n.label}: $${Number(n.value).toFixed(2)}`}
          >
            {n.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Línea de ítem (desktop) ────────────────────────────────────────────────
export function ItemLinea({ item, idx, onChange, onDelete, tasa = 0, precios }) {
  const lineTotal = round2(item.cantidad * item.precioUnitUsd)

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60 group">
      <td className="py-3 px-3 max-w-[200px]">
        <div className="font-semibold text-sm text-slate-800 line-clamp-2">{item.nombreSnap}</div>
        {item.codigoSnap && <div className="text-[11px] text-slate-400 font-mono mt-0.5">{item.codigoSnap}</div>}
      </td>
      <td className="py-3 px-2">
        <span className="text-[11px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{item.unidadSnap}</span>
      </td>
      <td className="py-3 px-2">
        <input type="text" inputMode="decimal"
          value={item.cantidad}
          onChange={e => {
            const raw = e.target.value.replace(',', '.')
            if (raw === '' || raw === '0' || raw === '0.') return onChange(idx, 'cantidad', raw)
            const v = parseFloat(raw)
            if (!isNaN(v) && v >= 0) onChange(idx, 'cantidad', raw)
          }}
          onBlur={e => {
            const v = parseFloat(String(e.target.value).replace(',', '.'))
            onChange(idx, 'cantidad', (!isNaN(v) && v > 0) ? v : 1)
          }}
          onFocus={e => e.target.select()}
          className="w-20 px-2 py-2.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary bg-white transition-all min-h-[44px]"
        />
      </td>
      <td className="py-3 px-2">
        <input type="number" min="0" step="0.01"
          value={item.precioUnitUsd}
          onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
          onFocus={e => e.target.select()}
          className="w-24 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary bg-white transition-all"
        />
        <PrecioSelector precios={precios} currentPrice={item.precioUnitUsd} onSelect={v => onChange(idx, 'precioUnitUsd', v)} />
        {tasa > 0 && <p className="text-[10px] text-slate-400 text-right pr-1 mt-0.5">{fmtBs(usdToBs(item.precioUnitUsd, tasa))}</p>}
      </td>
      <td className="py-3 px-3 text-right">
        <p className="text-sm font-black text-slate-800">{fmtUsd(lineTotal)}</p>
        {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(lineTotal, tasa))}</p>}
      </td>
      <td className="py-3 px-2">
        <button onClick={() => onDelete(idx)}
          className="p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 group-hover:text-slate-300 transition-all">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

// ─── Tarjeta de ítem (móvil) ────────────────────────────────────────────────
export function ItemCard({ item, idx, onChange, onDelete, tasa = 0, precios }) {
  const lineTotal = round2(item.cantidad * item.precioUnitUsd)

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-slate-800 line-clamp-2">{item.nombreSnap}</p>
          {item.codigoSnap && <p className="text-xs text-slate-400 font-mono">{item.codigoSnap}</p>}
          <p className="text-xs text-slate-400">{item.unidadSnap}</p>
        </div>
        <button onClick={() => onDelete(idx)}
          className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Cantidad</label>
          <input type="text" inputMode="decimal"
            value={item.cantidad}
            onFocus={e => e.target.select()}
            onChange={e => {
              const raw = e.target.value.replace(',', '.')
              if (raw === '' || raw === '0' || raw === '0.') return onChange(idx, 'cantidad', raw)
              const v = parseFloat(raw)
              if (!isNaN(v) && v >= 0) onChange(idx, 'cantidad', raw)
            }}
            onBlur={e => {
              const v = parseFloat(String(e.target.value).replace(',', '.'))
              onChange(idx, 'cantidad', (!isNaN(v) && v > 0) ? v : 1)
            }}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Precio USD</label>
          <input type="number" min="0" step="0.01"
            value={item.precioUnitUsd}
            onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
          {tasa > 0 && <p className="text-[10px] text-slate-400 text-right">{fmtBs(usdToBs(item.precioUnitUsd, tasa))}</p>}
        </div>
        <PrecioSelector precios={precios} currentPrice={item.precioUnitUsd} onSelect={v => onChange(idx, 'precioUnitUsd', v)} tasa={tasa} mobile />
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Total</label>
          <div className="px-3 py-2.5 text-right bg-white border border-slate-200 rounded-xl">
            <p className="text-sm font-bold text-slate-800">{fmtUsd(lineTotal)}</p>
            {tasa > 0 && <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(lineTotal, tasa))}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Swipe-left para eliminar producto ──────────────────────────────────────
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
    const offset = Math.min(0, Math.max(-80, dx))
    currentX.current = offset
    if (offset < -10) swiping.current = true
    if (ref.current) ref.current.style.transform = `translateX(${offset}px)`
  }

  function handleTouchEnd() {
    if (!ref.current) return
    ref.current.style.transition = 'transform 0.25s ease'
    if (currentX.current < -50) {
      ref.current.style.transform = 'translateX(-72px)'
    } else {
      ref.current.style.transform = 'translateX(0)'
    }
  }

  function handleClick(e) {
    if (swiping.current) { e.stopPropagation(); e.preventDefault() }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute right-0 top-0 bottom-0 w-[72px] flex items-center justify-center bg-red-500 text-white rounded-r-xl active:bg-red-600 transition-colors">
        <div className="flex flex-col items-center gap-0.5">
          <Trash2 size={16} />
          <span className="text-[9px] font-bold">Quitar</span>
        </div>
      </button>
      <div ref={ref}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClickCapture={handleClick}
        className="relative z-[1] bg-white rounded-xl">
        {children}
      </div>
    </div>
  )
}

// ─── Buscador de productos ────────────────────────────────────────────────────
const PRODUCTOS_POR_PAGINA = 30

export default function BuscadorProductos({ onAgregar, onScanClick, itemsAgregados = [], tasa = 0, onCambiarCantidad, onEliminarItem }) {
  const [texto, setTexto] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const { perfil } = useAuthStore()
  const [visibleCount, setVisibleCount] = useState(PRODUCTOS_POR_PAGINA)
  const [canScrollLeft, setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [editQty, setEditQty] = useState(null) // { productoId, nombre, cantidad, stock }
  const scrollRef = useRef(null)
  const { data: inventarioData, isLoading } = useInventario({ pageSize: 1000 })
  const todosProductos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()
  const { data: stockComprometido = {} } = useStockComprometido()

  // Detectar si hay scroll disponible
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

  function scrollBy(dir) {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  const filtrados = useProductSearch(todosProductos, texto, catActiva)

  const idsAgregados = new Set(itemsAgregados.map(it => it.productoId))
  const itemsMap = Object.fromEntries(itemsAgregados.map((it, idx) => [it.productoId, { ...it, _idx: idx }]))

  // Wrapper que también guarda en recientes
  function agregarConReciente(p) {
    guardarProductoReciente(perfil?.id, p)
    onAgregar(p)
  }

  const visibles = filtrados.slice(0, visibleCount)
  const hasMore = filtrados.length > visibleCount

  function cambiarTexto(val) { setTexto(val); setVisibleCount(PRODUCTOS_POR_PAGINA) }
  function cambiarCat(val)   { setCatActiva(val); setVisibleCount(PRODUCTOS_POR_PAGINA) }

  return (
    <div className="space-y-3">

      {/* Barra de búsqueda + botón escanear */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={texto}
            onChange={e => cambiarTexto(e.target.value)}
            placeholder="Buscar por nombre o código..."
            className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 shadow-inner focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400 transition-all"
            autoFocus
          />
          {texto && (
            <button type="button" onClick={() => cambiarTexto('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>
        <button type="button" onClick={onScanClick} title="Escanear lista de materiales"
          className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-opacity text-xs sm:text-sm">
          <Camera size={16} />
          <span className="hidden sm:inline">Escanear</span>
        </button>
      </div>

      {/* Chips de categoría — scroll horizontal con flechas */}
      {categorias.length > 0 && (
        <div className="relative flex items-center gap-1">
          {/* Flecha izquierda */}
          <button type="button" onClick={() => scrollBy(-1)}
            className={`shrink-0 p-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <ChevronLeft size={14} />
          </button>

          {/* Contenedor scrollable */}
          <div ref={scrollRef} className="flex-1 overflow-x-auto scrollbar-hide">
            <div className="flex gap-1.5 py-0.5 w-max">
              <button type="button" onClick={() => cambiarCat('')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                  !catActiva ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}>
                Todos
              </button>
              {categorias.map(cat => (
                <button key={cat} type="button" onClick={() => cambiarCat(catActiva === cat ? '' : cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                    catActiva === cat ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Flecha derecha */}
          <button type="button" onClick={() => scrollBy(1)}
            className={`shrink-0 p-1 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-all ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Cargando */}
      {isLoading && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="h-10 bg-slate-100 animate-pulse" />
              <div className="p-2 space-y-1">
                <div className="h-2.5 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Productos: lista compacta en móvil, grid con fotos en desktop */}
      {!isLoading && visibles.length > 0 && (
        <>
          {/* ── Vista lista compacta (móvil < md) ── */}
          <div className="flex flex-col gap-1.5 md:hidden">
            {visibles.map(p => {
              const yaAgregado = idsAgregados.has(p.id)
              const sinStock   = p.stock_actual != null && p.stock_actual <= 0
              const sinPrecio  = !p.precio_usd || Number(p.precio_usd) <= 0
              const bloqueado  = sinStock || sinPrecio
              const comprometido = stockComprometido[p.id] || 0
              const disponibleReal = (p.stock_actual ?? 0) - comprometido
              const itemInCart = itemsMap[p.id]
              const stock = Number(p.stock_actual) || 0
              return (
                <SwipeToDelete key={p.id} enabled={yaAgregado && !!itemInCart} onDelete={() => onEliminarItem(itemInCart?._idx)}>
                <div
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all min-h-[48px] ${
                    bloqueado
                      ? 'opacity-40 cursor-not-allowed border-slate-100 bg-white'
                      : yaAgregado
                        ? 'border-emerald-300 bg-emerald-50/50 shadow-sm shadow-emerald-100/80'
                        : disponibleReal <= 0 && comprometido > 0
                          ? 'border-amber-300 bg-amber-50/30 shadow-sm shadow-amber-100/80'
                          : 'border-slate-200 bg-white hover:border-primary/50'
                  }`}
                  onClick={() => !yaAgregado && !bloqueado && agregarConReciente(p)}
                >
                  {/* Indicador izquierdo */}
                  <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${
                    yaAgregado ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}>
                    {yaAgregado
                      ? <CheckCircle size={14} className="text-emerald-500" />
                      : <Package size={14} className="text-slate-400" />
                    }
                  </div>
                  {/* Nombre + precio cuando hay stepper */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold leading-tight truncate ${
                      yaAgregado ? 'text-emerald-700' : 'text-slate-700'
                    }`}>
                      {p.nombre}
                    </p>
                    {yaAgregado && itemInCart ? (
                      <p className="text-[10px] text-slate-400">{fmtUsd(p.precio_usd)} c/u</p>
                    ) : (p.precio_2 != null || p.precio_3 != null) ? (
                      <p className="text-[9px] font-bold text-primary/60">{[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios</p>
                    ) : null}
                  </div>
                  {/* Stepper inline OR Precio+stock */}
                  {yaAgregado && itemInCart ? (
                    <div className="shrink-0 flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                      <button type="button"
                        onClick={() => itemInCart.cantidad <= 1 ? onEliminarItem(itemInCart._idx) : onCambiarCantidad(itemInCart._idx, 'cantidad', itemInCart.cantidad - 1)}
                        className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 active:bg-red-100 active:text-red-500 transition-colors">
                        {itemInCart.cantidad <= 1 ? <Trash2 size={11} strokeWidth={2.5} /> : <Minus size={12} strokeWidth={3} />}
                      </button>
                      <button type="button"
                        onClick={() => setEditQty({ productoId: p.id, nombre: p.nombre, cantidad: itemInCart.cantidad, stock, idx: itemInCart._idx })}
                        className="w-9 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs font-black text-slate-700 active:bg-sky-50 active:border-sky-300">
                        {itemInCart.cantidad}
                      </button>
                      <button type="button"
                        onClick={() => onCambiarCantidad(itemInCart._idx, 'cantidad', itemInCart.cantidad + 1)}
                        className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 active:bg-emerald-100 transition-colors">
                        <Plus size={12} strokeWidth={3} />
                      </button>
                    </div>
                  ) : (
                    <div className="shrink-0 text-right">
                      <p className={`text-xs font-black ${yaAgregado ? 'text-emerald-600' : 'text-slate-800'}`}>
                        {fmtUsd(p.precio_usd)}
                      </p>
                      {tasa > 0 && (
                        <p className="text-[9px] text-slate-400">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>
                      )}
                      <p className={`text-[9px] font-medium ${
                        sinStock ? 'text-red-500' :
                        disponibleReal <= 0 && comprometido > 0 ? 'text-amber-600' :
                        (p.stock_actual <= (p.stock_minimo || 5)) ? 'text-amber-500' : 'text-emerald-500'
                      }`}>
                        {sinStock ? 'Agotado' : comprometido > 0 ? `${p.stock_actual ?? 0} (${comprometido} comp.)` : `${p.stock_actual ?? 0} disp.`}
                      </p>
                    </div>
                  )}
                </div>
                </SwipeToDelete>
              )
            })}
          </div>

          {/* ── Vista grid con fotos (desktop md+) ── */}
          <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-5 gap-2">
            {visibles.map(p => {
              const yaAgregado = idsAgregados.has(p.id)
              const sinStock   = p.stock_actual != null && p.stock_actual <= 0
              const sinPrecio  = !p.precio_usd || Number(p.precio_usd) <= 0
              const bloqueado  = sinStock || sinPrecio
              const comprometido = stockComprometido[p.id] || 0
              const disponibleReal = (p.stock_actual ?? 0) - comprometido
              return (
                <button key={p.id} type="button"
                  onClick={() => !bloqueado && agregarConReciente(p)}
                  disabled={bloqueado}
                  title={sinPrecio ? 'Sin precio — no se puede cotizar' : sinStock ? 'Sin stock' : comprometido > 0 ? `${comprometido} comprometidas en cotizaciones activas` : undefined}
                  className={`relative bg-white rounded-xl border p-2 flex flex-col items-center text-center transition-all active:scale-95 hover:shadow-sm ${
                    bloqueado
                      ? 'opacity-40 cursor-not-allowed border-slate-100'
                      : yaAgregado
                        ? 'border-emerald-300 shadow-sm shadow-emerald-100/80'
                        : disponibleReal <= 0 && comprometido > 0
                          ? 'border-amber-300 shadow-sm shadow-amber-100/80'
                          : 'border-slate-200 hover:border-primary/50'
                  }`}>

                  {/* Icono / imagen */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1.5 overflow-hidden ${
                    yaAgregado ? 'bg-emerald-50' : 'bg-slate-50'
                  }`}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt="" className="h-full w-full object-contain" loading="lazy" />
                      : <div className={yaAgregado ? 'text-emerald-400' : 'text-slate-300'}>
                          {yaAgregado ? <CheckCircle size={18} /> : <Package size={18} />}
                        </div>
                    }
                  </div>

                  {/* Nombre */}
                  <p className={`text-[11px] font-bold leading-tight line-clamp-2 mb-1 ${
                    yaAgregado ? 'text-emerald-700' : 'text-slate-700'
                  }`}>
                    {p.nombre}
                  </p>

                  {/* Precio */}
                  <p className={`text-[11px] font-black ${yaAgregado ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {fmtUsd(p.precio_usd)}
                  </p>
                  {(p.precio_2 != null || p.precio_3 != null) && (
                    <p className="text-[8px] font-bold text-primary/60">{[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios</p>
                  )}
                  {tasa > 0 && (
                    <p className="text-[9px] text-slate-400 leading-tight">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>
                  )}

                  {/* Stock badge — color-coded */}
                  <p className={`text-[9px] font-medium mt-0.5 ${
                    sinStock ? 'text-red-500' :
                    disponibleReal <= 0 && comprometido > 0 ? 'text-amber-600' :
                    (p.stock_actual <= (p.stock_minimo || 5)) ? 'text-amber-500' : 'text-emerald-500'
                  }`}>
                    {sinStock ? 'Agotado' : comprometido > 0 ? `${p.stock_actual ?? 0} (${comprometido} comp.)` : `${p.stock_actual ?? 0} disp.`}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Contador + Load More */}
          <div className="pt-1 space-y-2">
            <p className="text-[11px] text-slate-400 text-center">
              {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
            </p>
            {hasMore && (
              <div className="flex justify-center">
                <button type="button"
                  onClick={() => setVisibleCount(prev => prev + PRODUCTOS_POR_PAGINA)}
                  className="flex items-center gap-1.5 px-5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:border-primary hover:text-primary transition-all active:scale-95 shadow-sm">
                  <ChevronDown size={14} />
                  Cargar más ({filtrados.length - visibleCount} restantes)
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Sin resultados */}
      {!isLoading && filtrados.length === 0 && (texto || catActiva) && (
        <div className="text-center py-10">
          <Search size={28} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400">Sin resultados</p>
          <p className="text-xs text-slate-300 mt-1">Prueba con otro término o categoría</p>
          <button type="button" onClick={() => { cambiarTexto(''); cambiarCat('') }}
            className="text-xs text-primary font-semibold hover:underline mt-3 block mx-auto">
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Sin inventario */}
      {!isLoading && filtrados.length === 0 && !texto && !catActiva && (
        <div className="text-center py-10">
          <Package size={28} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400">No hay productos en el inventario</p>
        </div>
      )}

      {/* Modal editar cantidad exacta */}
      {editQty && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setEditQty(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-xs p-5 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-700 truncate mb-3">{editQty.nombre}</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={editQty.stock || 99999}
                defaultValue={editQty.cantidad}
                autoFocus
                className="flex-1 text-center text-lg font-black border-2 border-slate-200 rounded-xl py-2 focus:border-primary focus:outline-none"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = Math.max(1, Math.min(Number(e.target.value) || 1, editQty.stock || 99999))
                    onCambiarCantidad(editQty.idx, 'cantidad', val)
                    setEditQty(null)
                  }
                }}
              />
              <button onClick={() => setEditQty(null)}
                className="px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 rounded-xl">Cancelar</button>
              <button onClick={(e) => {
                  const input = e.target.closest('.space-y-3')?.querySelector('input')
                  const val = Math.max(1, Math.min(Number(input?.value) || 1, editQty.stock || 99999))
                  onCambiarCantidad(editQty.idx, 'cantidad', val)
                  setEditQty(null)
                }}
                className="px-4 py-2 text-sm font-bold text-white bg-primary rounded-xl">OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
