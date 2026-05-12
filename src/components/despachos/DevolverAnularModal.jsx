import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { AlertCircle } from 'lucide-react'
import CustomSelect from '../ui/CustomSelect'

export default function DevolverAnularModal({ isOpen, onClose, onConfirm, accion, despachoNum, isLoading }) {
  const [motivoSelect, setMotivoSelect] = useState('')
  const [motivoText, setMotivoText] = useState('')
  const [entendido, setEntendido] = useState(false)

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setMotivoSelect('')
      setMotivoText('')
      setEntendido(false)
    }
  }, [isOpen])

  const isDevolver = accion?.estado === 'pendiente' // de despachada a pendiente
  const isAnular = accion?.estado === 'anulada'

  // Validation
  const isValidDevolver = isDevolver && motivoSelect !== '' && (motivoSelect !== 'Otro' || motivoText.trim().length > 0)
  const isValidAnular = isAnular && motivoText.trim().length >= 10 && entendido
  const isValid = isValidDevolver || isValidAnular

  const handleConfirm = () => {
    if (!isValid) return
    const motivoFinal = isDevolver
      ? (motivoSelect === 'Otro' ? motivoText.trim() : motivoSelect)
      : motivoText.trim()

    onConfirm(accion.estado, motivoFinal)
  }

  const opcionesDevolucion = [
    'Cliente ausente',
    'Dirección incorrecta',
    'Cliente rechazó el pedido',
    'Otro'
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={accion?.actionConfig?.confirmTitle || 'Confirmar acción'}>
      <div className="space-y-4">
        <div className={`p-3 rounded-xl border flex items-start gap-2 text-sm ${isAnular ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{accion?.actionConfig?.confirmMessage}</p>
            {accion?.actionConfig?.confirmDetails && <p className="mt-1 opacity-90">{accion.actionConfig.confirmDetails}</p>}
          </div>
        </div>

        {isDevolver && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Motivo de la devolución <span className="text-red-500">*</span></label>
              <CustomSelect
                options={[
                  ...opcionesDevolucion.map(op => ({ value: op, label: op }))
                ]}
                value={motivoSelect}
                onChange={val => setMotivoSelect(val)}
                placeholder="Seleccione un motivo..."
                searchable={false}
              />
            </div>
            {motivoSelect === 'Otro' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Especifique <span className="text-red-500">*</span></label>
                <textarea
                  value={motivoText}
                  onChange={e => setMotivoText(e.target.value)}
                  placeholder="Detalles de la devolución..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-500 transition-colors min-h-[80px] resize-none"
                />
              </div>
            )}
          </div>
        )}

        {isAnular && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Motivo de anulación <span className="text-red-500">*</span></label>
              <textarea
                value={motivoText}
                onChange={e => setMotivoText(e.target.value)}
                placeholder="Escriba el motivo (mínimo 10 caracteres)..."
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-500 transition-colors min-h-[100px] resize-none"
              />
              <p className="text-xs text-slate-400 mt-1">{motivoText.length}/10 mínimo</p>
            </div>
            <label className="flex items-start gap-2 bg-slate-50 p-2 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={entendido}
                onChange={e => setEntendido(e.target.checked)}
                className="mt-0.5 w-4 h-4 border-slate-300 text-red-600 focus:ring-red-500 rounded cursor-pointer"
              />
              <span className="text-sm font-medium text-slate-700 select-none">
                Entiendo que esta acción no revierte el pago registrado.
              </span>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${isAnular ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {isLoading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
            {accion?.actionConfig?.confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
