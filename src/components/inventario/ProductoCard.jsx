// src/components/inventario/ProductoCard.jsx
import { Hash, Tag, Layers, Pencil, EyeOff, AlertTriangle, Package, Trash2 } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { fmtBs, usdToBs } from '../../utils/format'
import StockComprometidoDetalle from './StockComprometidoDetalle'

function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

// Color determinista basado en la cadena de categoría
const PALETA = [
  ['#1e40af','#dbeafe'], ['#065f46','#d1fae5'], ['#92400e','#fef3c7'],
  ['#7c3aed','#ede9fe'], ['#be185d','#fce7f3'], ['#0f766e','#ccfbf1'],
  ['#b45309','#fef9c3'], ['#1d4ed8','#eff6ff'], ['#166534','#dcfce7'],
]
function colorCategoria(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff
  const [fg, bg] = PALETA[h % PALETA.length]
  return { fg, bg }
}

function BadgeStock({ actual, minimo, comprometido = 0, productoId }) {
  const agotado = actual <= 0
  const bajo = !agotado && minimo > 0 && actual <= minimo
  const disponible = actual - comprometido
  const sobrecomprometido = comprometido > 0 && disponible < 0

  if (agotado) return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full">
      Agotado
    </span>
  )
  if (sobrecomprometido) return (
    <div className="text-right">
      <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
        <AlertTriangle size={9} />
        {Number(actual).toLocaleString('es-VE')}
      </span>
      <StockComprometidoDetalle productoId={productoId} comprometido={comprometido} />
    </div>
  )
  if (bajo) return (
    <div className="text-right">
      <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">
        <AlertTriangle size={9} />
        {Number(actual).toLocaleString('es-VE')}
      </span>
      {comprometido > 0 && <StockComprometidoDetalle productoId={productoId} comprometido={comprometido} />}
    </div>
  )
  return (
    <div className="text-right">
      <span className="text-[10px] text-slate-400">Stock: {Number(actual).toLocaleString('es-VE')}</span>
      {comprometido > 0 && <div><StockComprometidoDetalle productoId={productoId} comprometido={comprometido} /></div>}
    </div>
  )
}

export default function ProductoCard({ producto, onEditar, onDesactivar, onBorrar, tasa = 0, comprometido = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { fg, bg } = colorCategoria(producto.categoria || '')

  const stockActual = Number(producto.stock_actual) || 0
  const stockMinimo = Number(producto.stock_minimo) || 0
  const agotado = stockActual <= 0
  const stockBajo = !agotado && stockMinimo > 0 && stockActual <= stockMinimo

  return (
    <div className={`rounded-2xl border hover:shadow-lg transition-all duration-200 flex flex-col overflow-hidden ${
      agotado
        ? 'bg-red-50/50 border-red-200 hover:border-red-300 hover:shadow-red-100'
        : stockBajo
          ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300 hover:shadow-amber-100'
          : 'bg-white border-slate-200 hover:border-sky-200 hover:shadow-sky-50'
    }`}>

      {/* Imagen — 80px fijo */}
      <div className={`relative w-full h-20 flex items-center justify-center overflow-hidden shrink-0 ${agotado ? 'opacity-50 grayscale' : ''}`}
        style={{ background: producto.imagen_url ? '#f8fafc' : bg }}>
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt={producto.nombre}
            className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package size={28} style={{ color: fg, opacity: 0.7 }} />
        )}
        {agotado && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/40">
            <span className="text-[10px] font-black text-white bg-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">Agotado</span>
          </div>
        )}
        {stockBajo && (
          <div className="absolute top-1 right-1">
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-800 bg-amber-300 px-1.5 py-0.5 rounded-full shadow-sm">
              <AlertTriangle size={8} />Bajo
            </span>
          </div>
        )}
      </div>

      {/* Contenido */}
      <div className={`px-3 pt-2.5 pb-3 flex flex-col gap-2 flex-1 ${agotado ? 'opacity-70' : ''}`}>

        {/* Código + nombre + categoría */}
        <div className="min-h-[48px]">
          {producto.codigo && (
            <div className="flex items-center gap-1 mb-0.5">
              <Hash size={9} className="text-slate-400" />
              <span className="text-[10px] text-slate-400 font-mono truncate">{producto.codigo}</span>
            </div>
          )}
          <h3 className="font-bold text-slate-800 text-xs leading-snug line-clamp-2">{producto.nombre}</h3>
          {producto.categoria && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: bg, color: fg }}>
              <Tag size={8} />{producto.categoria}
            </span>
          )}
        </div>

        {/* Precios y stock */}
        <div className="pt-2 border-t border-slate-100 space-y-1.5 mt-auto">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Precio venta</span>
            <div className="text-right">
              <span className="font-bold text-slate-800 text-xs">{fmtUsd(producto.precio_usd)}</span>
              {tasa > 0 && producto.precio_usd != null && (
                <div className="text-[9px] text-slate-400">{fmtBs(usdToBs(producto.precio_usd, tasa))}</div>
              )}
            </div>
          </div>

          {esSupervisor && producto.costo_usd != null && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">Costo</span>
              <div className="text-right">
                <span className="text-[10px] text-slate-500">{fmtUsd(producto.costo_usd)}</span>
                {tasa > 0 && (
                  <div className="text-[9px] text-slate-400">{fmtBs(usdToBs(producto.costo_usd, tasa))}</div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Layers size={9} className="text-slate-400" />
              <span className="text-[10px] text-slate-400">{producto.unidad}</span>
            </div>
            <BadgeStock actual={producto.stock_actual} minimo={producto.stock_minimo} comprometido={comprometido} productoId={producto.id} />
          </div>
        </div>
      </div>

      {/* Acciones — iconos compactos */}
      {esSupervisor && (
        <div className="border-t border-slate-100 px-1.5 py-1.5 flex items-center justify-between">
          <button onClick={() => onEditar(producto)} title="Editar"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-sky-600 hover:bg-sky-50 transition-colors">
            <Pencil size={11} />Editar
          </button>
          <button onClick={() => onDesactivar(producto)} title="Desactivar"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-amber-500 hover:bg-amber-50 transition-colors">
            <EyeOff size={11} />
          </button>
          <button onClick={() => onBorrar(producto)} title="Borrar"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  )
}
