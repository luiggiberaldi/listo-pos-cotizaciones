// src/components/cotizaciones/CotizacionBuscador.jsx
// Buscador de productos con selector de precios, tarjetas e ítems de línea
import { useState } from 'react'
import {
  Search, X, Plus, Minus, Package, Camera, Trash2,
} from 'lucide-react'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useInventario, useCategorias } from '../../hooks/useInventario'
import { useStockComprometido } from '../../hooks/useStockComprometido'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { round2 } from '../../utils/dinero'
import { guardarProductoReciente } from './ProductosRecientes'
import ProductCard from '../shared/ProductCard'
import CategoryPills from '../shared/CategoryPills'

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
                <span className={`text-base font-black mt-0.5 ${active ? 'text-white' : 'text-slate-800'}`}>${Number(n.value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
            title={`${n.label}: $${Number(n.value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
        <div className="font-semibold text-sm text-slate-800">{item.nombreSnap}</div>
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
          className="w-20 px-2 py-2.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary bg-white transition-all min-h-[44px]"
        />
      </td>
      <td className="py-3 px-2">
        <input type="number" min="0" step="0.01"
          value={item.precioUnitUsd}
          onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
          onFocus={e => e.target.select()}
          className="w-24 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary bg-white transition-all"
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
          <p className="font-medium text-sm text-slate-800">{item.nombreSnap}</p>
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
export default function BuscadorProductos({ onAgregar, onScanClick, itemsAgregados = [], tasa = 0, onCambiarCantidad, onEliminarItem }) {
  const [texto, setTexto] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const { perfil } = useAuthStore()
  const [editQty, setEditQty] = useState(null) // { productoId, nombre, cantidad, stock }

  // Estado para producto externo
  const [showExt, setShowExt] = useState(false)
  const [extNombre, setExtNombre] = useState('')
  const [extUnidad, setExtUnidad] = useState('und')
  const [extPrecio, setExtPrecio] = useState('')
  const [extCantidad, setExtCantidad] = useState(1)

  const { data: inventarioData, isLoading } = useInventario({ pageSize: 1000 })
  const todosProductos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()
  const { data: stockComprometido = {} } = useStockComprometido()

  const filtrados = useProductSearch(todosProductos, texto, catActiva)

  const idsAgregados = new Set(itemsAgregados.map(it => it.productoId))
  const itemsMap = Object.fromEntries(itemsAgregados.map((it, idx) => [it.productoId, { ...it, _idx: idx }]))

  // Wrapper que también guarda en recientes
  function agregarConReciente(p) {
    guardarProductoReciente(perfil?.id, p)
    onAgregar(p)
  }

  function cambiarTexto(val) { setTexto(val) }
  function cambiarCat(val)   { setCatActiva(val) }

  function handleAgregarExterno(e) {
    e.preventDefault()
    if (!extNombre.trim() || !extPrecio || !extCantidad) return
    const randomNums = Math.floor(1000000 + Math.random() * 9000000)
    const codigo = `EXT${randomNums}`
    
    onAgregar({
      id: null,
      codigo,
      nombre: extNombre.trim(),
      unidad: extUnidad.trim() || 'und',
      precio_usd: Number(extPrecio),
      cantidadExterna: Number(extCantidad),
      origen: 'externo'
    })
    
    setShowExt(false)
    setExtNombre('')
    setExtUnidad('und')
    setExtPrecio('')
    setExtCantidad(1)
  }

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
            className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 shadow-inner focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary placeholder:text-slate-400 transition-all"
            autoFocus
          />
          {texto && (
            <button type="button" onClick={() => cambiarTexto('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>
        {onScanClick && (
          <button type="button" onClick={onScanClick} title="Escanear lista de materiales"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-opacity text-xs sm:text-sm">
            <Camera size={16} />
            <span className="hidden sm:inline">Escanear</span>
          </button>
        )}
      </div>

      <div className="flex justify-end mt-1">
        <button type="button" onClick={() => setShowExt(!showExt)}
          className={`text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-all ${
            showExt ? 'bg-primary text-white border-primary shadow-sm' : 'text-primary hover:bg-primary/5 border-primary/20 bg-primary/5'
          }`}>
          {showExt ? <Minus size={14} /> : <Plus size={14} />} Producto externo
        </button>
      </div>

      {showExt && (
        <form onSubmit={handleAgregarExterno} className="bg-white border-2 border-primary/20 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Package size={16} className="text-primary" />
            <h4 className="text-sm font-bold text-slate-700">Agregar producto manual</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
              <label className="text-xs font-medium text-slate-500">Nombre del producto *</label>
              <input type="text" value={extNombre} onChange={e => setExtNombre(e.target.value.toUpperCase())} required autoFocus placeholder="Ej: Cemento gris" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Unidad</label>
              <input type="text" value={extUnidad} onChange={e => setExtUnidad(e.target.value.toUpperCase())} placeholder="Ej: und, saco, m" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Precio USD *</label>
              <input type="number" min="0.01" step="0.01" value={extPrecio} onChange={e => setExtPrecio(e.target.value)} required placeholder="0.00" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Cantidad *</label>
              <input type="number" min="0.01" step="0.01" value={extCantidad} onChange={e => setExtCantidad(e.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-focus transition-colors shadow-sm">
              Agregar a la cotización
            </button>
          </div>
        </form>
      )}

      {/* Chips de categoría — colapsables en móvil, scroll en desktop */}
      <CategoryPills categorias={categorias} activa={catActiva} onChange={cambiarCat} />

      {/* Cargando */}
      {isLoading && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5">
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

      {/* Productos: grid unificado (mismo estilo que VentaRapida) */}
      {!isLoading && filtrados.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1 md:grid-cols-5 lg:grid-cols-6 md:gap-1.5">
            {filtrados.slice(0, 60).map(p => {
              const itemInCart = itemsMap[p.id]
              const comprometido = stockComprometido[p.id] || 0
              return (
                <ProductCard
                  key={p.id}
                  producto={p}
                  agregado={idsAgregados.has(p.id)}
                  cantidad={itemInCart?.cantidad ?? null}
                  tasa={tasa}
                  comprometido={comprometido}
                  onAgregar={agregarConReciente}
                  onMas={() => onCambiarCantidad(itemInCart._idx, 'cantidad', itemInCart.cantidad + 1)}
                  onMenos={() => itemInCart.cantidad <= 1 ? onEliminarItem(itemInCart._idx) : onCambiarCantidad(itemInCart._idx, 'cantidad', itemInCart.cantidad - 1)}
                  onCantidadDirecta={(val) => onCambiarCantidad(itemInCart._idx, 'cantidad', val)}
                />
              )
            })}
          </div>

          {/* Contador + Load More */}
          <div className="pt-1 space-y-2">
            <p className="text-[11px] text-slate-400 text-center">
              {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
            </p>
          </div>
        </>
      )}

      {/* Sin resultados */}
      {!isLoading && filtrados.length === 0 && (texto || catActiva) && (
        <div className="text-center py-10">
          <Search size={28} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400">Sin resultados</p>
          <p className="text-xs text-slate-300 mt-1">Intenta con otro término o categoría</p>
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
