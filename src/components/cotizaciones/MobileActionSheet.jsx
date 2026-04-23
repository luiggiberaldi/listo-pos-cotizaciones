// src/components/cotizaciones/MobileActionSheet.jsx
// Bottom sheet de acciones para móvil — thumb-friendly, 48px mínimo por botón
import { createPortal } from 'react-dom'

export default function MobileActionSheet({ isOpen, onClose, actions = [] }) {
  if (!isOpen || actions.length === 0) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[98] bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[99] bg-white rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>

        {/* Actions */}
        <div className="px-4 pb-4 space-y-1">
          {actions.map((action, i) => {
            const Icon = action.icon
            return (
              <button
                key={i}
                onClick={() => { action.onClick(); onClose() }}
                disabled={action.disabled}
                className={`w-full flex items-center gap-3 px-4 min-h-[48px] rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] disabled:opacity-40 ${
                  action.danger
                    ? 'text-red-600 hover:bg-red-50 active:bg-red-100'
                    : `hover:bg-slate-50 active:bg-slate-100 ${action.textColor || 'text-slate-700'}`
                }`}
              >
                {Icon && <Icon size={18} className="shrink-0" />}
                <span className="flex-1 text-left">{action.label}</span>
                {action.badge && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {action.badge}
                  </span>
                )}
              </button>
            )
          })}

          {/* Cancel button */}
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center min-h-[48px] rounded-xl text-sm font-semibold text-slate-400 hover:bg-slate-50 mt-2 border border-slate-100"
          >
            Cerrar
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
