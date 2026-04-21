// src/components/ui/VendedorFilterPill.jsx
// Dropdown compacto para filtrar por vendedor — estilo pill profesional
import { useState, useEffect, useRef } from 'react'
import { Users, ChevronDown, Check, X } from 'lucide-react'

export default function VendedorFilterPill({ vendedores = [], value, onChange }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)

  const seleccionado = vendedores.find(v => v.id === value)
  const activo = !!value

  // Cerrar al click fuera
  useEffect(() => {
    if (!abierto) return
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [abierto])

  function elegir(id) {
    onChange(id)
    setAbierto(false)
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className={`flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all border whitespace-nowrap ${
          activo
            ? 'bg-primary text-white border-primary shadow-sm'
            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
        }`}
      >
        {seleccionado?.color && (
          <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/50" style={{ background: seleccionado.color }} />
        )}
        {!seleccionado && <Users size={13} className={activo ? 'text-white' : 'text-slate-400'} />}
        <span className="max-w-[100px] truncate">{seleccionado ? seleccionado.nombre : 'Vendedor'}</span>
        {activo ? (
          <span
            onClick={e => { e.stopPropagation(); onChange(''); setAbierto(false) }}
            className="p-0.5 rounded-full hover:bg-white/20 transition-colors cursor-pointer"
          >
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={13} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
        )}
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute z-50 top-full left-0 mt-2 min-w-[200px] bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Filtrar por vendedor</p>
          </div>

          {/* Opción "Todos" */}
          <button
            type="button"
            onClick={() => elegir('')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
              !value ? 'bg-primary/5 text-primary font-semibold' : 'hover:bg-slate-50 text-slate-600'
            }`}
          >
            <Users size={14} className={!value ? 'text-primary' : 'text-slate-400'} />
            <span className="flex-1">Todos los vendedores</span>
            {!value && <Check size={14} className="text-primary shrink-0" />}
          </button>

          <div className="border-t border-slate-100" />

          {/* Lista de vendedores */}
          <div className="max-h-48 overflow-y-auto py-1">
            {vendedores.map(v => {
              const isSelected = v.id === value
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => elegir(v.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                    isSelected ? 'bg-primary/5 text-primary font-semibold' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 ring-2 ring-offset-1"
                    style={{
                      background: v.color || '#94a3b8',
                      ringColor: isSelected ? 'var(--color-primary)' : 'transparent',
                    }}
                  />
                  <span className="flex-1 truncate">{v.nombre}</span>
                  {v.rol && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      v.rol === 'supervisor' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {v.rol === 'supervisor' ? 'Sup.' : 'Vend.'}
                    </span>
                  )}
                  {isSelected && <Check size={14} className="text-primary shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
