// src/components/inventario/ProductoRow.jsx
// Fila compacta de producto para vista de lista
import { Hash, Tag, Layers, Pencil, EyeOff, AlertTriangle, Package, Trash2 } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { fmtBs, usdToBs } from '../../utils/format'

function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

// Mismo hash determinista que ProductoCard
const PALETA = [
  ['#1e40af','#dbeafe'], ['#065f46','#d1fae5'], ['#92400e','#fef3c7'],
  ['#7c3aed','#ede9fe'], ['#be185d','#fce7f3'], ['#0f766e','#ccfbf1'],
  ['#b45309','#fef9c3'], ['#1d4ed8','#eff6ff'], ['#166534','#dcfce7'],
]
function colorCategoria(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff
  const [fg] = PALETA[h % PALETA.length]
  return fg
}

export default function ProductoRow({ producto, onEditar, onDesactivar, onBorrar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const stockBajo = producto.stock_minimo > 0 && producto.stock_actual <= producto.stock_minimo
  const catColor = colorCategoria(producto.categoria || '')

  return (
    <div className="bg-white rounded-xl border hover:shadow-md transition-all overflow-hidden flex items-stretch"
      style={{ borderColor: catColor + '30' }}>

      {/* Barra lateral de color de categoría */}
      <div className="w-1 shrink-0" style={{ background: catColor }} />

      {/* Thumbnail */}
      <div className="w-10 h-10 my-auto ml-3 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
        style={{ background: catColor + '15' }}>
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package size={16} style={{ color: catColor, opacity: 0.7 }} />
        )}
      </div>

      {/* Info principal */}
      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-800 text-sm truncate">{producto.nombre}</h3>
          {producto.codigo && (
            <span className="flex items-center gap-1 text-xs text-slate-400 font-mono">
              <Hash size={10} />{producto.codigo}
            </span>
          )}
          {producto.categoria && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: catColor + '15', color: catColor }}>
              <Tag size={9} />{producto.categoria}
            </span>
          )}
        </div>
        {producto.descripcion && (
          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[300px]">{producto.descripcion}</p>
        )}
      </div>

      {/* Precio + Stock */}
      <div className="hidden sm:flex items-center gap-4 pr-3 shrink-0">
        <div className="text-right">
          <div>
            <span className="font-bold text-slate-800 text-sm">{fmtUsd(producto.precio_usd)}</span>
            {esSupervisor && producto.costo_usd != null && (
              <span className="text-xs text-slate-400 ml-2">C: {fmtUsd(producto.costo_usd)}</span>
            )}
          </div>
          {tasa > 0 && producto.precio_usd != null && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(producto.precio_usd, tasa))}</div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Layers size={11} className="text-slate-400" />
          <span className="text-xs text-slate-400">{producto.unidad}</span>
        </div>

        {stockBajo ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
            <AlertTriangle size={11} />
            Stock bajo: {Number(producto.stock_actual).toLocaleString('es-VE')}
          </span>
        ) : (
          <span className="text-xs text-slate-400">
            Stock: {Number(producto.stock_actual).toLocaleString('es-VE')}
          </span>
        )}
      </div>

      {/* Acciones (solo supervisor) */}
      {esSupervisor && (
        <div className="flex items-center gap-1 px-2 shrink-0">
          <button onClick={() => onEditar(producto)} title="Editar producto"
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
            <Pencil size={15} />
          </button>
          <button onClick={() => onDesactivar(producto)} title="Desactivar producto"
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
            <EyeOff size={15} />
          </button>
          <button onClick={() => onBorrar(producto)} title="Borrar producto"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
