// src/components/ui/CustomSelect.jsx
// Selector personalizado con búsqueda — reemplaza el <select> nativo
import { useState, useEffect, useRef } from 'react'
import { Search, ChevronDown, X, Check, Plus } from 'lucide-react'

/**
 * @param {object} props
 * @param {Array<{value: string, label: string, sub?: string, icon?: React.ComponentType}>} props.options
 * @param {string} props.value - valor seleccionado
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder] - texto cuando no hay selección
 * @param {boolean} [props.searchable] - mostrar buscador (default: true si >5 opciones)
 * @param {boolean} [props.clearable] - permitir limpiar (default: false)
 * @param {boolean} [props.creatable] - permitir crear nuevas opciones escribiendo (default: false)
 * @param {string} [props.createLabel] - texto para la opción de crear (default: 'Crear')
 * @param {boolean} [props.disabled]
 * @param {React.ComponentType} [props.icon] - icono del trigger
 */
export default function CustomSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Seleccionar...',
  searchable,
  clearable = false,
  creatable = false,
  createLabel = 'Crear',
  disabled = false,
  icon: TriggerIcon,
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const ref = useRef(null)

  const showSearch = searchable ?? (creatable || options.length > 5)

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    if (abierto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [abierto])

  const seleccionada = options.find(o => o.value === value)
  // Si el valor actual no está en options (fue creado), mostrarlo como seleccionado
  const seleccionadaLabel = seleccionada ? seleccionada.label : (creatable && value ? value : null)
  const filtradas = busqueda.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(busqueda.toLowerCase()) ||
        (o.sub ?? '').toLowerCase().includes(busqueda.toLowerCase())
      )
    : options

  // Mostrar opción "Crear" cuando hay texto que no coincide exactamente
  const puedeCrear = creatable && busqueda.trim() &&
    !options.some(o => o.label.toLowerCase() === busqueda.trim().toLowerCase())

  function elegir(val) {
    onChange(val)
    setAbierto(false)
    setBusqueda('')
  }

  function limpiar(e) {
    e.stopPropagation()
    onChange('')
    setBusqueda('')
  }

  function toggle() {
    if (disabled) return
    setAbierto(!abierto)
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left transition-all text-sm ${
          disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200' :
          abierto
            ? 'border-primary ring-2 ring-primary-focus bg-white'
            : seleccionada
              ? 'border-slate-200 bg-white hover:border-slate-300'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        {TriggerIcon && (
          <TriggerIcon size={15} className={seleccionadaLabel ? 'text-primary shrink-0' : 'text-slate-400 shrink-0'} />
        )}
        <span className={`flex-1 truncate ${seleccionadaLabel ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
          {seleccionadaLabel || placeholder}
        </span>
        {seleccionada?.sub && (
          <span className="text-xs text-slate-400 truncate max-w-[120px] hidden sm:inline">{seleccionada.sub}</span>
        )}
        {clearable && seleccionadaLabel && !disabled && (
          <button type="button" onClick={limpiar}
            className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
            <X size={13} />
          </button>
        )}
        <ChevronDown size={15} className={`text-slate-400 transition-transform shrink-0 ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Buscador */}
          {showSearch && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="max-h-52 overflow-y-auto py-1">
            {filtradas.length === 0 && !puedeCrear ? (
              <p className="text-sm text-slate-400 text-center py-4">
                {busqueda ? 'Sin resultados' : 'Sin opciones'}
              </p>
            ) : (
              <>
                {filtradas.map(opt => {
                  const isSelected = opt.value === value
                  const OptIcon = opt.icon
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => elegir(opt.value)}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary-light/40 text-primary font-medium'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {OptIcon && <OptIcon size={14} className={isSelected ? 'text-primary shrink-0' : 'text-slate-400 shrink-0'} />}
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.sub && <span className="text-xs text-slate-400 truncate max-w-[140px]">{opt.sub}</span>}
                      {isSelected && <Check size={14} className="text-primary shrink-0" />}
                    </button>
                  )
                })}
                {puedeCrear && (
                  <button
                    type="button"
                    onClick={() => elegir(busqueda.trim())}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-emerald-50 text-emerald-700 border-t border-slate-100"
                  >
                    <Plus size={14} className="text-emerald-500 shrink-0" />
                    <span className="flex-1 truncate">{createLabel} "<span className="font-bold">{busqueda.trim()}</span>"</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
