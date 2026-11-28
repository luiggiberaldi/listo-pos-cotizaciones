// src/components/ui/StagingBanner.jsx
// Indicador visual permanente para el entorno de pruebas (staging).
// Solo se activa cuando la app apunta a la base de datos de staging (spupqgkdsgohxxfoxydl)
// o VITE_APP_ENV === 'staging'. En producción no muestra nada.
import { useEffect } from 'react'
import { FlaskConical, AlertTriangle } from 'lucide-react'

const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'

export function esEntornoStaging() {
  const url = String(import.meta.env?.VITE_SUPABASE_URL || '')
  const appEnv = String(import.meta.env?.VITE_APP_ENV || '').toLowerCase()
  return url.includes(STAGING_PROJECT_REF) || appEnv === 'staging'
}

export function StagingBadge({ compact = false }) {
  if (!esEntornoStaging()) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-400 text-slate-950 font-black uppercase tracking-wider border border-amber-600 shadow-sm px-2 py-0.5 text-[10px] shrink-0"
      title="Estás trabajando en el proyecto de pruebas (STAGING). Nada aquí afecta producción."
    >
      <FlaskConical size={11} className="shrink-0" />
      <span>{compact ? 'STAGING' : 'PRUEBAS · STAGING'}</span>
    </span>
  )
}

export default function StagingBanner() {
  const isStaging = esEntornoStaging()

  useEffect(() => {
    if (!isStaging) return
    const prefijo = '[PRUEBAS · STAGING] '
    if (!document.title.startsWith(prefijo)) {
      document.title = `${prefijo}${document.title || 'Construacero Carabobo'}`
    }
  }, [isStaging])

  if (!isStaging) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="staging-banner"
      className="fixed top-0 left-0 right-0 z-[100] h-8 bg-amber-400 text-slate-950 border-b-2 border-amber-600 shadow-md px-3 flex items-center justify-center gap-x-2 text-center overflow-hidden"
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-black uppercase tracking-wider shrink-0">
        <AlertTriangle size={14} className="shrink-0 text-amber-950" />
        PROYECTO DE PRUEBAS (STAGING)
      </span>
      <span className="hidden sm:inline text-[11px] sm:text-xs font-semibold text-amber-950/90 truncate">
        — Entorno de prueba: los cambios, ventas y PDFs aquí NO afectan producción.
      </span>
    </div>
  )
}
