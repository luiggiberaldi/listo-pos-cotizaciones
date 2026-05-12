// src/components/inventario/ProductoDetalleModal.jsx
// Modal de ficha de producto — optimizado para captura de pantalla y envío a clientes
import { X, Share2, Package } from 'lucide-react'
import { fmtBs, usdToBs } from '../../utils/format'

function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ProductoDetalleModal({ isOpen, onClose, producto, tasa = 0 }) {
  if (!isOpen || !producto) return null

  const stockActual = Number(producto.stock_actual) || 0
  const disponible = stockActual > 0

  async function handleShare() {
    const texto = [
      `📦 ${producto.nombre}`,
      producto.codigo ? `Código: ${producto.codigo}` : '',
      `Precio: ${fmtUsd(producto.precio_usd)}`,
      tasa > 0 ? `Precio Bs: ${fmtBs(usdToBs(producto.precio_usd, tasa))}` : '',
      producto.precio_2 != null ? `Precio Mayor: ${fmtUsd(producto.precio_2)}` : '',
      producto.precio_3 != null ? `Precio Especial: ${fmtUsd(producto.precio_3)}` : '',
      disponible ? `✅ Disponible` : `❌ Agotado`,
      '',
      '🏗️ Construacero Carabobo',
    ].filter(Boolean).join('\n')

    if (navigator.share) {
      try {
        await navigator.share({ text: texto })
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(texto)
      alert('Texto copiado al portapapeles')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-sm sm:mx-4 bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header con botones */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <button onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-colors">
            <Share2 size={14} /> Compartir
          </button>
          <button onClick={onClose}
            className="p-2 rounded-xl bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Contenido — diseñado para screenshot limpio */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 pt-5 pb-6 space-y-5">

            {/* Logo */}
            <div className="flex justify-center">
              <img src="/logo.png" alt="Construacero Carabobo" className="h-12 w-auto object-contain" />
            </div>

            {/* Imagen del producto */}
            <div className="w-full aspect-square max-h-64 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 flex items-center justify-center">
              {producto.imagen_url ? (
                <img src={producto.imagen_url} alt={producto.nombre}
                  className="w-full h-full object-contain" />
              ) : (
                <Package size={64} className="text-slate-200" />
              )}
            </div>

            {/* Info del producto */}
            <div className="space-y-1 text-center">
              <h2 className="text-lg font-black text-slate-800 leading-tight">{producto.nombre}</h2>
              {producto.codigo && (
                <p className="text-xs text-slate-400 font-mono">Código: {producto.codigo}</p>
              )}
              {producto.categoria && (
                <p className="text-xs text-slate-500">{producto.categoria}</p>
              )}
            </div>

            {/* Precios */}
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
              {/* Precio principal */}
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  {producto.precio_2 != null ? 'Precio Detal' : 'Precio'}
                </p>
                <p className="text-3xl font-black text-slate-800">{fmtUsd(producto.precio_usd)}</p>
                {tasa > 0 && producto.precio_usd != null && (
                  <p className="text-sm text-slate-500 font-semibold mt-0.5">{fmtBs(usdToBs(producto.precio_usd, tasa))}</p>
                )}
              </div>

              {/* Precios secundarios */}
              {(producto.precio_2 != null || producto.precio_3 != null) && (
                <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-200">
                  {producto.precio_2 != null && (
                    <div className="text-center bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Mayor</p>
                      <p className="text-base font-black text-slate-700">{fmtUsd(producto.precio_2)}</p>
                      {tasa > 0 && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(usdToBs(producto.precio_2, tasa))}</p>
                      )}
                    </div>
                  )}
                  {producto.precio_3 != null && (
                    <div className="text-center bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Especial</p>
                      <p className="text-base font-black text-slate-700">{fmtUsd(producto.precio_3)}</p>
                      {tasa > 0 && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(usdToBs(producto.precio_3, tasa))}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Disponibilidad */}
            <div className="flex items-center justify-center">
              <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold ${
                disponible
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {disponible ? '✅ Disponible' : '❌ Agotado'}
              </span>
            </div>

            {/* Unidad */}
            {producto.unidad && (
              <p className="text-center text-xs text-slate-400">
                Unidad de medida: <span className="font-semibold text-slate-600">{producto.unidad}</span>
              </p>
            )}

            {/* Footer branding */}
            <div className="text-center pt-3 border-t border-slate-100">
              <p className="text-[11px] font-bold text-slate-400">Construacero Carabobo</p>
              <p className="text-[10px] text-slate-300">Materiales de construcción</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
