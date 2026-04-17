import React, { useState, useCallback, createContext, useContext, useRef } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const COLORS = {
  success: {
    bg: 'bg-emerald-950/90 border-emerald-700/40',
    icon: 'text-emerald-400',
  },
  error: {
    bg: 'bg-rose-950/90 border-rose-700/40',
    icon: 'text-rose-400',
  },
  warning: {
    bg: 'bg-amber-950/90 border-amber-700/40',
    icon: 'text-amber-400',
  },
  info: {
    bg: 'bg-slate-800/90 border-slate-600/40',
    icon: 'text-blue-400',
  },
}

// Global ref for showToast — avoids mutable variable anti-pattern
const toastRef = { current: null }

export function showToast(message, type = 'info', duration = 3500) {
  toastRef.current?.(message, type, duration)
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
    if (duration > 0) {
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
        timersRef.current.delete(id)
      }, duration)
      timersRef.current.set(id, timer)
    }
  }, [])

  // Keep global ref in sync
  toastRef.current = addToast

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90vw] max-w-sm pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const colors = COLORS[toast.type] || COLORS.info
          const IconComp = ICONS[toast.type] || Info
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 rounded-xl border backdrop-blur-xl shadow-2xl shadow-black/40 ${colors.bg}`}
            >
              <IconComp size={18} className={`${colors.icon} shrink-0 mt-0.5`} />
              <p className="text-sm text-white/90 font-medium flex-1 leading-snug">{toast.message}</p>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-white/30 hover:text-white/70 transition-colors shrink-0 mt-0.5"
                aria-label="Cerrar notificación"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
