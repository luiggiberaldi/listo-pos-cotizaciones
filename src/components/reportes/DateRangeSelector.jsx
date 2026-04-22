// src/components/reportes/DateRangeSelector.jsx
import { useState } from 'react'
import { Calendar } from 'lucide-react'
import { getWeekRange, getMonthRange, getLocalISODate } from '../../utils/dateHelpers'

const PRESETS = [
  { id: 'thisWeek',  label: 'Esta semana',   short: 'Semana',    getRango: () => getWeekRange(0),  getPrev: () => getWeekRange(-1) },
  { id: 'lastWeek',  label: 'Semana pasada', short: 'Anterior',  getRango: () => getWeekRange(-1), getPrev: () => getWeekRange(-2) },
  { id: 'thisMonth', label: 'Este mes',      short: 'Mes',       getRango: () => getMonthRange(0), getPrev: () => getMonthRange(-1) },
  { id: 'lastMonth', label: 'Mes pasado',    short: 'Mes ant.',  getRango: () => getMonthRange(-1),getPrev: () => getMonthRange(-2) },
]

export default function DateRangeSelector({ value, onChange }) {
  const [activePreset, setActivePreset] = useState('thisWeek')
  const [showCustom, setShowCustom] = useState(false)

  function selectPreset(preset) {
    setActivePreset(preset.id)
    setShowCustom(false)
    const rango = preset.getRango()
    const prev = preset.getPrev()
    onChange({ from: rango.from, to: rango.to, prevFrom: prev.from, prevTo: prev.to })
  }

  function handleCustom(field, val) {
    const next = { ...value, [field]: val }
    // Calcular prev automáticamente: misma duración hacia atrás
    if (next.from && next.to) {
      const fromD = new Date(next.from)
      const toD = new Date(next.to)
      const diff = toD - fromD
      const prevTo = new Date(fromD.getTime() - 1) // día anterior al from
      const prevFrom = new Date(prevTo.getTime() - diff)
      next.prevFrom = getLocalISODate(prevFrom)
      next.prevTo = getLocalISODate(prevTo)
    }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        <Calendar size={12} className="text-slate-400 shrink-0 sm:w-3.5 sm:h-3.5" />
        {PRESETS.map(p => (
          <button key={p.id}
            onClick={() => selectPreset(p)}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold transition-colors border whitespace-nowrap shrink-0 ${
              activePreset === p.id && !showCustom
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-600 border-slate-200 hover:border-primary-focus'
            }`}>
            <span className="sm:hidden">{p.short}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        ))}
        <button
          onClick={() => { setShowCustom(true); setActivePreset('') }}
          className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold transition-colors border whitespace-nowrap shrink-0 ${
            showCustom
              ? 'bg-primary text-white border-primary'
              : 'bg-white text-slate-600 border-slate-200 hover:border-primary-focus'
          }`}>
          <span className="sm:hidden">Rango</span>
          <span className="hidden sm:inline">Personalizado</span>
        </button>
      </div>
      {showCustom && (
        <div className="flex items-center gap-2">
          <input type="date" value={value.from}
            onChange={e => handleCustom('from', e.target.value)}
            className="text-[11px] sm:text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-focus flex-1 min-w-0" />
          <span className="text-[10px] sm:text-xs text-slate-400 shrink-0">a</span>
          <input type="date" value={value.to}
            onChange={e => handleCustom('to', e.target.value)}
            className="text-[11px] sm:text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-focus flex-1 min-w-0" />
        </div>
      )}
    </div>
  )
}
