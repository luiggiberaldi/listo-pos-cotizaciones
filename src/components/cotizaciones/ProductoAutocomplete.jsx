// src/components/cotizaciones/ProductoAutocomplete.jsx
// Autocomplete dropdown para búsqueda rápida de productos
import { useState, useRef, useEffect } from 'react'
import { Search, Plus, Package, X } from 'lucide-react'
import { parseSearchTerms, smartMatchProducto } from '../../utils/smartSearch'

export default function ProductoAutocomplete({ productos = [], onAgregar, idsAgregados = new Set(), placeholder = 'Búsqueda rápida por nombre o código...', stockComprometido = {} }) {
  const [texto, setTexto] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setFocused(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const sugerencias = texto.trim().length >= 2
    ? (() => {
        const terms = parseSearchTerms(texto)
        return productos.filter(p => smartMatchProducto(p, terms)).slice(0, 8)
      })()
    : []

  const showDropdown = focused && sugerencias.length > 0

  function seleccionar(p) {
    onAgregar(p)
    setTexto('')
    inputRef.current?.focus()
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-slate-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400 transition-all"
        />
        {texto && (
          <button type="button" onClick={() => setTexto('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/60 overflow-hidden max-h-80 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
          {sugerencias.map(p => {
            const yaAgregado = idsAgregados.has(p.id)
            const sinStock = p.stock_actual != null && p.stock_actual <= 0
            const sinPrecio = !p.precio_usd || Number(p.precio_usd) <= 0
            const bloqueado = sinStock || sinPrecio
            const comprometido = stockComprometido[p.id] || 0
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !bloqueado && seleccionar(p)}
                disabled={bloqueado}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-slate-50 last:border-0 ${
                  bloqueado ? 'opacity-40 cursor-not-allowed' :
                  yaAgregado ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${yaAgregado ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                  {p.imagen_url
                    ? <img src={p.imagen_url} alt="" className="h-full w-full object-contain rounded-lg" />
                    : <Package size={14} className={yaAgregado ? 'text-emerald-400' : 'text-slate-300'} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{p.nombre}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.codigo && <span className="text-[10px] text-slate-400 font-mono">{p.codigo}</span>}
                    <span className={`text-[10px] font-bold ${
                      sinStock ? 'text-red-500' :
                      comprometido > 0 && (p.stock_actual - comprometido) <= 0 ? 'text-amber-600' :
                      (p.stock_actual <= (p.stock_minimo || 5)) ? 'text-amber-500' : 'text-emerald-500'
                    }`}>
                      {sinStock ? 'Agotado' : comprometido > 0 ? `Stock: ${p.stock_actual} (${comprometido} comp.)` : `Stock: ${p.stock_actual}`}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-800">${Number(p.precio_usd || 0).toFixed(2)}</p>
                  {(p.precio_2 != null || p.precio_3 != null) && (
                    <p className="text-[9px] font-bold text-primary/60">{[p.precio_2 != null && 'P2', p.precio_3 != null && 'P3'].filter(Boolean).length + 1} precios</p>
                  )}
                </div>
                {!bloqueado && !yaAgregado && (
                  <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Plus size={14} className="text-primary" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
