// src/components/inventario/ProductoCard.jsx
// Tarjeta de producto para el catálogo
// costo_usd solo se muestra si el dato existe (supervisores)
import { Hash, Tag, Layers, Pencil, EyeOff, AlertTriangle, Package } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { fmtBs, usdToBs } from '../../utils/format'

// ─── Formateador de precio ────────────────────────────────────────────────────
function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

// ─── Badge de stock ───────────────────────────────────────────────────────────
function BadgeStock({ actual, minimo }) {
  const bajo = minimo > 0 && actual <= minimo
  if (bajo) return (
    <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
      <AlertTriangle size={11} />
      Stock bajo: {Number(actual).toLocaleString('es-VE')}
    </span>
  )
  return (
    <span className="text-xs text-slate-400">
      Stock: {Number(actual).toLocaleString('es-VE')}
    </span>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ProductoCard({ producto, onEditar, onDesactivar, tasa = 0 }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 hover:border-sky-200 hover:shadow-lg hover:shadow-sky-50 transition-all duration-200 flex flex-col overflow-hidden">

      {/* Imagen del producto */}
      <div className="w-full aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt={producto.nombre}
            className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package size={36} className="text-slate-200" />
        )}
      </div>

      <div className="px-4 pb-4 flex flex-col gap-3 flex-1">
      {/* Cabecera */}
      <div>
        <div className="min-w-0">
          {/* Código */}
          {producto.codigo && (
            <div className="flex items-center gap-1 mb-1">
              <Hash size={11} className="text-slate-400" />
              <span className="text-xs text-slate-400 font-mono">{producto.codigo}</span>
            </div>
          )}
          {/* Nombre */}
          <h3 className="font-bold text-slate-800 text-sm leading-snug line-clamp-2">
            {producto.nombre}
          </h3>
          {/* Categoría */}
          {producto.categoria && (
            <div className="flex items-center gap-1 mt-1">
              <Tag size={11} className="text-slate-400" />
              <span className="text-xs text-slate-500">{producto.categoria}</span>
            </div>
          )}
        </div>
      </div>

      {/* Descripción */}
      {producto.descripcion && (
        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
          {producto.descripcion}
        </p>
      )}

      {/* Precios y stock */}
      <div className="pt-2 border-t border-slate-100 space-y-2">

        {/* Precio de venta */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Precio venta</span>
          <div className="text-right">
            <span className="font-bold text-slate-800 text-sm">{fmtUsd(producto.precio_usd)}</span>
            {tasa > 0 && producto.precio_usd != null && (
              <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(producto.precio_usd, tasa))}</div>
            )}
          </div>
        </div>

        {/* Costo (solo supervisor) */}
        {esSupervisor && producto.costo_usd != null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Costo</span>
            <div className="text-right">
              <span className="text-xs text-slate-500">{fmtUsd(producto.costo_usd)}</span>
              {tasa > 0 && (
                <div className="text-[10px] text-slate-400">{fmtBs(usdToBs(producto.costo_usd, tasa))}</div>
              )}
            </div>
          </div>
        )}

        {/* Unidad + Stock */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Layers size={11} className="text-slate-400" />
            <span className="text-xs text-slate-400">{producto.unidad}</span>
          </div>
          <BadgeStock actual={producto.stock_actual} minimo={producto.stock_minimo} />
        </div>
      </div>
      </div>

      {/* Acciones (solo supervisor, barra inferior) */}
      {esSupervisor && (
        <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1">
          <button onClick={() => onEditar(producto)} title="Editar producto"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} />
            Editar
          </button>
          <button onClick={() => onDesactivar(producto)} title="Desactivar producto"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors ml-auto">
            <EyeOff size={13} />
            Desactivar
          </button>
        </div>
      )}
    </div>
  )
}
