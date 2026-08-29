// src/components/despachos/FacturaModal.jsx
// Modal para ingresar datos manuales de la Factura (Nro Factura, Nro Control)
import { useEffect, useState } from 'react'
import { X, FileText, Loader2, Check } from 'lucide-react'

export default function FacturaModal({ isOpen, onClose, onConfirm, actionType = 'download', loading = false }) {
  const [numFactura, setNumFactura] = useState('')
  const [numControl, setNumControl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setNumFactura('')
      setNumControl('')
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!numFactura.trim()) {
      setError('Debe ingresar el Número de Factura')
      return
    }
    if (!numControl.trim()) {
      setError('Debe ingresar el Número de Control')
      return
    }
    setError('')
    onConfirm(numFactura.trim(), numControl.trim())
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md sm:mx-4
        max-h-[85vh] flex flex-col pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 rounded-t-3xl sm:rounded-t-3xl"
          style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' }}>
          <div>
            <p className="font-bold text-white text-base leading-tight">Generar Factura</p>
            <p className="text-[11px] text-white/70 font-medium mt-0.5">
              Ingrese los datos manuales para el documento
            </p>
          </div>
          <button onClick={onClose}
            className="p-2 -mr-1 rounded-xl bg-white/15 hover:bg-white/25 transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-5 flex-1 flex flex-col gap-4">
          <div className="space-y-4">
            
            {/* Campo: Número de Factura */}
            <div className="space-y-1.5">
              <label htmlFor="numFactura" className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                Número de Factura
              </label>
              <div className="relative">
                <input
                  id="numFactura"
                  type="text"
                  placeholder="Ej: 00045"
                  value={numFactura}
                  onChange={e => setNumFactura(e.target.value)}
                  disabled={loading}
                  autoFocus
                  className="w-full pl-3 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Campo: Número de Control */}
            <div className="space-y-1.5">
              <label htmlFor="numControl" className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                Número de Control
              </label>
              <div className="relative">
                <input
                  id="numControl"
                  type="text"
                  placeholder="Ej: 00-12845"
                  value={numControl}
                  onChange={e => setNumControl(e.target.value)}
                  disabled={loading}
                  className="w-full pl-3 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-500 font-semibold text-center mt-1">
                {error}
              </p>
            )}
          </div>

          {/* Botones de acción */}
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-2xl text-[14px] font-bold text-white transition-all
                shadow-lg active:shadow-sm active:translate-y-px
                bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-blue-200/50
                disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Generando PDF...
                </>
              ) : (
                <>
                  <Check size={16} />
                  {actionType === 'print' ? 'Imprimir Factura' : 'Descargar Factura'}
                </>
              )}
            </button>
            
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full py-2.5 rounded-2xl text-[13px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all text-center"
            >
              Cancelar
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
