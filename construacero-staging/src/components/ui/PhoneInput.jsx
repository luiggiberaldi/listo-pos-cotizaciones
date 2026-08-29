// src/components/ui/PhoneInput.jsx
import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

// Función para convertir código ISO a emoji bandera
const toFlag = (iso) => iso.toUpperCase().replace(/./g, 
  c => String.fromCodePoint(c.charCodeAt(0) + 127397));

const COUNTRIES = [
  // Frecuentes
  { code: 'VE', prefix: '+58', label: 'Venezuela', placeholder: '412 123 4567', mask: '### ### ####', frequent: true },
  { code: 'CO', prefix: '+57', label: 'Colombia', placeholder: '310 123 4567', mask: '### ### ####', frequent: true },
  { code: 'PA', prefix: '+507', label: 'Panamá', placeholder: '6000 1234', mask: '#### ####', frequent: true },
  { code: 'US', prefix: '+1', label: 'Estados Unidos', placeholder: '202 555 0123', mask: '### ### ####', frequent: true },
  { code: 'ES', prefix: '+34', label: 'España', placeholder: '612 345 678', mask: '### ### ###', frequent: true },
  { code: 'CL', prefix: '+56', label: 'Chile', placeholder: '9 1234 5678', mask: '# #### ####', frequent: true },
  // Otros
  { code: 'AR', prefix: '+54', label: 'Argentina', placeholder: 'Cod + Número', frequent: false },
  { code: 'BO', prefix: '+591', label: 'Bolivia', placeholder: 'Cod + Número', frequent: false },
  { code: 'BR', prefix: '+55', label: 'Brasil', placeholder: 'Cod + Número', frequent: false },
  { code: 'CR', prefix: '+506', label: 'Costa Rica', placeholder: 'Cod + Número', frequent: false },
  { code: 'CU', prefix: '+53', label: 'Cuba', placeholder: 'Cod + Número', frequent: false },
  { code: 'EC', prefix: '+593', label: 'Ecuador', placeholder: 'Cod + Número', frequent: false },
  { code: 'SV', prefix: '+503', label: 'El Salvador', placeholder: 'Cod + Número', frequent: false },
  { code: 'GT', prefix: '+502', label: 'Guatemala', placeholder: 'Cod + Número', frequent: false },
  { code: 'HN', prefix: '+504', label: 'Honduras', placeholder: 'Cod + Número', frequent: false },
  { code: 'MX', prefix: '+52', label: 'México', placeholder: 'Cod + Número', frequent: false },
  { code: 'NI', prefix: '+505', label: 'Nicaragua', placeholder: 'Cod + Número', frequent: false },
  { code: 'PY', prefix: '+595', label: 'Paraguay', placeholder: 'Cod + Número', frequent: false },
  { code: 'PE', prefix: '+51', label: 'Perú', placeholder: 'Cod + Número', frequent: false },
  { code: 'DO', prefix: '+1-809', label: 'Rep. Dominicana', placeholder: 'Cod + Número', frequent: false },
  { code: 'UY', prefix: '+598', label: 'Uruguay', placeholder: 'Cod + Número', frequent: false },
].sort((a, b) => {
  if (a.frequent && !b.frequent) return -1
  if (!a.frequent && b.frequent) return 1
  return a.label.localeCompare(b.label)
})

function applyMask(val, mask) {
  if (!val) return ''
  let clean = val.replace(/\D/g, '')
  if (!mask) return clean.slice(0, 15) // Límite genérico internacional
  
  let result = ''
  let cleanIdx = 0
  for (let i = 0; i < mask.length && cleanIdx < clean.length; i++) {
    if (mask[i] === '#') {
      result += clean[cleanIdx++]
    } else {
      result += mask[i]
    }
  }
  return result
}

export default function PhoneInput({ value = '', onChange, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Parse initial value
  const parseValue = (val) => {
    if (!val) return { prefix: '+58', number: '' }
    if (!val.startsWith('+')) return { prefix: '+58', number: val }
    
    const sortedCountries = [...COUNTRIES].sort((a, b) => b.prefix.length - a.prefix.length)
    const country = sortedCountries.find(c => val.startsWith(c.prefix))
    
    if (country) {
      return { prefix: country.prefix, number: val.slice(country.prefix.length) }
    }
    return { prefix: '+58', number: val }
  }

  const initial = useMemo(() => parseValue(value), [value])
  const [prefix, setPrefix] = useState(initial.prefix)
  const [number, setNumber] = useState(initial.number)

  useEffect(() => {
    const { prefix: p, number: n } = parseValue(value)
    setPrefix(p)
    const country = COUNTRIES.find(c => c.prefix === p)
    setNumber(applyMask(n, country?.mask))
  }, [value])

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const currentCountry = COUNTRIES.find(c => c.prefix === prefix) || COUNTRIES[0]

  const handleNumberChange = (e) => {
    let val = e.target.value.replace(/\D/g, '') // Solo dígitos
    if (prefix === '+58' && val.startsWith('0')) {
      val = val.slice(1)
    }
    
    // Aplicar máscara para la vista
    const formatted = applyMask(val, currentCountry.mask)
    setNumber(formatted)
    
    // Extraer solo dígitos para mandar al padre (limitado a la máscara)
    const rawDigits = formatted.replace(/\D/g, '')
    onChange(`${prefix}${rawDigits}`)
  }

  const selectCountry = (country) => {
    const newPrefix = country.prefix
    setPrefix(newPrefix)
    setIsOpen(false)
    
    let val = number.replace(/\D/g, '')
    if (newPrefix === '+58' && val.startsWith('0')) {
      val = val.slice(1)
    }
    
    const formatted = applyMask(val, country.mask)
    setNumber(formatted)
    
    const rawDigits = formatted.replace(/\D/g, '')
    onChange(`${newPrefix}${rawDigits}`)
  }

  return (
    <div className="relative w-full">
      <div className={`flex items-center w-full bg-white border rounded-xl transition-all duration-200 focus-within:ring-2 focus-within:ring-primary-focus focus-within:border-primary ${disabled ? 'opacity-50 grayscale-[0.5]' : 'border-slate-200'}`}>
        
        {/* Selector de país Custom */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(prev => !prev)}
            disabled={disabled}
            className="flex items-center gap-2 px-3 h-[42px] min-w-[90px] bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 transition-colors whitespace-nowrap rounded-l-[11px]"
          >
            <span className="text-lg">{toFlag(currentCountry.code)}</span>
            <span>{currentCountry.prefix}</span>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOpen && (
            <ul 
              className="absolute top-full left-0 mt-2 w-[calc(100vw-2rem)] max-w-[320px] sm:w-72 max-h-[280px] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 scrollbar-thin scrollbar-thumb-slate-200"
              style={{ zIndex: 9999 }}
            >
              <li className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Frecuentes</li>
              {COUNTRIES.filter(c => c.frequent).map(c => (
                <li
                  key={c.code}
                  onClick={() => selectCountry(c)}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer transition-colors ${prefix === c.prefix ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="text-base w-6 text-center">{toFlag(c.code)}</span>
                  <span className="flex-1">{c.label}</span>
                  <span className="text-slate-500 font-medium">{c.prefix}</span>
                  {prefix === c.prefix && <span className="text-primary mr-1">✓</span>}
                </li>
              ))}
              
              <li className="h-px bg-slate-100 my-1.5 mx-3" />
              <li className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Otros</li>
              
              {COUNTRIES.filter(c => !c.frequent).map(c => (
                <li
                  key={c.code}
                  onClick={() => selectCountry(c)}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer transition-colors ${prefix === c.prefix ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="text-base w-6 text-center">{toFlag(c.code)}</span>
                  <span className="flex-1">{c.label}</span>
                  <span className="text-slate-500 font-medium">{c.prefix}</span>
                  {prefix === c.prefix && <span className="text-primary mr-1">✓</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Separador visual */}
        <div className="w-px h-6 bg-slate-200 shrink-0" />

        {/* Input de número */}
        <input
          type="text"
          inputMode="numeric"
          value={number}
          onChange={handleNumberChange}
          disabled={disabled}
          placeholder={currentCountry.placeholder}
          className="flex-1 px-4 h-[42px] bg-transparent text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none disabled:cursor-not-allowed rounded-r-[11px]"
        />
      </div>
    </div>
  )
}
