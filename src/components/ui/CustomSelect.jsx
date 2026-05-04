// src/components/ui/CustomSelect.jsx
// Selector personalizado con búsqueda — reemplaza el <select> nativo
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, ChevronDown, X, Check, Plus } from 'lucide-react'

/** Normaliza texto: quita acentos y pasa a minúsculas */
function normalizar(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Búsqueda inteligente: soporta acentos, inicio de palabra, y typos básicos */
function matchScore(texto, query) {
  const t = normalizar(texto)
  const q = normalizar(query)

  // Coincidencia exacta al inicio → máxima prioridad
  if (t.startsWith(q)) return 3
  // Coincidencia al inicio de alguna palabra
  if (t.split(/\s+/).some(w => w.startsWith(q))) return 2
  // Contiene la query
  if (t.includes(q)) return 1
  // Coincidencia por iniciales (ej: "dc" → "Distrito Capital")
  if (q.length >= 2) {
    const iniciales = t.split(/\s+/).map(w => w[0]).join('')
    if (iniciales.includes(q)) return 1
  }
  return 0
}

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
  const [openUp, setOpenUp] = useState(false)
  const ref = useRef(null)
  const searchRef = useRef(null)

  const showSearch = searchable ?? (creatable || options.length > 5)

  // Cerrar al hacer click/touch fuera
  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    if (abierto) {
      document.addEventListener('mousedown', handleOutside)
      document.addEventListener('touchstart', handleOutside, { passive: true })
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [abierto])

  // Calcular dirección del dropdown
  useEffect(() => {
    if (!abierto || !ref.current) return

    const rect = ref.current.getBoundingClientRect()
    const viewH = window.visualViewport?.height || window.innerHeight
    const spaceBelow = viewH - rect.bottom
    const isMobile = window.innerWidth < 768
    
    // Solución B: En móviles, forzamos abrir siempre hacia arriba para evitar
    // choques con el borde inferior del modal y el teclado.
    // En PC, usamos el cálculo de espacio dinámico.
    if (isMobile) {
      setOpenUp(true)
    } else {
      setOpenUp(spaceBelow < 220)
    }

    // Focus search input (sin scrollIntoView para evitar bugs de touch en Android)
    if (showSearch && searchRef.current) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [abierto, showSearch])

  const seleccionada = options.find(o => o.value === value)
  // Si el valor actual no está en options (fue creado), mostrarlo como seleccionado
  const seleccionadaLabel = seleccionada ? seleccionada.label : (creatable && value ? value : null)
  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return options
    const q = busqueda.trim()
    return options
      .map(o => ({ ...o, _score: Math.max(matchScore(o.label, q), matchScore(o.sub ?? '', q)) }))
      .filter(o => o._score > 0)
      .sort((a, b) => b._score - a._score)
  }, [options, busqueda])

  // Mostrar opción "Crear" cuando hay texto que no coincide exactamente
  const puedeCrear = creatable && busqueda.trim() &&
    !options.some(o => normalizar(o.label) === normalizar(busqueda.trim()))

  function elegir(val) {
    onChange(val)
    setBusqueda('')
    setAbierto(false)
  }

  function limpiar(e) {
    e.stopPropagation()
    onChange('')
    setBusqueda('')
  }

  function toggle() {
    if (disabled) return
    setAbierto(!abierto)
    if (abierto) setBusqueda('')
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
            ? 'border-primary ring-1 ring-primary/30 bg-white'
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
          <div role="button" tabIndex={0} onClick={limpiar}
            className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
            <X size={13} />
          </div>
        )}
        <ChevronDown size={15} className={`text-slate-400 transition-transform shrink-0 ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className={`absolute z-50 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden ${
          openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
        }`}>
          {/* Buscador */}
          {showSearch && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                />
              </div>
            </div>
          )}

          {/* Lista */}
          <div className="max-h-52 overflow-y-auto py-1 overscroll-contain">
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
