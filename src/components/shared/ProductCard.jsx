// src/components/shared/ProductCard.jsx
// Tarjeta de producto reutilizable (grid compacto) — usada por VentaRapida y CotizacionBuilder
import { Plus, Minus, Trash2 } from 'lucide-react'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'

/**
 * @param {object} props
 * @param {object} props.producto - Producto del inventario
 * @param {boolean} props.agregado - Si ya está en la cesta
 * @param {number|null} props.cantidad - Cantidad en cesta (si agregado)
 * @param {number} props.tasa - Tasa BCV
 * @param {number} props.comprometido - Stock comprometido
 * @param {function} props.onAgregar - Callback al hacer click (producto no agregado)
 * @param {function} props.onMas - Callback para incrementar cantidad
 * @param {function} props.onMenos - Callback para decrementar cantidad (o eliminar si qty=1)
 * @param {function} props.onCantidadDirecta - Callback para editar cantidad directa (blur)
 */
export default function ProductCard({
  producto: p,
  agregado,
  cantidad,
  tasa = 0,
  comprometido = 0,
  onAgregar,
  onMas,
  onMenos,
  onCantidadDirecta,
}) {
  const stock = Number(p.stock_actual) || 0
  const sinStock = stock <= 0
  const sinPrecio = !p.precio_usd || Number(p.precio_usd) <= 0
  const bloqueado = sinPrecio
  const disponibleReal = stock - comprometido
  const tieneMultiprecios = p.precio_2 != null || p.precio_3 != null

  return (
    <div
      className={`relative bg-white rounded-xl border px-1.5 py-1.5 flex flex-col items-center text-center transition-all active:scale-95 ${
        bloqueado
          ? 'opacity-40 cursor-not-allowed border-slate-100'
          : agregado
            ? 'border-emerald-300 bg-emerald-50/50 shadow-sm shadow-emerald-100/80'
            : disponibleReal <= 0 && comprometido > 0
              ? 'border-amber-300 bg-amber-50/30 shadow-sm shadow-amber-100/80'
              : 'border-slate-200 hover:border-primary/50'
      }`}
      onClick={() => !agregado && !bloqueado && onAgregar?.(p)}
    >
      {agregado && (
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl bg-emerald-400" />
      )}

      {/* Código y Nombre */}
      <div className="w-full mb-1">
        {p.codigo && (
          <div className="flex justify-center mb-0.5">
            <span className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[8px] font-mono font-bold text-slate-500 uppercase tracking-tighter">
              {p.codigo}
            </span>
          </div>
        )}
        <p className={`text-[10px] font-bold leading-tight w-full ${
          agregado ? 'text-emerald-700' : 'text-slate-700'
        }`}>
          {p.nombre}
        </p>
      </div>

      {/* Precio */}
      <p className={`text-[11px] font-black ${agregado ? 'text-emerald-600' : 'text-slate-800'}`}>
        {fmtUsd(p.precio_usd)}
      </p>
      {tieneMultiprecios && (
        <p className="text-[8px] font-bold text-primary/60">
          {[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios
        </p>
      )}
      {tasa > 0 && (
        <p className="text-[8px] text-slate-400 leading-tight">{fmtBs(usdToBs(p.precio_usd, tasa))}</p>
      )}

      {/* Stock badge */}
      <p className={`text-[8px] font-medium mt-0.5 ${
        sinPrecio ? 'text-orange-500' :
        sinStock ? 'text-red-500' :
        disponibleReal <= 0 && comprometido > 0 ? 'text-amber-600' :
        stock <= (p.stock_minimo || 5) ? 'text-amber-500' : 'text-emerald-500'
      }`}>
        {sinPrecio ? 'Sin precio' : sinStock ? 'Agotado' : comprometido > 0 ? `${stock} (${comprometido} comp.)` : `${stock} disp.`}
      </p>

      {/* Stepper inline */}
      {agregado && cantidad != null && (
        <div className="flex items-center gap-0.5 mt-1" onClick={e => e.stopPropagation()}>
          <button type="button"
            onClick={onMenos}
            className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 active:bg-red-100 active:text-red-500 transition-colors">
            {cantidad <= 1 ? <Trash2 size={10} strokeWidth={2.5} /> : <Minus size={11} strokeWidth={3} />}
          </button>
          <input
            key={`qty-${p.id}-${cantidad}`}
            type="text"
            inputMode="numeric"
            defaultValue={cantidad}
            onClick={e => e.target.select()}
            onFocus={e => e.target.select()}
            onBlur={e => {
              const num = Math.max(1, parseInt(e.target.value, 10) || 1)
              onCantidadDirecta?.(num)
            }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            className="w-9 h-6 rounded-md bg-white border border-slate-200 text-center text-[10px] font-black text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none"
          />
          <button type="button"
            onClick={onMas}
            className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center text-emerald-600 active:bg-emerald-100 transition-colors">
            <Plus size={11} strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  )
}
