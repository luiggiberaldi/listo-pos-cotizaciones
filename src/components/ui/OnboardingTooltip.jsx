// src/components/ui/OnboardingTooltip.jsx
// Tooltips de primera vez para guiar al usuario nuevo
import { useState, useEffect } from 'react'
import { X, Lightbulb } from 'lucide-react'

const STORAGE_KEY = 'construacero_onboarding_done'

// Verificar si el onboarding ya fue completado
export function isOnboardingDone() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return true }
}

// Marcar onboarding como completado
export function markOnboardingDone() {
  try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
}

// Tooltips individuales que se muestran una vez
const TIPS_KEY = 'construacero_tips_shown'

export function isTipShown(tipId) {
  try {
    const shown = JSON.parse(localStorage.getItem(TIPS_KEY) || '[]')
    return shown.includes(tipId)
  } catch { return true }
}

export function markTipShown(tipId) {
  try {
    const shown = JSON.parse(localStorage.getItem(TIPS_KEY) || '[]')
    if (!shown.includes(tipId)) {
      shown.push(tipId)
      localStorage.setItem(TIPS_KEY, JSON.stringify(shown))
    }
  } catch {}
}

// Componente de tooltip inline — se muestra solo 1 vez por tipId
export default function OnboardingTip({ tipId, children, className = '' }) {
  const [visible, setVisible] = useState(() => !isTipShown(tipId))

  useEffect(() => {
    if (visible) {
      // Marcar como mostrado inmediatamente para que no vuelva a aparecer en futuras visitas
      markTipShown(tipId)
      // Auto-dismiss después de 15 segundos
      const timer = setTimeout(() => setVisible(false), 15000)
      return () => clearTimeout(timer)
    }
  }, [visible, tipId])

  function dismiss() {
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border animate-in fade-in slide-in-from-top-1 duration-300 ${className}`}
      style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.05), rgba(184,134,11,0.05))', border: '1px solid rgba(27,54,93,0.12)' }}>
      <Lightbulb size={14} className="text-amber-500 shrink-0 mt-0.5" />
      <p className="text-xs text-slate-600 flex-1 leading-relaxed">{children}</p>
      <button onClick={dismiss}
        className="p-0.5 text-slate-300 hover:text-slate-500 transition-colors shrink-0">
        <X size={12} />
      </button>
    </div>
  )
}
