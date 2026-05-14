// src/components/inventario/ProductoCard.jsx
import { Hash, Tag, Layers, Pencil, EyeOff, AlertTriangle, Package, Trash2, ClipboardList, TrendingUp, Eye } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { fmtBs, usdToBs } from '../../utils/format'
import StockComprometidoDetalle from './StockComprometidoDetalle'

function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

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

function StockBadge({ actual, minimo, comprometido = 0, productoId }) {
  const agotado = actual <= 0
  const bajo = !agotado && minimo > 0 && actual <= minimo
  const disponible = actual - comprometido
  const sobrecomprometido = comprometido > 0 && disponible < 0

  if (agotado) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 border border-red-300 px-2.5 py-1 rounded-lg">
      Sin stock
    </span>
  )

  const cls = sobrecomprometido
    ? 'text-red-700 bg-red-100 border-red-300'
    : bajo
      ? 'text-amber-700 bg-amber-100 border-amber-300'
      : 'text-emerald-700 bg-emerald-100 border-emerald-300'

  return (
    <div className="text-right space-y-0.5">
      <span className={`inline-flex items-center gap-1 text-xs font-bold border px-2.5 py-1 rounded-lg ${cls}`}>
        {(sobrecomprometido || bajo) && <AlertTriangle size={10} />}
        {Number(actual).toLocaleString('es-VE')}
      </span>
      {comprometido > 0 && (
        <div>
          <StockComprometidoDetalle productoId={productoId} comprometido={comprometido} />
          {sobrecomprometido && (
            <div className="text-[10px] text-red-600 font-semibold mt-0.5">
              Disponible: {Number(disponible).toLocaleString('es-VE')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProductoCard({ producto, onEditar, onDesactivar, onBorrar, onKardex, onDetalle, tasa = 0, comprometido = 0 }) {
  const { perfil } = useAuthStore()
  const esAdministracion = perfil?.rol === 'administracion'
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || esAdministracion
  const { fg, bg } = colorCategoria(producto.categoria || '')

  const stockActual = Number(producto.stock_actual) || 0
  const stockMinimo = Number(producto.stock_minimo) || 0
  const agotado = stockActual <= 0
  const stockBajo = !agotado && stockMinimo > 0 && stockActual <= stockMinimo

  const precio = Number(producto.precio_usd)
  const costo = Number(producto.costo_usd)
  const margen = esPrivilegiado && precio > 0 && costo > 0
    ? Math.round(((precio - costo) / precio) * 100)
    : null

  return (
    <div className={`rounded-2xl border hover:shadow-lg transition-all duration-200 flex flex-col overflow-hidden ${
      agotado
        ? 'bg-red-50/50 border-red-200 hover:border-red-300 hover:shadow-red-100'
        : stockBajo
          ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300 hover:shadow-amber-100'
          : 'bg-white border-slate-200 hover:border-sky-200 hover:shadow-sky-50'
    }`}>

      {/* Imagen */}
      <div className={`relative w-full h-16 sm:h-20 flex items-center justify-center overflow-hidden shrink-0 ${agotado ? 'opacity-50 grayscale' : ''}`}
        style={{ background: producto.imagen_url ? '#f8fafc' : bg }}>
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt={producto.nombre}
            className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package size={24} style={{ color: fg, opacity: 0.7 }} />
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
      <div className={`px-2.5 pt-2 pb-2.5 flex flex-col gap-2 flex-1 ${agotado ? 'opacity-70' : ''}`}>

        {/* Encabezado: código, unidad, nombre, categoría */}
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            {producto.codigo && (
              <div className="flex items-center gap-1 min-w-0">
                <span className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[8px] font-mono font-bold text-slate-500 uppercase tracking-tighter">
                  {producto.codigo}
                </span>
              </div>
            )}
            {producto.unidad && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0 ml-auto">
                <Layers size={7} />{producto.unidad}
              </span>
            )}
          </div>
          <h3 className="font-bold text-slate-800 text-[11px] sm:text-xs leading-snug uppercase">{producto.nombre}</h3>
          {producto.categoria && (
            <span className="inline-flex items-center gap-0.5 mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full max-w-full"
              style={{ background: bg, color: fg }}>
              <Tag size={7} /><span className="truncate">{producto.categoria}</span>
            </span>
          )}
        </div>

        {/* Bloque de precios y stock */}
        <div className="mt-auto space-y-1.5 pt-2 border-t border-slate-100">

          {/* Precio venta — bloque destacado */}
          <div className="rounded-xl bg-slate-50 px-2.5 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Precio venta</span>
              {margen !== null && (
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  margen >= 30 ? 'text-emerald-700 bg-emerald-100' :
                  margen >= 15 ? 'text-amber-700 bg-amber-100' :
                  'text-red-700 bg-red-100'
                }`}>
                  <TrendingUp size={8} />+{margen}%
                </span>
              )}
            </div>

            {/* P1 — precio principal */}
            <div className="flex items-baseline gap-1.5">
              {(producto.precio_2 != null || producto.precio_3 != null) && (
                <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">Detal</span>
              )}
              <p className="font-black text-slate-800 text-base sm:text-lg leading-none">{fmtUsd(producto.precio_usd)}</p>
            </div>
            {tasa > 0 && producto.precio_usd != null && (
              <p className="text-[10px] text-slate-400 mt-0.5">{fmtBs(usdToBs(producto.precio_usd, tasa))}</p>
            )}

            {/* P2 / P3 — precios secundarios */}
            {(producto.precio_2 != null || producto.precio_3 != null) && (
              <div className="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-slate-200">
                {producto.precio_2 != null && (
                  <div className="flex flex-col bg-white border border-slate-200 rounded-lg px-2 py-1 min-w-0">
                    <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wide">Mayor</span>
                    <span className="text-[11px] font-bold text-slate-700 leading-tight">{fmtUsd(producto.precio_2)}</span>
                    {tasa > 0 && <span className="text-[9px] text-slate-400 leading-none">{fmtBs(usdToBs(producto.precio_2, tasa))}</span>}
                  </div>
                )}
                {producto.precio_3 != null && (
                  <div className="flex flex-col bg-white border border-slate-200 rounded-lg px-2 py-1 min-w-0">
                    <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wide">Especial</span>
                    <span className="text-[11px] font-bold text-slate-700 leading-tight">{fmtUsd(producto.precio_3)}</span>
                    {tasa > 0 && <span className="text-[9px] text-slate-400 leading-none">{fmtBs(usdToBs(producto.precio_3, tasa))}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Costo — fila secundaria */}
          {esPrivilegiado && producto.costo_usd != null && (
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-slate-400">Costo</span>
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-600">{fmtUsd(producto.costo_usd)}</p>
                {tasa > 0 && (
                  <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(producto.costo_usd, tasa))}</p>
                )}
              </div>
            </div>
          )}

          {/* Stock */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] text-slate-400">Stock</span>
            <StockBadge
              actual={producto.stock_actual}
              minimo={producto.stock_minimo}
              comprometido={comprometido}
              productoId={producto.id}
            />
          </div>

        </div>
      </div>

      {/* Acciones */}
      <div className="border-t border-slate-100 px-2 py-1.5 flex flex-wrap items-center gap-1">
        <button onClick={() => onDetalle?.(producto)} title="Ver detalle"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-200 whitespace-nowrap shrink-0">
          <Eye size={14} /> Ver detalle
        </button>
        {esPrivilegiado && (
          <>
            <button onClick={() => onKardex(producto)} title="Kardex"
              className="flex items-center justify-center p-1.5 rounded-lg text-violet-600 hover:bg-violet-50 transition-colors shrink-0">
              <ClipboardList size={13} />
            </button>
            {esAdministracion && (
              <>
                <button onClick={() => onEditar(producto)} title="Editar"
                  className="flex items-center justify-center p-1.5 rounded-lg text-sky-600 hover:bg-sky-50 transition-colors shrink-0">
                  <Pencil size={13} />
                </button>
                <button onClick={() => onDesactivar(producto)} title="Desactivar"
                  className="flex items-center justify-center p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 transition-colors shrink-0">
                  <EyeOff size={13} />
                </button>
                <button onClick={() => onBorrar(producto)} title="Borrar"
                  className="flex items-center justify-center p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors shrink-0">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
