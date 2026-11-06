import { RefreshCw } from 'lucide-react'

// Aviso en línea (junto a los botones de período): se ven los datos anteriores,
// atenuados, mientras llegan los del nuevo período.
export default function IndicadorActualizando({ visible }) {
  if (!visible) return null
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 whitespace-nowrap shrink-0 px-1">
      <RefreshCw size={12} className="animate-spin" /> Actualizando…
    </span>
  )
}

