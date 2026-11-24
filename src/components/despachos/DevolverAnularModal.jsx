import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { AlertCircle } from 'lucide-react'
import CustomSelect from '../ui/CustomSelect'
import { authFetch } from '../../services/authFetch'

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`

// OP-2026-052 (G2, N1): antes de reabrir o anular, el modal pregunta al servidor qué dinero está
// en juego (pagos anotados, abonos enlazados y lo que quedaría "pagado de más") y, si hay, exige
// elegir qué pasa con ese dinero. Antes: reabrir se bloqueaba sin salida o dejaba pagos sin deuda
// escondidos, y anular hacía desaparecer los pagos anotados ("no revierte el pago registrado").
// Opción de qué hacer con los pagos (fuera del componente para que no se rearme en cada dibujo).
function Opcion({ value, titulo, detalle, testid, destino, onElegir }) {
  return (
    <label className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${destino === value ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <input type="radio" name="destino-pagos" value={value} checked={destino === value} onChange={() => onElegir(value)}
        data-testid={testid} className="mt-0.5" />
      <span className="text-xs text-slate-700"><b className="text-slate-900">{titulo}</b><br />{detalle}</span>
    </label>
  )
}

export default function DevolverAnularModal({ isOpen, onClose, onConfirm, accion, despachoNum, isLoading, tieneDevoluciones, despachoId }) {
  const [motivoSelect, setMotivoSelect] = useState('')
  const [motivoText, setMotivoText] = useState('')
  const [entendido, setEntendido] = useState(false)
  const [juego, setJuego] = useState(null)        // respuesta de /api/despachos/pagos-en-juego
  const [juegoError, setJuegoError] = useState(null)
  const [destino, setDestino] = useState('')      // decisión sobre los pagos
  const [errorConfirmar, setErrorConfirmar] = useState(null)

  const isDevolver = accion?.estado === 'pendiente'
  const isAnular = accion?.estado === 'anulada'

  useEffect(() => {
    if (!isOpen) return
    setMotivoSelect('')
    setMotivoText('')
    setEntendido(false)
    setJuego(null)
    setJuegoError(null)
    setDestino('')
    setErrorConfirmar(null)
    if (!despachoId) return
    let vivo = true
    authFetch(`/api/despachos/pagos-en-juego?despachoId=${despachoId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!vivo) return
        if (r.ok) setJuego(d)
        else setJuegoError(d?.error || 'No se pudo revisar los pagos del despacho')
      })
      .catch(() => { if (vivo) setJuegoError('No hay conexión con el servidor para revisar los pagos') })
    return () => { vivo = false }
  }, [isOpen, despachoId, accion?.estado])

  const pideDecisionReabrir = isDevolver && !!juego?.requiere_decision_reabrir
  const pideDecisionAnular = isAnular && !!juego?.requiere_decision_anular
  const pideDecision = pideDecisionReabrir || pideDecisionAnular

  const motivoAnularOk = motivoText.trim().length >= 10
  const isValidDevolver = isDevolver && motivoSelect !== '' && (motivoSelect !== 'Otro' || motivoText.trim().length > 0)
  const isValidAnular = isAnular && motivoAnularOk && entendido
  const decisionOk = !pideDecision || destino !== ''
  // Mientras no se sepa si hay pagos en juego, no se deja confirmar (salvo que la consulta haya fallado:
  // el servidor vuelve a revisar y pedirá la decisión si hace falta).
  const consultaLista = !!juego || !!juegoError
  const isValid = (isValidDevolver || isValidAnular) && decisionOk && consultaLista

  const handleConfirm = async () => {
    if (!isValid) return
    const motivoFinal = isDevolver
      ? (motivoSelect === 'Otro' ? motivoText.trim() : motivoSelect)
      : motivoText.trim()
    const decision = pideDecisionReabrir ? { destinoPagos: destino } : pideDecisionAnular ? { destinoPagoAnotado: destino } : {}
    setErrorConfirmar(null)
    try {
      await onConfirm(accion.estado, motivoFinal, decision)
    } catch (e) {
      // Si el servidor detectó pagos que la pantalla no vio, muestra la decisión con sus datos
      if (e?.code === 'DECISION_PAGOS_REQUERIDA' && e?.pagos) {
        setJuego(e.pagos)
        setDestino('')
      }
      setErrorConfirmar(e?.message || 'No se pudo completar la acción')
    }
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
            {tieneDevoluciones && (
              <p className="mt-1.5 text-xs font-semibold text-amber-900 bg-amber-100/80 p-1.5 rounded-lg border border-amber-300/50">
                📦 Este despacho tiene devoluciones e intercambios previos. Se reingresará el stock neto entregado y se revertirán los saldos en CxC de forma segura.
              </p>
            )}
          </div>
        </div>

        {!consultaLista && isOpen && (
          <p className="text-xs text-slate-500">Revisando los pagos del despacho…</p>
        )}
        {juegoError && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
            {juegoError}. Si el despacho tiene pagos, el sistema te pedirá qué hacer con ellos al confirmar.
          </p>
        )}

        {pideDecisionReabrir && (
          <div data-testid="decision-pagos-reabrir" className="space-y-2 p-3 rounded-xl border border-amber-300 bg-amber-50/60">
            <p className="text-sm font-bold text-amber-900">Este despacho tiene pagos. ¿Qué hacemos con ese dinero?</p>
            <ul className="text-xs text-amber-900 list-disc pl-4">
              {Number(juego.total_enlazado) > 0 && <li>{fmt(juego.total_enlazado)} en abonos registrados a este despacho.</li>}
              {Number(juego.pagado_de_mas_nuevo) > 0 && <li>Al quitar su deuda ({fmt(juego.deuda_despacho)}), {fmt(juego.pagado_de_mas_nuevo)} del cliente quedarían sin deuda que pagar.</li>}
            </ul>
            <Opcion destino={destino} onElegir={setDestino} value="mantener" testid="destino-mantener" titulo="Dejar el dinero en la cuenta del cliente"
              detalle="Los abonos no se borran. Cuando el despacho se vuelva a entregar, se aplican solos a su deuda. Mientras tanto se ven como “pagado de más”." />
            <Opcion destino={destino} onElegir={setDestino} value="saldo_favor" testid="destino-saldo-favor" titulo="Pasarlo a saldo a favor del cliente"
              detalle="El dinero sobrante queda como saldo a favor; el cliente puede usarlo en otra compra o se le puede devolver." />
          </div>
        )}

        {pideDecisionAnular && (
          <div data-testid="decision-pagos-anular" className="space-y-2 p-3 rounded-xl border border-red-300 bg-red-50/60">
            <p className="text-sm font-bold text-red-900">Este despacho tiene {fmt(juego.total_anotado)} en pagos anotados. ¿Qué pasó con ese dinero?</p>
            <ul className="text-xs text-red-900 list-disc pl-4">
              {(juego.pagos_anotados || []).map((p, i) => (
                <li key={i}>{p.metodo}: {fmt(p.monto)}{p.referencia ? ` (ref. ${p.referencia})` : ''}</li>
              ))}
            </ul>
            <Opcion destino={destino} onElegir={setDestino} value="saldo_favor" testid="destino-anular-saldo-favor" titulo="El cliente pagó: pasarlo a saldo a favor"
              detalle="Se crea saldo a favor por cada pago. Úsalo para pagar el despacho nuevo o devuélveselo al cliente." />
            <Opcion destino={destino} onElegir={setDestino} value="otro_despacho" testid="destino-anular-otro" titulo="El pago se anotará en el despacho que reemplaza a este"
              detalle="No se mueve dinero ahora. Queda escrito en la auditoría para poder revisarlo." />
            <Opcion destino={destino} onElegir={setDestino} value="no_cobrado" testid="destino-anular-no-cobrado" titulo="El pago nunca se recibió"
              detalle="No se mueve dinero. El motivo de la anulación queda en la auditoría junto con los pagos." />
          </div>
        )}

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
                data-testid="motivo-anulacion"
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
                data-testid="anular-entendido"
                checked={entendido}
                onChange={e => setEntendido(e.target.checked)}
                className="mt-0.5 w-4 h-4 border-slate-300 text-red-600 focus:ring-red-500 rounded cursor-pointer"
              />
              <span className="text-sm font-medium text-slate-700 select-none">
                {pideDecisionAnular
                  ? 'Entiendo lo que pasará con los pagos anotados y que queda registrado en la auditoría.'
                  : 'Entiendo que el despacho quedará anulado y que queda registrado en la auditoría.'}
              </span>
            </label>
          </div>
        )}

        {errorConfirmar && (
          <div data-testid="reabrir-anular-error" role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-start gap-1.5">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{errorConfirmar}</span>
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
            data-testid="reabrir-anular-confirmar"
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
