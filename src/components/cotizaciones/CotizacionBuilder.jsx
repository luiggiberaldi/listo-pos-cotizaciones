// src/components/cotizaciones/CotizacionBuilder.jsx
// Constructor de cotizaciones — wizard de 4 pasos
// Paso 1: Seleccionar/crear cliente
// Paso 2: Agregar productos
// Paso 3: Descuentos, envío, notas y resumen
// Paso 4: Confirmación (post-envío) con PDF y WhatsApp
import { useState, useEffect, useRef, useMemo } from 'react'
import {
  User, Truck, Search, Plus, Trash2, UserPlus, ChevronDown, ChevronLeft, ChevronRight, X, Package,
  Save, Send, ArrowLeft, ArrowRight, Loader2, AlertCircle, DollarSign, RefreshCw,
  CheckCircle, FileDown, MessageCircle, StickyNote, Tag, Hash, Phone, Mail, MapPin,
  LayoutGrid, LayoutList, ShoppingCart, Minus, Camera,
} from 'lucide-react'
import { useClientes, useVendedores } from '../../hooks/useClientes'
import { useInventario, useCategorias } from '../../hooks/useInventario'
import { parseSearchTerms, smartMatchProducto } from '../../utils/smartSearch'
import { useStockComprometido } from '../../hooks/useStockComprometido'
import { useTransportistas }   from '../../hooks/useTransportistas'
import { useGuardarBorrador, useEnviarCotizacion } from '../../hooks/useCotizaciones'
import { useTasaCambio }       from '../../hooks/useTasaCambio'
import { useConfigNegocio }    from '../../hooks/useConfigNegocio'
import useAuthStore            from '../../store/useAuthStore'
import { notifyClienteAjeno }  from '../../services/notificationService'
import { sendPushNotification } from '../../hooks/usePushNotifications'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { round2, round4, mulR } from '../../utils/dinero'
import { calcTotales } from '../../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { showToast } from '../ui/Toast'

import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'
import ClienteForm from '../clientes/ClienteForm'
import ProductoAutocomplete from './ProductoAutocomplete'
import ScanMaterialListModal from './ScanMaterialListModal'
import { guardarProductoReciente } from './ProductosRecientes'

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _itemCounter = 0

const STEP_LABELS = ['Cliente', 'Productos', 'Resumen', 'Enviada']

// ─── Auto-guardado en localStorage (por usuario) ──────────────────────────
const DRAFT_KEY_BASE = 'construacero_cotizacion_draft'

function getDraftKey(userId) {
  return userId ? `${DRAFT_KEY_BASE}_${userId}` : DRAFT_KEY_BASE
}

function saveDraft(state, userId) {
  try { localStorage.setItem(getDraftKey(userId), JSON.stringify({ ...state, _ts: Date.now(), _userId: userId })) } catch {}
}

function loadDraft(userId) {
  try {
    const key = getDraftKey(userId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const draft = JSON.parse(raw)
    // Expirar después de 24h
    if (Date.now() - draft._ts > 24 * 60 * 60 * 1000) { localStorage.removeItem(key); return null }
    // Verificar que el draft pertenece al usuario actual
    if (draft._userId && draft._userId !== userId) { localStorage.removeItem(key); return null }
    return draft
  } catch { return null }
}

function clearDraft(userId) {
  try {
    localStorage.removeItem(getDraftKey(userId))
    // También limpiar el draft viejo sin userId (migración)
    localStorage.removeItem(DRAFT_KEY_BASE)
  } catch {}
}

// ─── Indicador de pasos ──────────────────────────────────────────────────────
function StepIndicator({ paso, totalPasos = 4 }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {Array.from({ length: totalPasos }).map((_, i) => {
        const step = i + 1
        const isActive = step === paso
        const isDone   = step < paso
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              isDone ? 'bg-emerald-100 text-emerald-700' : !isActive ? 'bg-slate-100 text-slate-400' : ''
            }`}
              style={isActive ? {
                background: 'linear-gradient(135deg, #1B365D, #B8860B)',
                color: 'white',
                boxShadow: '0 2px 8px rgba(27,54,93,0.3)',
              } : undefined}>
              {isDone ? <CheckCircle size={12} /> : <span>{step}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[i]}</span>
            </div>
            {i < totalPasos - 1 && (
              <div className={`w-4 sm:w-8 h-0.5 rounded-full transition-colors ${
                step < paso ? 'bg-emerald-300' : 'bg-slate-200'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Selector de nivel de precio (desktop: compacto / mobile: full-width) ──
function PrecioSelector({ precios, currentPrice, onSelect, tasa = 0, mobile = false }) {
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
function ItemLinea({ item, idx, onChange, onDelete, tasa = 0, precios }) {
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
function ItemCard({ item, idx, onChange, onDelete, tasa = 0, precios }) {
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

// ─── Buscador de productos ────────────────────────────────────────────────────
const PRODUCTOS_POR_PAGINA = 30

function BuscadorProductos({ onAgregar, onScanClick, itemsAgregados = [], tasa = 0 }) {
  const [texto, setTexto] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const { perfil } = useAuthStore()
  const [visibleCount, setVisibleCount] = useState(PRODUCTOS_POR_PAGINA)
  const [canScrollLeft, setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
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

  const searchTerms = texto.trim() ? parseSearchTerms(texto) : null
  const filtrados = todosProductos.filter(p => {
    const coincideTexto = !searchTerms || smartMatchProducto(p, searchTerms)
    const coincideCat = !catActiva || (p.categoria ?? '').toUpperCase().startsWith(catActiva.toUpperCase())
    return coincideTexto && coincideCat
  }).sort((a, b) => {
    // Productos con stock disponible primero
    const aDisp = (a.stock_actual ?? 0) > 0 ? 0 : 1
    const bDisp = (b.stock_actual ?? 0) > 0 ? 0 : 1
    return aDisp - bDisp
  })

  const idsAgregados = new Set(itemsAgregados.map(it => it.productoId))

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
              return (
                <button key={p.id} type="button"
                  onClick={() => !bloqueado && agregarConReciente(p)}
                  disabled={bloqueado}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.98] min-h-[48px] ${
                    bloqueado
                      ? 'opacity-40 cursor-not-allowed border-slate-100 bg-white'
                      : yaAgregado
                        ? 'border-emerald-300 bg-emerald-50/50 shadow-sm shadow-emerald-100/80'
                        : disponibleReal <= 0 && comprometido > 0
                          ? 'border-amber-300 bg-amber-50/30 shadow-sm shadow-amber-100/80'
                          : 'border-slate-200 bg-white hover:border-primary/50'
                  }`}>
                  {/* Indicador izquierdo */}
                  <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${
                    yaAgregado ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}>
                    {yaAgregado
                      ? <CheckCircle size={14} className="text-emerald-500" />
                      : <Package size={14} className="text-slate-400" />
                    }
                  </div>
                  {/* Nombre */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold leading-tight truncate ${
                      yaAgregado ? 'text-emerald-700' : 'text-slate-700'
                    }`}>
                      {p.nombre}
                    </p>
                    {(p.precio_2 != null || p.precio_3 != null) && (
                      <p className="text-[9px] font-bold text-primary/60">{[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios</p>
                    )}
                  </div>
                  {/* Precio + stock */}
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
                </button>
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
    </div>
  )
}

// ─── Modal de envío (con tasa auto/manual) ──────────────────────────────────
function ModalEnvio({ isOpen, onConfirm, onCancel, cargando, tasaHook }) {
  const { tasaBcv, tasaUsdt, tasaEfectiva, modoTasa, setModoTasa, tasaManual, setTasaManual, cargando: tasaCargando, refrescar } = tasaHook
  const [error, setError] = useState('')

  if (!isOpen) return null

  function confirmar() {
    if (!tasaEfectiva || tasaEfectiva <= 0) {
      setError('La tasa debe ser mayor a 0')
      return
    }
    onConfirm(tasaEfectiva)
  }

  const fmtBs = n => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-4 sm:p-6 space-y-4">
        <h3 className="font-black text-slate-800 text-lg">Enviar cotización</h3>
        <p className="text-sm text-slate-500">
          Confirma la tasa de cambio para registrar el equivalente en bolívares.
        </p>

        {/* Selector de modo: BCV / USDT / Manual */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Tasa de cambio</span>
            <button onClick={refrescar} disabled={tasaCargando}
              className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-emerald-600 transition-colors">
              <RefreshCw size={14} className={tasaCargando ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 3 botones de modo */}
          <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button onClick={() => setModoTasa('bcv')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modoTasa === 'bcv' ? 'bg-white text-emerald-600 shadow-sm border border-emerald-200' : 'text-slate-400 hover:text-slate-600'}`}>
              BCV
            </button>
            <button onClick={() => setModoTasa('usdt')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modoTasa === 'usdt' ? 'bg-white text-indigo-600 shadow-sm border border-indigo-200' : 'text-slate-400 hover:text-slate-600'}`}>
              USDT
            </button>
            <button onClick={() => setModoTasa('manual')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modoTasa === 'manual' ? 'bg-white text-amber-600 shadow-sm border border-amber-200' : 'text-slate-400 hover:text-slate-600'}`}>
              Manual
            </button>
          </div>

          {/* Info del modo activo */}
          {modoTasa === 'bcv' && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-black text-emerald-600">{fmtBs(tasaBcv.precio)} <span className="text-xs font-medium text-slate-400">Bs/$</span></p>
                <p className="text-[10px] text-slate-400">
                  {tasaBcv.fuente || 'Sin datos'}
                  {tasaBcv.ultimaActualizacion && ` · ${new Date(tasaBcv.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
            </div>
          )}

          {modoTasa === 'usdt' && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-black text-indigo-600">{fmtBs(tasaUsdt?.precio || 0)} <span className="text-xs font-medium text-slate-400">Bs/$</span></p>
                <p className="text-[10px] text-slate-400">
                  {tasaUsdt?.fuente || 'Sin datos'}
                  {tasaUsdt?.ultimaActualizacion && ` · ${new Date(tasaUsdt.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
            </div>
          )}

          {modoTasa === 'manual' && (
            <div className="space-y-1.5">
              <input type="number" min="0.01" step="0.01"
                value={tasaManual}
                onChange={e => { setTasaManual(e.target.value); setError('') }}
                placeholder="Ej: 48.50"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary-focus"
                autoFocus
              />
              <div className="flex gap-3 text-[10px] text-slate-400">
                {tasaBcv.precio > 0 && <span>BCV: {fmtBs(tasaBcv.precio)}</span>}
                {tasaUsdt?.precio > 0 && <span>USDT: {fmtBs(tasaUsdt.precio)}</span>}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={cargando || tasaEfectiva <= 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando ? <><Loader2 size={15} className="animate-spin" />Enviando...</> : 'Confirmar envío'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Selector de cliente personalizado (reemplaza el select nativo) ──────────
const TIPO_COLORS = {
  natural:  'bg-slate-100 text-slate-600',
  juridico: 'bg-violet-100 text-violet-700',
}
const TIPO_LABELS_SHORT = {
  natural: 'Natural', juridico: 'Jurídico',
}

function ClienteSelector({ clientes, clienteId, onSelect }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [confirmAjeno, setConfirmAjeno] = useState(null)
  const ref = useRef(null)
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    if (abierto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [abierto])

  const seleccionado = clientes.find(c => c.id === clienteId)
  const filtrados = busqueda.trim()
    ? clientes.filter(c =>
        c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.rif_cedula ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.telefono ?? '').includes(busqueda)
      )
    : clientes

  function elegir(c) {
    // Si es vendedor y el cliente pertenece a otro vendedor, pedir confirmación
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    onSelect(c.id)
    setAbierto(false)
    setBusqueda('')
  }

  function confirmarClienteAjeno() {
    if (confirmAjeno) {
      onSelect(confirmAjeno.id)
      setAbierto(false)
      setBusqueda('')
      setConfirmAjeno(null)
    }
  }

  function limpiar(e) {
    e.stopPropagation()
    onSelect('')
    setBusqueda('')
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
          abierto
            ? 'border-primary ring-2 ring-primary-focus bg-white'
            : seleccionado
              ? 'border-primary/30 bg-primary-light/20 hover:border-primary/50'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        {seleccionado ? (
          <>
            <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
              <User size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 text-sm truncate">{seleccionado.nombre}</p>
              <p className="text-xs text-slate-500 truncate">
                {seleccionado.rif_cedula ?? ''}{seleccionado.rif_cedula && seleccionado.telefono ? ' · ' : ''}{seleccionado.telefono ?? ''}
              </p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[seleccionado.tipo_cliente] ?? TIPO_COLORS.natural}`}>
              {TIPO_LABELS_SHORT[seleccionado.tipo_cliente] ?? 'Particular'}
            </span>
            <button type="button" onClick={limpiar}
              className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <User size={16} className="text-slate-400" />
            </div>
            <span className="flex-1 text-sm text-slate-400">Seleccionar cliente...</span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Buscador */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, RIF o teléfono..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                autoFocus
              />
            </div>
          </div>

          {/* Lista */}
          <div className="max-h-60 overflow-y-auto">
            {filtrados.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">
                {busqueda ? 'Sin resultados' : 'No hay clientes'}
              </p>
            ) : (
              filtrados.map(c => {
                const esAjeno = !esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id
                const vendedorColor = c.vendedor?.color || null
                return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegir(c)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    c.id === clienteId ? 'bg-primary-light/30' : ''
                  }`}
                  style={vendedorColor ? { borderLeft: `3px solid ${vendedorColor}` } : undefined}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={vendedorColor ? { backgroundColor: vendedorColor + '20' } : { backgroundColor: '#f1f5f9' }}>
                    <User size={14} style={vendedorColor ? { color: vendedorColor } : undefined} className={!vendedorColor ? 'text-slate-500' : ''} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[c.rif_cedula, c.telefono].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                    </p>
                  </div>
                  {esAjeno && c.vendedor && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 shrink-0 whitespace-nowrap">
                      {c.vendedor.nombre}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[c.tipo_cliente] ?? TIPO_COLORS.natural}`}>
                    {TIPO_LABELS_SHORT[c.tipo_cliente] ?? 'Particular'}
                  </span>
                  {c.id === clienteId && (
                    <CheckCircle size={14} className="text-primary shrink-0" />
                  )}
                </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Modal confirmación cliente ajeno */}
      {confirmAjeno && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmAjeno(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Cliente de otro vendedor</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <strong>{confirmAjeno.nombre}</strong> está asignado a <strong>{confirmAjeno.vendedor?.nombre || 'otro vendedor'}</strong>
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Puedes usar este cliente, pero se notificará al supervisor. ¿Deseas continuar?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAjeno(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarClienteAjeno}
                className="px-4 py-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors">
                Sí, usar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal (Wizard) ───────────────────────────────────────────

// Mini header de sección consistente con el resto de la app
function SectionH3({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: 'linear-gradient(180deg, #B8860B, #1B365D)', minHeight: '18px' }} />
      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))', border: '1px solid rgba(27,54,93,0.1)' }}>
        {Icon && <Icon size={12} style={{ color: '#1B365D' }} />}
      </div>
      <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">{children}</h3>
    </div>
  )
}
// ─── Panel de cesta (lado derecho del paso 2) ────────────────────────────────
// Inspirado en PreciosAlDia: FAB + bottom sheet en móvil, panel lateral en desktop
function CestaPanel({ items, onCambiar, onEliminar, subtotal, tasa, onSiguiente, onAnterior, preciosMap = {} }) {
  // 'closed' | 'normal' | 'expanded'
  const [sheetState, setSheetState] = useState('closed')
  const sheetOpen = sheetState !== 'closed'
  const setSheetOpen = (v) => setSheetState(v ? 'normal' : 'closed')
  const fabRef = useRef(null)
  const swipeStartY = useRef(null)
  const sheetRef = useRef(null)

  // Swipe-up en FAB para abrir (pointer events OK aquí porque es un botón simple)
  const onPointerDown = (e) => {
    swipeStartY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (swipeStartY.current === null) return
    if (swipeStartY.current - e.clientY > 30) {
      swipeStartY.current = null
      setSheetState('normal')
    }
  }
  const onPointerUp = () => { swipeStartY.current = null }

  // ── Touch events para el handle del sheet ──
  // Usamos touch events en vez de pointer events porque son más confiables en móvil
  const touchStartY = useRef(null)
  const touchStateSnap = useRef('normal') // captura el estado al iniciar el touch

  const onHandleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY
    touchStateSnap.current = sheetState // capturar estado actual
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none'
    }
  }

  const onHandleTouchMove = (e) => {
    if (touchStartY.current === null) return
    e.preventDefault() // evitar scroll del body
    const delta = e.touches[0].clientY - touchStartY.current
    if (!sheetRef.current) return
    const st = touchStateSnap.current
    if (st === 'normal' && delta < 0) {
      // Arrastrando hacia arriba en normal: feedback elástico
      sheetRef.current.style.transform = `translateY(${delta * 0.3}px)`
    } else if (st === 'expanded' && delta > 0) {
      // Arrastrando hacia abajo en expanded: sigue el dedo
      sheetRef.current.style.transform = `translateY(${delta}px)`
    }
  }

  const onHandleTouchEnd = (e) => {
    if (touchStartY.current === null) return
    const endY = e.changedTouches[0].clientY
    const delta = endY - touchStartY.current
    const st = touchStateSnap.current
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1), max-height 0.3s cubic-bezier(0.32,0.72,0,1)'
      sheetRef.current.style.transform = ''
    }
    const threshold = 30
    if (st === 'normal' && delta < -threshold) {
      setSheetState('expanded')
    } else if (st === 'expanded' && delta > threshold) {
      setSheetState('normal')
    }
    touchStartY.current = null
  }

  const totalItems = items.reduce((s, it) => s + it.cantidad, 0)

  // Contenido compartido de la lista de items (usado en bottom sheet y desktop)
  const listaItems = (
    <div className="divide-y divide-slate-50">
      {items.length === 0 && (
        <div className="p-8 text-center text-slate-400">
          <ShoppingCart size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">Cesta vacía</p>
          <p className="text-xs text-slate-300 mt-1">Selecciona productos del catálogo</p>
        </div>
      )}
      {items.map((it, idx) => {
        const linea = mulR(it.cantidad, it.precioUnitUsd)
        const precios = preciosMap[it.productoId]
        const tieneMultiprecios = precios && [precios.p1, precios.p2, precios.p3].filter(v => v != null && Number(v) > 0).length > 1
        return (
          <div key={it._key} className="px-3 sm:px-4 py-2 group">
            {/* Fila 1: nombre completo + total línea */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="flex-1 text-[12px] sm:text-[12px] font-bold text-slate-700 leading-snug line-clamp-2">{it.nombreSnap}</p>
              <span className="text-[11px] sm:text-xs font-black text-slate-800 shrink-0">{fmtUsd(linea)}</span>
            </div>
            {/* Fila 2: precio unitario + unidad + controles */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] sm:text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
              <span className="text-[11px] text-slate-400">{it.unidadSnap}</span>
              <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                <button type="button"
                  onClick={() => it.cantidad <= 1 ? onEliminar(idx) : onCambiar(idx, 'cantidad', Math.max(0.01, it.cantidad - 1))}
                  className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90">
                  <Minus size={12} strokeWidth={3} />
                </button>
                <input
                  type="text" inputMode="decimal"
                  value={it.cantidad}
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    const raw = e.target.value.replace(',', '.')
                    if (raw === '' || raw === '0' || raw === '0.') return onCambiar(idx, 'cantidad', raw)
                    const v = parseFloat(raw)
                    if (!isNaN(v) && v >= 0) onCambiar(idx, 'cantidad', raw)
                  }}
                  onBlur={e => {
                    const v = parseFloat(String(e.target.value).replace(',', '.'))
                    onCambiar(idx, 'cantidad', (!isNaN(v) && v > 0) ? v : 1)
                  }}
                  className="w-8 h-7 text-center text-[12px] font-black text-slate-700 bg-white border-x border-slate-100 outline-none"
                />
                <button type="button"
                  onClick={() => onCambiar(idx, 'cantidad', it.cantidad + 1)}
                  className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90">
                  <Plus size={12} strokeWidth={3} />
                </button>
              </div>
              <button type="button" onClick={() => onEliminar(idx)}
                className="w-7 h-7 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors active:scale-95">
                <Trash2 size={12} className="text-red-400" />
              </button>
            </div>
            {tieneMultiprecios && (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${[precios.p1, precios.p2, precios.p3].filter(v => v != null && Number(v) > 0).length}, 1fr)` }}>
                {[{ label: 'P1', value: precios.p1 }, { label: 'P2', value: precios.p2 }, { label: 'P3', value: precios.p3 }]
                  .filter(n => n.value != null && Number(n.value) > 0)
                  .map(n => {
                    const active = Number(it.precioUnitUsd) === Number(n.value)
                    return (
                      <button key={n.label} type="button"
                        onClick={() => onCambiar(idx, 'precioUnitUsd', Number(n.value))}
                        className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-xl border-2 transition-all active:scale-[0.96] touch-manipulation ${
                          active ? 'border-primary bg-primary text-white shadow-md' : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <span className={`text-[11px] font-bold uppercase tracking-widest ${active ? 'text-white/80' : 'text-slate-400'}`}>{n.label}</span>
                        <span className={`text-sm font-black mt-0.5 ${active ? 'text-white' : 'text-slate-800'}`}>${Number(n.value).toFixed(2)}</span>
                      </button>
                    )
                  })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  // Footer compartido (totales + botones)
  const footerContent = (
    <div className="border-t border-slate-200 p-3 sm:p-4 pb-6 sm:pb-4 space-y-2 sm:space-y-3 bg-white">
      {items.length > 0 && (
        <div className="flex justify-between items-end px-1">
          <div>
            <span className="text-[12px] sm:text-xs font-black text-slate-400 uppercase tracking-wider">Subtotal</span>
            {tasa > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(usdToBs(subtotal, tasa))}</p>}
          </div>
          <span className="text-xl sm:text-2xl font-black text-slate-800">{fmtUsd(subtotal)}</span>
        </div>
      )}
      <button type="button" onClick={onSiguiente} disabled={items.length === 0}
        className="w-full flex items-center justify-center gap-2 py-3 sm:py-3.5 text-white font-bold text-sm sm:text-base rounded-xl sm:rounded-2xl transition-all disabled:opacity-40 active:scale-[0.98] shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
        <ArrowRight size={16} /> Continuar al resumen
      </button>
      <button type="button" onClick={onAnterior}
        className="w-full py-2 sm:py-2.5 border border-slate-200 text-slate-500 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors">
        Volver
      </button>
    </div>
  )

  return (
    <>
      {/* ── Móvil: FAB flotante + Bottom Sheet (estilo PreciosAlDia) ── */}
      <div className="lg:hidden">
        {/* FAB: solo visible cuando hay items y el sheet está cerrado */}
        {items.length > 0 && !sheetOpen && (
          <button type="button"
            ref={fabRef}
            onClick={() => setSheetOpen(true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="fixed bottom-20 left-3 right-3 z-[98] p-3.5 rounded-2xl shadow-xl flex items-center justify-between active:scale-[0.97] transition-all md:bottom-4"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', boxShadow: '0 8px 30px rgba(27,54,93,0.35)', touchAction: 'none' }}>
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <ShoppingCart size={18} className="text-white" />
              </div>
              <div className="text-left">
                <div className="text-[10px] font-bold text-white/70 uppercase tracking-wider">Ver Cesta</div>
                <div className="text-white font-black text-sm">{items.length} producto{items.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-black text-white leading-none">{fmtUsd(subtotal)}</div>
              {tasa > 0 && <div className="text-[10px] font-bold text-white/70 mt-0.5">{fmtBs(usdToBs(subtotal, tasa))}</div>}
            </div>
          </button>
        )}

        {/* Bottom Sheet Overlay */}
        {sheetOpen && (
          <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}>
            <div ref={sheetRef}
              className="bg-white w-full rounded-t-3xl shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]"
              style={{
                maxHeight: sheetState === 'expanded' ? '95vh' : '85vh',
                transition: 'transform 0.3s cubic-bezier(0.32,0.72,0,1), max-height 0.3s cubic-bezier(0.32,0.72,0,1)',
              }}
              onClick={e => e.stopPropagation()}>
              {/* Handle + Header - zona de swipe completa */}
              <div className="shrink-0"
                onTouchStart={onHandleTouchStart}
                onTouchMove={onHandleTouchMove}
                onTouchEnd={onHandleTouchEnd}
                style={{ touchAction: 'none' }}>
                {/* Handle visual */}
                <div className="flex justify-center pt-3 pb-2">
                  <div className="w-12 h-1.5 bg-slate-300 rounded-full" />
                </div>
                {/* Header */}
                <div className="px-4 pb-3 flex items-center justify-between border-b border-slate-200">
                  <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    <ShoppingCart size={18} className="text-primary" /> Cesta
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${items.length > 0 ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}`}>
                      {items.length} items
                    </span>
                    <button type="button" onClick={() => setSheetOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                </div>
              </div>
              {/* Items scrollable */}
              <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                {listaItems}
              </div>
              {/* Footer */}
              {footerContent}
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop: panel lateral completo ── */}
      <div className="hidden lg:flex bg-white rounded-2xl border border-slate-200 flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <span className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <ShoppingCart size={14} className="text-primary" /> Cesta
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${items.length > 0 ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}`}>
            {items.length} items
          </span>
        </div>

        {/* Lista de items */}
        <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 360px)', minHeight: '120px' }}>
          {listaItems}
        </div>

        {/* Footer */}
        {footerContent}
      </div>
    </>
  )
}

export default function CotizacionBuilder({ cotizacionExistente = null, clientePreseleccionado = null, onVolver, onGuardado }) {
  const esEdicion = !!cotizacionExistente
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  // Paso actual del wizard (1-4)
  const [paso, setPaso] = useState(esEdicion ? 2 : 1)
  const [showCrearCliente, setShowCrearCliente] = useState(false)
  const [showScanModal, setShowScanModal] = useState(false)

  // Estado del formulario
  const [vendedorId,         setVendedorId]         = useState(cotizacionExistente?.vendedor_id ?? '')
  const [clienteId,          setClienteId]          = useState(cotizacionExistente?.cliente_id ?? clientePreseleccionado ?? '')
  const [transportistaId,    setTransportistaId]    = useState(cotizacionExistente?.transportista_id ?? '')
  // Calcular días de validez desde la fecha existente o usar 7 por defecto
  const [diasValidez, setDiasValidez] = useState(() => {
    if (cotizacionExistente?.valida_hasta) {
      const diff = Math.round((new Date(cotizacionExistente.valida_hasta) - new Date()) / (1000 * 60 * 60 * 24))
      return diff > 0 ? diff : 7
    }
    return 7
  })
  const validaHasta = (() => {
    const d = new Date()
    d.setDate(d.getDate() + diasValidez)
    return d.toISOString().split('T')[0]
  })()
  const [notasCliente,       setNotasCliente]       = useState(cotizacionExistente?.notas_cliente ?? '')
  const [notasInternas,      setNotasInternas]      = useState(cotizacionExistente?.notas_internas ?? '')
  const [monedaPDF,          setMonedaPDF]          = useState('$')
  const descuentoGlobalPct = 0 // Discount disabled — always 0
  const [costoEnvioUsd,      setCostoEnvioUsd]      = useState(cotizacionExistente?.costo_envio_usd ?? 0)
  const [items,              setItems]              = useState(
    (cotizacionExistente?.items ?? []).map(it => ({
      _key:          `item-${++_itemCounter}`,
      productoId:    it.producto_id,
      codigoSnap:    it.codigo_snap,
      nombreSnap:    it.nombre_snap,
      unidadSnap:    it.unidad_snap,
      cantidad:      Number(it.cantidad),
      precioUnitUsd: Number(it.precio_unit_usd),
      descuentoPct:  0, // Discount disabled — always 0
    }))
  )

  const [errorGeneral,  setErrorGeneral]  = useState('')
  const [modalEnvio,    setModalEnvio]    = useState(false)
  const [cotizacionId,  setCotizacionId]  = useState(cotizacionExistente?.id ?? null)

  // Estado post-envío (para paso 4)
  const [enviada, setEnviada] = useState(false)
  const [numDisplay, setNumDisplay] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [waLoading, setWaLoading]   = useState(false)

  // ── Auto-guardado: restaurar borrador al montar ────────────────────────────
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const draftRef = useRef(null)

  useEffect(() => {
    if (esEdicion) return
    const draft = loadDraft(perfil?.id)
    if (draft && (draft.items?.length > 0 || draft.clienteId)) {
      draftRef.current = draft
      setShowDraftBanner(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function restoreDraft() {
    const d = draftRef.current
    if (!d) return
    if (d.clienteId) setClienteId(d.clienteId)
    if (d.vendedorId) setVendedorId(d.vendedorId)
    if (d.notasCliente) setNotasCliente(d.notasCliente)
    if (d.notasInternas) setNotasInternas(d.notasInternas)
    if (d.monedaPDF) setMonedaPDF(d.monedaPDF)
    if (d.items?.length > 0) {
      setItems(d.items.map(it => ({ ...it, _key: `item-${++_itemCounter}` })))
    }
    if (d.paso && d.paso > 1 && d.paso < 4) setPaso(d.paso)
    setShowDraftBanner(false)
    draftRef.current = null
  }

  function discardDraft() {
    clearDraft(perfil?.id)
    setShowDraftBanner(false)
    draftRef.current = null
  }

  // ── Auto-guardado: persistir en localStorage (debounced 1.5s) ──────────────
  useEffect(() => {
    if (esEdicion || paso === 4 || enviada) return
    const timer = setTimeout(() => {
      if (items.length > 0 || clienteId) {
        saveDraft({ paso, clienteId, vendedorId, notasCliente, notasInternas, monedaPDF, items }, perfil?.id)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [paso, clienteId, vendedorId, notasCliente, notasInternas, monedaPDF, items, esEdicion, enviada])

  const { data: clientes      = [], refetch: refetchClientes } = useClientes()
  const { data: transportistas = [] } = useTransportistas()
  const { data: vendedores     = [] } = useVendedores()
  const { data: config = {} }  = useConfigNegocio()
  const guardarBorrador  = useGuardarBorrador()
  const enviarCotizacion = useEnviarCotizacion()
  const tasaHook         = useTasaCambio()
  const { data: inventarioParaPrecios } = useInventario({ pageSize: 1000 })

  const { subtotal, descuentoUsd, ivaUsd, totalUsd } = calcTotales(items, descuentoGlobalPct, costoEnvioUsd, config.iva_pct ?? 0)
  const totalBs = tasaHook.tasaEfectiva > 0 ? mulR(totalUsd, tasaHook.tasaEfectiva) : 0

  // Mapa de precios por producto (para selector P1/P2/P3 en la cesta)
  const preciosMap = useMemo(() => {
    const prods = inventarioParaPrecios?.productos ?? inventarioParaPrecios ?? []
    const m = {}
    for (const p of prods) {
      if (p.precio_2 != null || p.precio_3 != null) {
        m[p.id] = { p1: Number(p.precio_usd) || 0, p2: p.precio_2 != null ? Number(p.precio_2) : null, p3: p.precio_3 != null ? Number(p.precio_3) : null }
      }
    }
    return m
  }, [inventarioParaPrecios])

  // Mapa de stock por producto (para limitar cantidad en la cesta)
  const stockMap = useMemo(() => {
    const prods = inventarioParaPrecios?.productos ?? inventarioParaPrecios ?? []
    const m = {}
    for (const p of prods) m[p.id] = Number(p.stock_actual) || 0
    return m
  }, [inventarioParaPrecios])

  function getStockMax(productoId) {
    return stockMap[productoId] ?? Infinity
  }

  // Cliente seleccionado (para mostrar datos)
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)

  // ── Agregar producto ─────────────────────────────────────────────────────
  function agregarProducto(p) {
    const stock = Number(p.stock_actual) || 0
    setItems(prev => {
      const idx = prev.findIndex(it => it.productoId === p.id)
      if (idx !== -1) {
        if (prev[idx].cantidad >= stock) {
          showToast(`Stock máximo: ${stock} ${p.unidad ?? 'und'}`, 'error')
          return prev
        }
        return prev.map((it, i) => i === idx ? { ...it, cantidad: it.cantidad + 1 } : it)
      }
      return [...prev, {
        _key:          `item-${++_itemCounter}`,
        productoId:    p.id,
        codigoSnap:    p.codigo ?? '',
        nombreSnap:    p.nombre,
        unidadSnap:    p.unidad ?? 'und',
        cantidad:      1,
        precioUnitUsd: Number(p.precio_usd),
        descuentoPct:  0,
      }]
    })
  }

  // Bulk-add desde escaneo de lista
  function agregarProductosBulk(listaItems) {
    setItems(prev => {
      let updated = [...prev]
      let agregados = 0
      for (const { producto, cantidad } of listaItems) {
        const stock = Number(producto.stock_actual) || 0
        const qty = Math.min(cantidad, stock > 0 ? stock : cantidad)
        const idx = updated.findIndex(it => it.productoId === producto.id)
        if (idx !== -1) {
          const newQty = Math.min(updated[idx].cantidad + qty, stock > 0 ? stock : Infinity)
          updated = updated.map((it, i) => i === idx ? { ...it, cantidad: newQty } : it)
        } else {
          updated.push({
            _key:          `item-${++_itemCounter}`,
            productoId:    producto.id,
            codigoSnap:    producto.codigo ?? '',
            nombreSnap:    producto.nombre,
            unidadSnap:    producto.unidad ?? 'und',
            cantidad:      qty,
            precioUnitUsd: Number(producto.precio_usd),
            descuentoPct:  0,
          })
        }
        agregados++
      }
      if (agregados > 0) showToast(`${agregados} producto${agregados > 1 ? 's' : ''} agregado${agregados > 1 ? 's' : ''} desde el escaneo`, 'ok')
      return updated
    })
  }

  function cambiarItem(idx, campo, valor) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      if (campo === 'cantidad') {
        const num = parseFloat(String(valor).replace(',', '.'))
        const max = getStockMax(it.productoId)
        if (!isNaN(num) && num > max) {
          showToast(`Stock máximo: ${max}`, 'error')
          return { ...it, cantidad: max }
        }
      }
      return { ...it, [campo]: valor }
    }))
  }

  function eliminarItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Navegación entre pasos ─────────────────────────────────────────────
  function siguiente() {
    setErrorGeneral('')
    if (paso === 1) {
      // vendedorId se asigna automáticamente al perfil actual si está vacío
      if (!clienteId) { setErrorGeneral('Selecciona un cliente para continuar'); return }
      setPaso(2)
    } else if (paso === 2) {
      if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }
      setPaso(3)
    }
  }

  function anterior() {
    setErrorGeneral('')
    if (paso > 1 && paso < 4) setPaso(paso - 1)
  }

  // ── Guardar borrador ─────────────────────────────────────────────────────
  async function handleGuardar() {
    if (!clienteId) { setErrorGeneral('Selecciona un cliente'); return }
    if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }
    setErrorGeneral('')

    try {
      const id = await guardarBorrador.mutateAsync({
        cotizacionId,
        campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, ivaPct: config.iva_pct ?? 0 },
        items,
      })
      setCotizacionId(id)
      clearDraft(perfil?.id)
      onGuardado?.()
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al guardar')
    }
  }

  // ── Enviar cotización ────────────────────────────────────────────────────
  async function handleEnviar(tasaBcv) {
    if (!clienteId) { setErrorGeneral('Selecciona un cliente'); setModalEnvio(false); return }
    if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); setModalEnvio(false); return }

    try {
      let id = cotizacionId
      // Guardar primero si no tiene ID
      if (!id) {
        id = await guardarBorrador.mutateAsync({
          cotizacionId,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, ivaPct: config.iva_pct ?? 0 },
          items,
        })
        setCotizacionId(id)
      } else {
        // Actualizar borrador con datos actuales antes de enviar
        await guardarBorrador.mutateAsync({
          cotizacionId: id,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, ivaPct: config.iva_pct ?? 0 },
          items,
        })
      }
      await enviarCotizacion.mutateAsync({ cotizacionId: id, tasaBcv })
      setModalEnvio(false)

      // Obtener número de cotización para mostrar en confirmación
      const tabla = esSupervisor ? 'cotizaciones' : 'v_cotizaciones_vendedor'
      const { data: cotEnviada } = await supabase
        .from(tabla).select('numero, version').eq('id', id).single()
      if (cotEnviada) {
        const nd = cotEnviada.version > 1
          ? `COT-${String(cotEnviada.numero).padStart(5, '0')} Rev.${cotEnviada.version}`
          : `COT-${String(cotEnviada.numero).padStart(5, '0')}`
        setNumDisplay(nd)
      }

      setEnviada(true)
      clearDraft(perfil?.id)
      setPaso(4)

      // Notificar al supervisor si el vendedor usó un cliente ajeno
      const clienteUsado = clientes.find(c => c.id === clienteId)
      if (clienteUsado && perfil?.rol !== 'supervisor' && clienteUsado.vendedor_id && clienteUsado.vendedor_id !== perfil?.id) {
        const numCot = cotEnviada ? String(cotEnviada.numero).padStart(5, '0') : '—'
        notifyClienteAjeno(
          perfil?.nombre || 'Vendedor',
          clienteUsado.nombre,
          clienteUsado.vendedor?.nombre || 'otro vendedor',
          numCot,
          perfil?.rol
        )
        sendPushNotification({
          title: 'Cliente Ajeno Usado',
          message: `${perfil?.nombre} creó cotización #${numCot} con ${clienteUsado.nombre} (cliente de ${clienteUsado.vendedor?.nombre || 'otro vendedor'})`,
          tag: `cliente-ajeno-${numCot}`,
          url: '/cotizaciones',
          targetRole: 'supervisor',
        })
      }
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al enviar')
      setModalEnvio(false)
    }
  }

  // ── Acciones post-envío (Paso 4) ─────────────────────────────────────────
  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarPDF }, itemsRes, cotRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacionId).order('orden'),
        supabase.from('cotizaciones').select('id, numero, version, cotizacion_raiz_id, cliente_id, vendedor_id, transportista_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, valida_hasta, notas_cliente, creado_en, actualizado_en, enviada_en, exportada_en').eq('id', cotizacionId).single(),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (cotRes.error) throw cotRes.error
      const vendedor = esSupervisor
        ? vendedores.find(v => v.id === vendedorId) || perfil
        : perfil
      await generarPDF({
        cotizacion: { ...cotRes.data, cliente: clienteSeleccionado, vendedor },
        items: itemsRes.data ?? [],
        config,
        monedaPDF,
        tasa: tasaHook.tasaEfectiva,
        tasaUsdt: tasaHook.tasaUsdt?.precio || 0,
        tasaBcv: tasaHook.tasaBcv?.precio || 0,
      })
    } catch {
    } finally {
      setPdfLoading(false)
    }
  }

  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const [{ generarPDF }, itemsRes, cotRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacionId).order('orden'),
        supabase.from('cotizaciones').select('id, numero, version, cotizacion_raiz_id, cliente_id, vendedor_id, transportista_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, valida_hasta, notas_cliente, creado_en, actualizado_en, enviada_en, exportada_en').eq('id', cotizacionId).single(),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (cotRes.error) throw cotRes.error

      const vendedor = esSupervisor
        ? vendedores.find(v => v.id === vendedorId) || perfil
        : perfil
      const pdfBlob = await generarPDF({
        cotizacion: { ...cotRes.data, cliente: clienteSeleccionado, vendedor },
        items: itemsRes.data ?? [],
        config,
        returnBlob: true,
        monedaPDF,
        tasa: tasaHook.tasaEfectiva,
        tasaUsdt: tasaHook.tasaUsdt?.precio || 0,
        tasaBcv: tasaHook.tasaBcv?.precio || 0,
      })

      const mensajeParams = {
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteSeleccionado?.nombre,
        numDisplay,
        totalUsd,
        validaHasta,
        nombreVendedor: vendedor?.nombre || perfil?.nombre,
        items: itemsRes.data ?? [],
      }
      const mensaje = generarMensaje(mensajeParams)

      await compartirPorWhatsApp({
        pdfBlob,
        pdfFilename: `${numDisplay.replace(/\s+/g, '_')}.pdf`,
        telefono: clienteSeleccionado?.telefono,
        mensaje,
        mensajeParams,
      })
    } catch (err) {
      const texto = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteSeleccionado?.nombre,
        numDisplay,
        totalUsd,
        validaHasta,
        nombreVendedor: perfil?.nombre,
      })
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
    } finally {
      setWaLoading(false)
    }
  }

  const cargando = guardarBorrador.isPending || enviarCotizacion.isPending
  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <div className={`bg-slate-50 ${paso === 2 ? 'h-full flex flex-col' : 'min-h-full'}`}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 sticky top-0 z-10 shrink-0">
        <div className="flex items-center justify-between gap-2 max-w-6xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {paso < 4 && (
              <button onClick={paso === 1 ? onVolver : anterior}
                className="p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors shrink-0">
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="font-bold text-slate-800 text-sm sm:text-base md:text-lg truncate">
              {paso === 4 ? 'Cotización enviada' :
               esEdicion
                ? cotizacionExistente.version > 1
                  ? `Editar Rev.${cotizacionExistente.version}`
                  : `Editar borrador`
                : 'Nueva cotización'}
            </h2>
            {esEdicion && cotizacionExistente.numero && (
              <span className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">
                COT-{String(cotizacionExistente.numero).padStart(5, '0')}
                {cotizacionExistente.version > 1 && ` Rev.${cotizacionExistente.version}`}
              </span>
            )}
          </div>

          {paso < 4 && <StepIndicator paso={paso} />}
        </div>
      </div>

      {/* ── Contenido por paso ─────────────────────────────────────────── */}
      <div className={`p-3 sm:p-4 md:p-5 lg:p-6 max-w-6xl mx-auto w-full ${paso === 2 ? 'flex-1 min-h-0 flex flex-col' : 'space-y-3 sm:space-y-4 md:space-y-5'}`}>

        {/* Error general */}
        {errorGeneral && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} className="shrink-0" />
            {errorGeneral}
          </div>
        )}

        {/* Banner: retomar borrador */}
        {showDraftBanner && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-2 min-w-0">
              <Save size={16} className="text-amber-600 shrink-0" />
              <span className="text-sm font-medium text-amber-800 truncate">Tienes una cotización sin terminar</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={restoreDraft}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors">
                Retomar
              </button>
              <button type="button" onClick={discardDraft}
                className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
                Descartar
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 1: Seleccionar o crear cliente                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 1 && (
          <div className="space-y-4">
            {/* Selector de vendedor — oculto, cotizaciones quedan a nombre del usuario */}
            {false && esSupervisor && !esEdicion && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <SectionH3 icon={Tag}>Asignar a vendedor</SectionH3>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2">
                  {vendedores.map(v => {
                    const sel = vendedorId === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVendedorId(v.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-sm font-semibold ${
                          sel ? 'border-primary bg-primary-light text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: v.color || '#94a3b8' }}
                        />
                        {v.nombre}
                      </button>
                    )
                  })}
                </div>
                {!vendedorId && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle size={11} /> Selecciona a quién se le asignará esta cotización
                  </p>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <SectionH3 icon={User}>Seleccionar cliente</SectionH3>
                <button onClick={() => setShowCrearCliente(!showCrearCliente)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                  <UserPlus size={13} /> {showCrearCliente ? 'Cancelar' : 'Nuevo cliente'}
                </button>
              </div>

              {/* Crear cliente completo (formulario inline) */}
              {showCrearCliente && (
                <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4">
                  <h4 className="font-bold text-emerald-800 text-sm flex items-center gap-1.5 mb-3">
                    <UserPlus size={14} /> Registrar nuevo cliente
                  </h4>
                  <ClienteForm
                    compact
                    onSuccess={(nuevo) => {
                      refetchClientes()
                      setClienteId(nuevo.id)
                      setShowCrearCliente(false)
                    }}
                    onCancel={() => setShowCrearCliente(false)}
                  />
                </div>
              )}

              {/* Seleccionar de lista */}
              {!showCrearCliente && (
                <div className="space-y-3">
                  <ClienteSelector
                    clientes={clientes}
                    clienteId={clienteId}
                    onSelect={(id) => { setClienteId(id); setErrorGeneral('') }}
                  />

                  {/* Vista previa del cliente seleccionado */}
                  {clienteSeleccionado && (
                    <div className="bg-primary-light/30 border border-primary-focus/30 rounded-xl p-3 sm:p-4">
                      <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
                        {clienteSeleccionado.rif_cedula && (
                          <span className="flex items-center gap-1.5"><Hash size={11} className="text-slate-400" /> {clienteSeleccionado.rif_cedula}</span>
                        )}
                        {clienteSeleccionado.telefono && (
                          <span className="flex items-center gap-1.5"><Phone size={11} className="text-slate-400" /> {clienteSeleccionado.telefono}</span>
                        )}
                        {clienteSeleccionado.email && (
                          <span className="flex items-center gap-1.5"><Mail size={11} className="text-slate-400" /> {clienteSeleccionado.email}</span>
                        )}
                        {(clienteSeleccionado.direccion || clienteSeleccionado.ciudad || clienteSeleccionado.estado) && (
                          <span className="flex items-center gap-1.5 col-span-2"><MapPin size={11} className="text-slate-400" /> {[clienteSeleccionado.direccion, clienteSeleccionado.ciudad, clienteSeleccionado.estado].filter(Boolean).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Alerta: cliente de otro vendedor */}
                  {clienteSeleccionado && perfil?.rol !== 'supervisor' && clienteSeleccionado.vendedor_id && clienteSeleccionado.vendedor_id !== perfil?.id && (
                    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <AlertCircle size={16} className="text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-700">
                        Este cliente está asignado a <strong>{clienteSeleccionado.vendedor?.nombre || 'otro vendedor'}</strong>.
                        Puedes continuar, pero se notificará al supervisor al enviar la cotización.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Botón siguiente */}
            <div className="flex justify-end">
              <button onClick={siguiente}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente: Productos <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 2: Agregar productos                                      */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 2 && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Mini resumen del cliente */}
            <div className="shrink-0 bg-white rounded-xl border border-slate-200 px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 text-sm mb-3 sm:mb-4">
              <User size={14} className="text-primary shrink-0" />
              <span className="font-medium text-slate-700 truncate">{clienteSeleccionado?.nombre ?? 'Sin cliente'}</span>
              {clienteSeleccionado?.tipo_cliente && (
                <span className="text-xs text-slate-400 capitalize hidden xs:inline">· {clienteSeleccionado.tipo_cliente}</span>
              )}
            </div>

            {/* Split: catálogo izquierda + cesta derecha */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-4">

              {/* ── Catálogo de productos ── */}
              <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-white rounded-2xl border border-slate-200 p-3 sm:p-5 overflow-hidden">
                <div className="shrink-0 mb-3 sm:mb-4">
                  <SectionH3 icon={Package}>Agregar productos</SectionH3>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0">
                  <BuscadorProductos onAgregar={agregarProducto} onScanClick={() => setShowScanModal(true)} itemsAgregados={items} tasa={tasaHook.tasaEfectiva} />
                  <ScanMaterialListModal
                    open={showScanModal}
                    onClose={() => setShowScanModal(false)}
                    onBulkAdd={agregarProductosBulk}
                    tasa={tasaHook.tasaEfectiva}
                  />
                </div>
              </div>

              {/* ── Cesta flotante ── */}
              <div className="w-full lg:w-80 shrink-0 lg:sticky lg:top-[73px]">
                <CestaPanel
                  items={items}
                  onCambiar={cambiarItem}
                  onEliminar={eliminarItem}
                  subtotal={subtotal}
                  tasa={tasaHook.tasaEfectiva}
                  onSiguiente={siguiente}
                  onAnterior={anterior}
                  preciosMap={preciosMap}
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 3: Resumen, descuentos, notas y envío                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 3 && (
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">

            {/* ── Columna izquierda: formularios ── */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Moneda del PDF */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
                <SectionH3 icon={Truck}>Opciones</SectionH3>
                <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Moneda del PDF</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: '$',         label: 'USDT ($)' },
                        { value: 'bcv',       label: 'Dólar BCV' },
                        { value: 'bs',        label: 'Bolívares (Bs)' },
                        { value: 'mixto',     label: 'Mixto USDT' },
                        { value: 'mixto_bcv', label: 'Mixto BCV' },
                      ].map(opt => (
                        <button key={opt.value} type="button"
                          onClick={() => setMonedaPDF(opt.value)}
                          disabled={cargando}
                          className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all ${monedaPDF === opt.value
                            ? 'bg-primary text-white shadow-sm'
                            : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                          }`}
                          style={monedaPDF === opt.value ? { background: '#1B365D' } : {}}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {monedaPDF !== '$' && tasaHook.tasaEfectiva > 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Tasa: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2 }).format(tasaHook.tasaEfectiva)} Bs/$
                        {(monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') && tasaHook.tasaUsdt?.precio > 0 && tasaHook.tasaBcv?.precio > 0 && (
                          <> · Factor BCV: {(tasaHook.tasaUsdt.precio / tasaHook.tasaBcv.precio).toFixed(2)}</>
                        )}
                      </p>
                    )}
                </div>
              </div>

              {/* Notas */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
                <SectionH3 icon={StickyNote}>Notas</SectionH3>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                      Para el cliente
                      <span className="font-normal normal-case text-slate-400 text-[11px]">· aparece en PDF</span>
                    </label>
                    <textarea value={notasCliente} onChange={e => setNotasCliente(e.target.value)}
                      rows={3} placeholder="Ej: Precios válidos por 15 días, sujetos a disponibilidad de stock..."
                      className={`${inputCls} resize-none`} disabled={cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                      Notas internas
                      <span className="font-normal normal-case text-slate-400 text-[11px]">· no aparece en PDF</span>
                    </label>
                    <textarea value={notasInternas} onChange={e => setNotasInternas(e.target.value)}
                      rows={2} placeholder="Observaciones internas..."
                      className={`${inputCls} resize-none`} disabled={cargando} />
                  </div>
                </div>
              </div>

              {/* Navegación — solo visible en móvil (lg la mueve al panel derecho) */}
              <div className="flex flex-col gap-3 pb-4 lg:hidden">
                <button onClick={() => { setErrorGeneral(''); handleEnviar(tasaHook.tasaEfectiva) }}
                  disabled={cargando || tasaHook.tasaEfectiva <= 0}
                  className="flex items-center justify-center gap-2 w-full px-6 py-3.5 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                  {enviarCotizacion.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Enviar cotización
                </button>
                <div className="flex gap-2">
                  <button onClick={anterior} disabled={cargando}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                    <ArrowLeft size={15} /> Volver
                  </button>
                  <button onClick={handleGuardar} disabled={cargando}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                    {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Guardar
                  </button>
                </div>
              </div>
            </div>

            {/* ── Columna derecha: panel sticky de resumen ── */}
            <div className="w-full lg:w-80 xl:w-96 shrink-0 lg:sticky lg:top-[73px] space-y-3">

              {/* Cliente */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{clienteSeleccionado?.nombre}</p>
                    {clienteSeleccionado?.tipo_cliente && (
                      <p className="text-xs text-slate-400 capitalize">{clienteSeleccionado.tipo_cliente}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Lista de productos */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                    {items.length} producto{items.length !== 1 ? 's' : ''}
                  </span>
                  <button onClick={anterior} className="text-xs text-primary font-semibold hover:underline">
                    Editar
                  </button>
                </div>
                <div className="divide-y divide-slate-50 max-h-52 overflow-y-auto">
                  {items.map((it, i) => {
                    const lineTotal = round2(it.cantidad * it.precioUnitUsd)
                    return (
                      <div key={it._id ?? i} className="px-4 py-2.5 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-700 leading-tight line-clamp-2">{it.nombreSnap}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {it.cantidad} {it.unidadSnap}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-slate-700 shrink-0">{fmtUsd(lineTotal)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Totales */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-medium text-slate-700">{fmtUsd(subtotal)}</span>
                </div>
                {ivaUsd > 0 && (
                  <div className="flex justify-between text-sm text-blue-600">
                    <span>IVA ({config.iva_pct}%)</span>
                    <span className="font-medium">+{fmtUsd(ivaUsd)}</span>
                  </div>
                )}
                {costoEnvioUsd > 0 && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Envío</span>
                    <span className="font-medium text-slate-700">+{fmtUsd(costoEnvioUsd)}</span>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-3 mt-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-wide">Total</span>
                    <span className="text-2xl font-black text-slate-900">{fmtUsd(totalUsd)}</span>
                  </div>
                  {monedaPDF !== '$' && tasaHook.tasaEfectiva > 0 && totalUsd > 0 && (
                    <p className="text-right text-xs text-slate-400 mt-0.5 font-mono">
                      Bs {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalBs)}
                    </p>
                  )}
                </div>

                {/* Tasa BCV visible */}
                {tasaHook.tasaEfectiva > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-50 mt-2">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <DollarSign size={10} /> BCV: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaHook.tasaEfectiva)} Bs/$
                      {tasaHook.tasaUsdt?.precio > 0 && (
                        <> · <span className="text-indigo-500">USDT: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaHook.tasaUsdt.precio)}</span></>
                      )}
                    </span>
                    <button type="button" onClick={tasaHook.refrescar}
                      className="p-1 text-slate-300 hover:text-primary transition-colors rounded">
                      <RefreshCw size={11} className={tasaHook.cargando ? 'animate-spin' : ''} />
                    </button>
                  </div>
                )}

                {/* Comisión estimada (solo vendedor) */}
                {!esSupervisor && totalUsd > 0 && config.comision_pct > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-50 mt-2">
                    <span className="text-[11px] text-emerald-600 font-semibold">
                      Comisión estimada
                    </span>
                    <span className="text-[11px] font-bold text-emerald-600">
                      ~{fmtUsd(round2(totalUsd * (config.comision_pct / 100)))}
                    </span>
                  </div>
                )}
              </div>

              {/* Botones — solo desktop */}
              <div className="hidden lg:flex flex-col gap-2">
                <button onClick={() => { setErrorGeneral(''); handleEnviar(tasaHook.tasaEfectiva) }}
                  disabled={cargando || tasaHook.tasaEfectiva <= 0}
                  className="flex items-center justify-center gap-2 w-full px-6 py-3.5 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                  {enviarCotizacion.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Enviar cotización
                </button>
                <button onClick={handleGuardar} disabled={cargando}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                  {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Guardar borrador
                </button>
                <button onClick={anterior} disabled={cargando}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                  <ArrowLeft size={15} /> Volver a productos
                </button>
              </div>
            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 4: Confirmación post-envío                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 4 && (
          <div className="flex items-center justify-center min-h-[50vh] px-2">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full">

              {/* Header de éxito con animación sutil */}
              <div className="relative h-28 sm:h-32 flex flex-col items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #1B365D 0%, #2d5a8e 50%, #B8860B 100%)' }}>
                <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
                  style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
                <div className="relative z-10 w-14 h-14 rounded-full flex items-center justify-center bg-white/20 backdrop-blur-sm border-2 border-white/40 shadow-lg">
                  <CheckCircle size={28} color="white" strokeWidth={2.5} />
                </div>
                <p className="relative z-10 text-white/80 text-xs font-medium mt-2 tracking-wide uppercase">Enviada exitosamente</p>
              </div>

              <div className="p-5 sm:p-6 md:p-8 space-y-5 text-center">
                {/* Número de cotización destacado */}
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Cotización enviada</h3>
                  {numDisplay && (
                    <p className="font-black text-2xl font-mono mt-1 tracking-tight" style={{ color: '#1B365D' }}>{numDisplay}</p>
                  )}
                </div>

                {/* Resumen con separadores */}
                <div className="bg-slate-50 rounded-xl p-4 divide-y divide-slate-100">
                  <div className="flex justify-between py-2.5 first:pt-0">
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Cliente</span>
                    <span className="font-semibold text-slate-800 text-sm">{clienteSeleccionado?.nombre}</span>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Total</span>
                    <span className="font-bold text-slate-900 text-base">{fmtUsd(totalUsd)}</span>
                  </div>
                  <div className="flex justify-between py-2.5 last:pb-0">
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Items</span>
                    <span className="font-medium text-slate-700 text-sm">{items.length} producto{items.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {/* Acciones */}
                <div className="space-y-3 pt-1">
                  <div className="flex flex-col xs:flex-row gap-2 sm:gap-3">
                    <button onClick={descargarPDF} disabled={pdfLoading}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ backgroundColor: '#1B365D10', color: '#1B365D' }}>
                      {pdfLoading
                        ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <FileDown size={16} />}
                      Descargar PDF
                    </button>
                    <button onClick={handleWhatsApp} disabled={waLoading}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-sm rounded-xl transition-all active:scale-[0.98] disabled:opacity-50">
                      {waLoading
                        ? <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                        : <MessageCircle size={16} />}
                      WhatsApp
                    </button>
                  </div>

                  <button onClick={onGuardado}
                    className="w-full py-3.5 text-white font-bold text-sm rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-[0.98] flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                    <Plus size={16} /> Nueva cotización
                  </button>

                  <button onClick={onVolver}
                    className="w-full py-2.5 text-slate-400 hover:text-slate-600 font-medium text-xs transition-colors uppercase tracking-wide">
                    Volver a la lista
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Modal de envío */}
      <ModalEnvio
        isOpen={modalEnvio}
        onConfirm={handleEnviar}
        onCancel={() => setModalEnvio(false)}
        cargando={enviarCotizacion.isPending}
        tasaHook={tasaHook}
      />
    </div>
  )
}
