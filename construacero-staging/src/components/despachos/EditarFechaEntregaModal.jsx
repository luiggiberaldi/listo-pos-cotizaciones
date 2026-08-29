import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { Modal } from '../ui/Modal'

function pad(value) {
  return String(value).padStart(2, '0')
}

function toDatetimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocal(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export default function EditarFechaEntregaModal({ isOpen, onClose, despacho, onConfirm, isLoading = false }) {
  const fechaActual = useMemo(
    () => despacho?.entregada_en_ajustada || despacho?.entregada_en || '',
    [despacho?.entregada_en_ajustada, despacho?.entregada_en]
  )
  const [fecha, setFecha] = useState(() => toDatetimeLocal(fechaActual))
  const [motivo, setMotivo] = useState('')

  const fechaIso = fromDatetimeLocal(fecha)
  const valido = !!fechaIso && motivo.trim().length >= 5 && !isLoading

  function confirmar() {
    if (!valido) return
    onConfirm({ nuevaFechaEntrega: fechaIso, motivo: motivo.trim() })
  }

  return (
    <Modal isOpen={isOpen} onClose={isLoading ? () => {} : onClose} title="Corregir fecha efectiva de entrega" className="sm:max-w-lg">
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Corrección auditada</p>
            <p className="mt-1">El número del despacho, los montos, pagos, inventario y la fecha de aprobación no cambiarán.</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <CalendarClock size={16} />
            Despacho #{despacho?.numero ?? '—'}
          </div>
          <p className="mt-1">La fecha se interpreta en la zona horaria local y se guarda con zona horaria.</p>
          {despacho?.entregada_en_ajustada && (
            <p className="mt-1 text-teal-700">Este despacho ya tiene una fecha efectiva corregida.</p>
          )}
        </div>

        <div>
          <label htmlFor="fecha-entrega-ajustada" className="block text-sm font-medium text-slate-700 mb-1">
            Nueva fecha efectiva <span className="text-red-500">*</span>
          </label>
          <input
            id="fecha-entrega-ajustada"
            type="datetime-local"
            value={fecha}
            onChange={event => setFecha(event.target.value)}
            disabled={isLoading}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary disabled:opacity-60"
          />
        </div>

        <div>
          <label htmlFor="motivo-fecha-entrega" className="block text-sm font-medium text-slate-700 mb-1">
            Motivo del cambio <span className="text-red-500">*</span>
          </label>
          <textarea
            id="motivo-fecha-entrega"
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            disabled={isLoading}
            minLength={5}
            maxLength={1000}
            rows={3}
            placeholder="Ej.: Recepción tardía en obra"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-slate-400">{motivo.length}/5 caracteres mínimos</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!valido}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isLoading ? 'Guardando...' : 'Confirmar corrección'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
