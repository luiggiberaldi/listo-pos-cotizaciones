import { RefreshCw } from 'lucide-react'

// Aviso discreto: se ven los datos anteriores mientras llegan los del nuevo período.
export default function IndicadorActualizando({ visible }) {
  if (!visible) return null
  return (
    <div role="status" className="fixed top-16 right-4 z-50 flex items-center gap-2 rounded-full bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 shadow-lg">
      <RefreshCw size={12} className="animate-spin" /> Actualizando…
    </div>
  )
}
