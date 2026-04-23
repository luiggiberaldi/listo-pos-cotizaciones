// src/components/cotizaciones/QuoteFlowIndicator.jsx
// Indicador visual del ciclo de vida de una cotización
import { memo } from 'react'
import { FileText, Send, Clock, CheckCircle, XCircle, Ban, CalendarX } from 'lucide-react'

const STEPS = [
  { key: 'borrador', label: 'Borrador', icon: FileText, color: 'slate' },
  { key: 'enviada',  label: 'Enviada',  icon: Send, color: 'blue' },
  { key: 'revision', label: 'Respuesta', icon: Clock, color: 'blue', virtual: true },
  { key: 'aceptada', label: 'Aprobada', icon: CheckCircle, color: 'emerald' },
]

// Estados terminales reemplazan el step donde ocurrieron
const TERMINALS = {
  rechazada: { afterStep: 'revision', label: 'No aceptada', icon: XCircle, color: 'orange' },
  anulada:   { afterStep: null, label: 'Cancelada', icon: Ban, color: 'red' },
  vencida:   { afterStep: 'enviada', label: 'Vencida', icon: CalendarX, color: 'amber' },
}

const DOT_COLORS = {
  slate:   { bg: 'bg-slate-400', ring: 'ring-slate-200' },
  blue:    { bg: 'bg-blue-500', ring: 'ring-blue-200' },
  emerald: { bg: 'bg-emerald-500', ring: 'ring-emerald-200' },
  orange:  { bg: 'bg-orange-500', ring: 'ring-orange-200' },
  red:     { bg: 'bg-red-500', ring: 'ring-red-200' },
  amber:   { bg: 'bg-amber-500', ring: 'ring-amber-200' },
  empty:   { bg: 'bg-slate-200', ring: '' },
}

// Determinar qué step index corresponde a cada estado
function getStepIndex(estado) {
  if (estado === 'borrador') return 0
  if (estado === 'enviada') return 1  // virtual "revision" = step 2 visually active
  if (estado === 'aceptada') return 3
  return -1 // terminal
}

const QuoteFlowIndicator = memo(function QuoteFlowIndicator({ estado, despacho, compact }) {
  const terminal = TERMINALS[estado]
  const currentIdx = getStepIndex(estado)
  const isTerminal = !!terminal

  // Determinar hasta qué paso se completó antes de terminar
  let completedUpTo = currentIdx
  if (isTerminal) {
    const afterKey = terminal.afterStep
    if (afterKey === 'revision') completedUpTo = 2
    else if (afterKey === 'enviada') completedUpTo = 1
    else if (afterKey === null) {
      // anulada puede venir de cualquier estado, usar el paso más avanzado razonable
      completedUpTo = 0
    }
  } else if (estado === 'enviada') {
    completedUpTo = 2 // "revision" step activo
  }

  function getStepState(idx) {
    if (isTerminal && idx === completedUpTo) return 'terminal'
    if (isTerminal && idx > completedUpTo) return 'future'
    if (isTerminal && idx < completedUpTo) return 'completed'
    if (idx < currentIdx) return 'completed'
    if (idx === currentIdx) return 'current'
    if (estado === 'enviada' && idx === 2) return 'current' // "revision" activa cuando está enviada
    return 'future'
  }

  const stepsToRender = [...STEPS]

  return (
    <div className={`flex items-center w-full ${compact ? 'gap-0' : 'gap-1'}`}>
      {stepsToRender.map((step, idx) => {
        const state = getStepState(idx)
        const isLast = idx === stepsToRender.length - 1
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
                  state === 'terminal' ? `text-${terminal.color}-600` :
                  'text-slate-700'
                }`}>
                  {label}
                </span>
              )}
            </div>

            {/* Connector line */}
            {!isLast && (
              <div className={`flex-1 mx-0.5 ${compact ? 'h-[2px]' : 'h-[2px]'} rounded-full transition-colors ${
                (state === 'completed' || state === 'current') ? 'bg-slate-300' : 'bg-slate-100'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
})

export default QuoteFlowIndicator
