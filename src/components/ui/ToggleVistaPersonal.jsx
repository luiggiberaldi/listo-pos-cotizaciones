// src/components/ui/ToggleVistaPersonal.jsx
// Toggle segmentado: "Mis datos" vs "Todos" para supervisores
import { User, Users } from 'lucide-react'

export default function ToggleVistaPersonal({ value, onChange }) {
  return (
    <div className="flex bg-slate-100 rounded-full p-0.5 border border-slate-200">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
          !value
            ? 'bg-white text-primary shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <User size={12} />
        <span className="hidden sm:inline">Mis datos</span>
        <span className="sm:hidden">Mío</span>
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
          value
            ? 'bg-white text-primary shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <Users size={12} />
        Todos
      </button>
    </div>
  )
}
