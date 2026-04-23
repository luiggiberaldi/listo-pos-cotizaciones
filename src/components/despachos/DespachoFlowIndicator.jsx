// src/components/despachos/DespachoFlowIndicator.jsx
// Indicador visual del ciclo de vida de un despacho
import { memo } from 'react'
import { Clock, Truck, PackageCheck, Ban, CheckCircle } from 'lucide-react'

const STEPS = [
  { key: 'pendiente',  label: 'Pendiente',  icon: Clock, color: 'amber' },
  { key: 'despachada', label: 'Despachada', icon: Truck, color: 'indigo' },
  { key: 'entregada',  label: 'Entregada',  icon: PackageCheck, color: 'emerald' },
]

const TERMINALS = {
  anulada: { label: 'Cancelado', icon: Ban, color: 'red' },
}

const DOT_COLORS = {
  amber:   { bg: 'bg-amber-500', ring: 'ring-amber-200' },
  indigo:  { bg: 'bg-indigo-500', ring: 'ring-indigo-200' },
  emerald: { bg: 'bg-emerald-500', ring: 'ring-emerald-200' },
  red:     { bg: 'bg-red-500', ring: 'ring-red-200' },
  empty:   { bg: 'bg-slate-200', ring: '' },
}

function getStepIndex(estado) {
  if (estado === 'pendiente') return 0
  if (estado === 'despachada') return 1
  if (estado === 'entregada') return 2
  return -1 // terminal
}

const DespachoFlowIndicator = memo(function DespachoFlowIndicator({ estado, compact }) {
  const terminal = TERMINALS[estado]
  const currentIdx = getStepIndex(estado)
  const isTerminal = !!terminal

  // Para anulada, marcar hasta el paso donde se anuló (asumimos pendiente como mínimo)
  let completedUpTo = currentIdx
  if (isTerminal) {
    completedUpTo = 0 // anulada puede pasar desde pendiente o despachada
  }

  function getStepState(idx) {
    if (isTerminal && idx === completedUpTo) return 'terminal'
    if (isTerminal && idx > completedUpTo) return 'future'
    if (isTerminal && idx < completedUpTo) return 'completed'
    if (idx < currentIdx) return 'completed'
    if (idx === currentIdx) return 'current'
    return 'future'
  }

  return (
    <div className={`flex items-center w-full ${compact ? 'gap-0' : 'gap-1'}`}>
      {STEPS.map((step, idx) => {
        const state = getStepState(idx)
        const isLast = idx === STEPS.length - 1
        const showTerminal = state === 'terminal' && isTerminal

        let dotColor, Icon, label
        if (showTerminal) {
          dotColor = DOT_COLORS[terminal.color]
          Icon = terminal.icon
          label = terminal.label
        } else if (state === 'completed') {
          dotColor = DOT_COLORS[step.color]
          Icon = CheckCircle
          label = step.label
        } else if (state === 'current') {
          dotColor = DOT_COLORS[step.color]
          Icon = step.icon
          label = step.label
        } else {
          dotColor = DOT_COLORS.empty
          Icon = step.icon
          label = step.label
        }

        return (
          <div key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            {/* Dot + label */}
            <div className="flex flex-col items-center" style={{ minWidth: compact ? '28px' : '48px' }}>
              <div className={`
                flex items-center justify-center rounded-full transition-all
                ${compact ? 'w-5 h-5' : 'w-7 h-7'}
                ${dotColor.bg}
                ${state === 'current' ? `ring-2 ${dotColor.ring}` : ''}
                ${state === 'terminal' ? `ring-2 ${dotColor.ring}` : ''}
              `}>
                <Icon size={compact ? 10 : 14} className="text-white" strokeWidth={2.5} />
              </div>
              {!compact && (
                <span className={`text-[9px] font-semibold mt-1 text-center leading-tight ${
                  state === 'future' ? 'text-slate-300' :
                  state === 'completed' ? 'text-slate-500' :
                  state === 'terminal' ? 'text-red-600' :
                  'text-slate-700'
                }`}>
                  {label}
                </span>
              )}
            </div>

            {/* Connector line */}
            {!isLast && (
              <div className={`flex-1 mx-0.5 h-[2px] rounded-full transition-colors ${
                (state === 'completed' || state === 'current') ? 'bg-slate-300' : 'bg-slate-100'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
})

export default DespachoFlowIndicator
