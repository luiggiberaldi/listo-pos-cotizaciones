import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, Plus, X } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { showToast } from '../ui/Toast'
import { FORMAS_PAGO } from '../../constants/formasPago'
import { authFetch } from '../../services/authFetch'
import { useQueryClient } from '@tanstack/react-query'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { convertBsToUsd } from '../../utils/codCurrency.js'

const METODOS_EFECTIVO = new Set(['Efectivo $', 'Efectivo Bs'])
const MOTIVOS_REVISION = {
  cod_sin_cargo: 'El pedido declara cobro en entrega pero no tiene su cargo COD en el libro.',
  cargo_no_coincide: 'El cargo COD del libro no coincide con el monto declarado en la forma de pago.',
  atribucion_ambigua: 'Hay abonos sin marca que desbordaron la parte a crédito; administración debe atribuirlos con evidencia.',
  flag_sin_respaldo: 'La marca de "pagado" no tiene movimientos que la respalden; administración debe revisarla.',
  sin_movimientos: 'La deuda COD está en cero sin movimientos que lo expliquen.',
}
const formatUsd = value => `$${(Number(value) || 0).toFixed(2)}`
const hasMaxTwoDecimals = value => /^\d+(?:\.\d{1,2})?$/.test(String(value).trim())
const round2 = value => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100
const getTasaSnapshot = tasa => Number(Number(tasa || 0).toFixed(8))
const getMontoUsd = (pago, tasa) => pago.metodo === 'Efectivo Bs'
  ? (convertBsToUsd(pago.monto_bs, getTasaSnapshot(tasa)) || 0)
  : Number(pago.monto) || 0
const getTasaPago = (pago, tasaActual) => Number(pago.tasa_snapshot) > 0 ? pago.tasa_snapshot : tasaActual
const pagoInicial = (metodo, monto = 0, tasa = 0) => metodo === 'Efectivo Bs'
  ? { metodo, monto_bs: tasa > 0 ? round2(monto * tasa).toFixed(2) : '', referencia: '' }
  : { metodo, monto: round2(monto), referencia: '' }

export default function ConciliarCodModal({ isOpen, onClose, despacho }) {
  const qc = useQueryClient()
  const { tasaEfectiva, modoTasa, tasaUsdt, tasaBcv } = useTasaCambio()
  const tasaFuente = modoTasa === 'manual' ? 'Manual'
    : modoTasa === 'usdt' ? (tasaUsdt.fuente || 'USDT')
      : (tasaBcv.fuente || 'BCV')
  const tasaActualizada = modoTasa === 'usdt' ? tasaUsdt.ultimaActualizacion
    : modoTasa === 'manual' ? null : tasaBcv.ultimaActualizacion
  const [resumen, setResumen] = useState(null)
  const [payments, setPayments] = useState([])
  const [evidencia, setEvidencia] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingResumen, setLoadingResumen] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  useEffect(() => {
    if (!isOpen || !despacho?.id) return
    let cancelled = false
    setResumen(null)
    setPayments([])
    setEvidencia('')
    setIdempotencyKey(crypto.randomUUID())
    setLoadingResumen(true)
    authFetch('/api/despachos/resumen-financiero', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ despachoId: despacho.id }),
    })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'No se pudo leer el saldo del despacho')
        if (!cancelled) setResumen(data.resumen)
      })
      .catch(error => {
        if (!cancelled) showToast(error.message || 'No se pudo leer el ledger del despacho', 'error')
      })
      .finally(() => { if (!cancelled) setLoadingResumen(false) })
    return () => { cancelled = true }
  }, [isOpen, despacho?.id])

  const cod = resumen?.cod
  const codLedger = resumen?.ledger
  const totalCod = round2(Number(codLedger?.deuda_cod_usd) || 0)
  const cargoCxc = round2(Number(codLedger?.cargo_cxc_usd) || 0)
  const deudaCxc = round2(Number(codLedger?.deuda_cxc_usd) || 0)
  const desbordeSinMarca = round2(Number(codLedger?.desborde_sin_marca_usd) || 0)
  const esPagoMixto = cargoCxc > 0
  const totalIngresado = useMemo(
    () => round2(payments.reduce((sum, payment) => sum + getMontoUsd(payment, getTasaPago(payment, tasaEfectiva)), 0)),
    [payments, tasaEfectiva],
  )
  const diferencia = round2(totalIngresado - totalCod)
  const excedente = Math.max(0, diferencia)
  const coincide = diferencia >= 0 && diferencia <= 0.01
  const pagosConPrecisionValida = payments.every(payment =>
    hasMaxTwoDecimals(payment.metodo === 'Efectivo Bs' ? payment.monto_bs : payment.monto),
  )
  const pagoValido = pagosConPrecisionValida && totalIngresado >= 0.01 && diferencia <= 0.01
  const puedeConciliar = cod?.estado === 'pendiente' || cod?.estado === 'parcial'
  const metodosPermitidos = FORMAS_PAGO.filter(m =>
    !['Cobro a destino', 'Cta por cobrar', 'Donación', 'Cruce'].includes(m),
  )
  const numeroDespacho = despacho?.cotizacion?.numero ?? despacho?.numero
  const numDisplay = `DES-${String(numeroDespacho || '').padStart(5, '0')}`

  function agregarMetodo(metodo) {
    const falta = Math.max(0, totalCod - totalIngresado)
    if (metodo === 'Efectivo Bs' && !(tasaEfectiva > 0)) {
      showToast('La tasa seleccionada no está disponible; actualiza la tasa antes de agregar este pago.', 'warning')
      return
    }
    setPayments(current => [...current, pagoInicial(metodo, falta, tasaEfectiva)])
  }

  function actualizarPago(indice, cambios) {
    setPayments(current => current.map((payment, i) => i === indice ? { ...payment, ...cambios } : payment))
  }

  function eliminarPago(indice) {
    setPayments(current => current.filter((_, i) => i !== indice))
  }

  async function confirmar() {
    if (!puedeConciliar || !pagoValido) {
      showToast('El pago debe ser de al menos un centavo y no superar el saldo COD por más de un centavo.', 'warning')
      return
    }
    if (payments.some(p => p.metodo === 'Efectivo Bs'
      && (!(getTasaPago(p, tasaEfectiva) > 0) || !(Number(p.monto_bs) > 0)
        || getMontoUsd(p, getTasaPago(p, tasaEfectiva)) <= 0))) {
      showToast('Verifica el monto en bolívares y la tasa seleccionada antes de confirmar.', 'warning')
      return
    }
    if (payments.some(p => !METODOS_EFECTIVO.has(p.metodo) && String(p.referencia || '').trim().length < 4)) {
      showToast('Cada transferencia o pago digital requiere su referencia (mínimo 4 caracteres).', 'warning')
      return
    }

    setLoading(true)
    try {
      const pagosConfirmados = payments.map(p => {
        if (p.metodo !== 'Efectivo Bs') {
          return { ...p, monto: Number(Number(p.monto).toFixed(2)) }
        }
        const tasaPago = getTasaPago(p, tasaEfectiva)
        const snapshot = {
          ...p,
          tasa_snapshot: getTasaSnapshot(tasaPago),
          tasa_fuente: p.tasa_fuente || tasaFuente,
          tasa_actualizada_en: p.tasa_actualizada_en || tasaActualizada || null,
        }
        return {
          metodo: p.metodo,
          monto: getMontoUsd(snapshot, tasaPago),
          monto_bs: round2(p.monto_bs),
          tasa_snapshot: snapshot.tasa_snapshot,
          tasa_fuente: snapshot.tasa_fuente,
          tasa_actualizada_en: snapshot.tasa_actualizada_en,
          referencia: null,
        }
      })
      setPayments(payments.map((payment, index) => payment.metodo === 'Efectivo Bs'
        ? { ...payment, tasa_snapshot: pagosConfirmados[index].tasa_snapshot,
          tasa_fuente: pagosConfirmados[index].tasa_fuente,
          tasa_actualizada_en: pagosConfirmados[index].tasa_actualizada_en }
        : payment))
      const response = await authFetch('/api/despachos/conciliar-cod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          despachoId: despacho.id,
          idempotencyKey,
          pagos: pagosConfirmados,
          evidencia: evidencia.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo registrar el cobro COD')
      showToast(`COD conciliado: ${formatUsd(result.pago_usd)}`, 'success')
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['despachos'] }),
        qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] }),
        qc.invalidateQueries({ queryKey: ['clientes'] }),
      ])
      onClose()
    } catch (error) {
      showToast(error.message || 'Error al conciliar el cobro COD', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !despacho) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Conciliar COD — ${numDisplay}`} className="max-w-md">
      <div className="space-y-4">
        {loadingResumen ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Consultando ledger…
          </div>
        ) : !resumen ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            No se pudo consultar el saldo contable. Cierra y vuelve a abrir el modal.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Saldo COD del ledger</p>
                <p className="text-2xl font-black text-rose-600 dark:text-rose-400">{formatUsd(totalCod)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Estado derivado</p>
                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{cod?.estado || 'manual_review'}</p>
                <p className="text-[11px] text-slate-400">No se usa el flag antiguo como comprobante</p>
              </div>
            </div>

            {esPagoMixto && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-sky-100 bg-sky-50/40 p-3 text-xs dark:border-sky-900/40 dark:bg-sky-950/20">
                <div>
                  <p className="font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">Parte COD · se cobra aquí</p>
                  <p className="text-lg font-black text-slate-700 dark:text-slate-200">{formatUsd(totalCod)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">Parte a crédito · se cobra en CxC</p>
                  <p className="text-lg font-black text-slate-700 dark:text-slate-200">{formatUsd(deudaCxc)}</p>
                  <p className="text-[11px] text-slate-400">Desde la ficha del cliente</p>
                </div>
              </div>
            )}

            {(cod?.revisar || !puedeConciliar) && (
              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Revisión requerida</p>
                  <p>Estado contable: {cod?.estado || 'desconocido'}. No se puede registrar un pago automático hasta resolver la discrepancia.</p>
                  {cod?.motivo_revision && MOTIVOS_REVISION[cod.motivo_revision] && (
                    <p className="mt-1">{MOTIVOS_REVISION[cod.motivo_revision]}</p>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500">
              Cargos COD {formatUsd(codLedger?.cargo_cod_usd)} · abonos aplicados al COD {formatUsd(codLedger?.abono_cod_usd)} · compensaciones registradas {formatUsd(codLedger?.compensado_usd)}
              {desbordeSinMarca > 0 ? ` · desborde sin marca ${formatUsd(desbordeSinMarca)}` : ''}
            </p>

            {puedeConciliar && (
              <>
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Dinero recibido</h4>
                  {payments.map((payment, index) => (
                    <div key={`${payment.metodo}-${index}`} className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/40 p-3 dark:border-sky-900/40 dark:bg-sky-950/20">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-sky-700 dark:text-sky-300">{payment.metodo}</span>
                        <button type="button" aria-label={`Quitar ${payment.metodo}`} onClick={() => eliminarPago(index)} className="rounded p-1 text-sky-500 hover:bg-sky-100">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        {payment.metodo === 'Efectivo Bs' ? (
                          <input aria-label="Monto Efectivo Bs" type="number" min="0.01" step="0.01" value={payment.monto_bs} onChange={event => actualizarPago(index, { monto_bs: event.target.value })} placeholder="Monto recibido (Bs)" className="w-full rounded-lg border px-2 py-2 text-sm" />
                        ) : (
                          <input aria-label={`Monto ${payment.metodo}`} type="number" min="0.01" step="0.01" value={payment.monto} onChange={event => actualizarPago(index, { monto: event.target.value })} className="w-1/3 rounded-lg border px-2 py-2 text-sm" />
                        )}
                        {!METODOS_EFECTIVO.has(payment.metodo) && (
                          <input aria-label={`Referencia ${payment.metodo}`} value={payment.referencia} onChange={event => actualizarPago(index, { referencia: event.target.value })} placeholder="Referencia obligatoria (mínimo 4)" className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm" />
                        )}
                      </div>
                      {payment.metodo === 'Efectivo Bs' && (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          Tasa seleccionada: {getTasaPago(payment, tasaEfectiva) > 0 ? `${getTasaSnapshot(getTasaPago(payment, tasaEfectiva))} Bs/$ (${payment.tasa_fuente || tasaFuente})` : 'no disponible'} · Equivalente: {formatUsd(getMontoUsd(payment, getTasaPago(payment, tasaEfectiva)))}
                        </p>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1.5">
                    {metodosPermitidos.filter(method => !payments.some(p => p.metodo === method)).map(method => (
                      <button key={method} type="button" onClick={() => agregarMetodo(method)} className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        <Plus size={11} /> {method}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Nota (opcional)</span>
                  <textarea value={evidencia} onChange={event => setEvidencia(event.target.value)} maxLength={500} rows={2} placeholder="Nro. recibo, referencia bancaria, quién recibió y cuándo… (opcional)" className="w-full rounded-xl border px-3 py-2 text-sm" />
                </label>

                {payments.some(p => p.metodo === 'Efectivo Bs') && tasaEfectiva > 0 && (
                  <p className="text-xs text-slate-500">Tasa usada al confirmar: {getTasaSnapshot(tasaEfectiva)} Bs/$ · La conversión de este abono quedará fija.</p>
                )}
                <div className={"flex justify-between rounded-lg px-3 py-2 text-sm " + (pagoValido ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
                  <span>Ingresado {formatUsd(totalIngresado)} · saldo después {formatUsd(Math.max(0, totalCod - totalIngresado))}</span>
                  <span>{!pagosConPrecisionValida ? 'Usa máximo dos decimales' : !pagoValido ? 'Monto inválido' : coincide ? (excedente > 0 ? `Liquida COD · excede ${formatUsd(excedente)}` : 'Liquida COD') : 'Pago parcial'}</span>
                </div>
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={loading} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={loading || loadingResumen || !resumen || !puedeConciliar || !pagoValido || payments.length === 0} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50">
            {loading && <Loader2 size={12} className="animate-spin" />}
            Registrar abono COD
          </button>
        </div>
      </div>
    </Modal>
  )
}
