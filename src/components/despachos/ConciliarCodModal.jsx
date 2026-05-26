// src/components/despachos/ConciliarCodModal.jsx
import { useState, useEffect } from 'react'
import { X, Plus, Loader2, AlertCircle } from 'lucide-react'
import { useRegistrarAbono } from '../../hooks/useCuentasCobrar'
import { Modal } from '../ui/Modal'
import { showToast } from '../ui/Toast'
import { FORMAS_PAGO } from '../../constants/formasPago'
import { authFetch } from '../../services/authFetch'
import { useQueryClient } from '@tanstack/react-query'

export default function ConciliarCodModal({ isOpen, onClose, despacho }) {
  const qc = useQueryClient()
  const registrarAbono = useRegistrarAbono()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [codMethod, setCodMethod] = useState(null)
  const [formasPagoOriginales, setFormasPagoOriginales] = useState([])
  const [hasPropuesto, setHasPropuesto] = useState(false)

  // Parse methods on load
  useEffect(() => {
    if (!despacho || !isOpen) return

    let fps = []
    try {
      fps = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
      if (!Array.isArray(fps)) fps = []
    } catch {
      fps = []
    }
    setFormasPagoOriginales(fps)

    const cod = fps.find(f => f.metodo === 'Cobro a destino')
    if (cod) {
      setCodMethod(cod)
      // Initialize payments from metodo_propuesto if it exists, otherwise default to full amount in Efectivo $
      if (Array.isArray(cod.metodo_propuesto) && cod.metodo_propuesto.length > 0) {
        setHasPropuesto(true)
        setPayments(cod.metodo_propuesto.map(p => ({
          metodo: p.metodo === 'Efectivo' ? 'Efectivo $' : (p.metodo || 'Efectivo $'),
          monto: Number(p.monto) || 0,
          referencia: p.referencia || ''
        })))
      } else {
        setHasPropuesto(false)
        setPayments([{ metodo: 'Efectivo $', monto: Number(cod.monto) || 0, referencia: '' }])
      }
    } else {
      setCodMethod(null)
      setHasPropuesto(false)
      setPayments([])
    }
  }, [despacho, isOpen])

  if (!isOpen || !despacho || !codMethod) return null

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`

  const totalCod = Number(codMethod.monto) || 0
  const totalReconciled = payments.reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
  const difference = totalReconciled - totalCod
  const isSquare = Math.abs(difference) < 0.02

  const allowedMethods = FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar')

  function toggleForma(metodo) {
    setPayments(prev => {
      const existe = prev.some(p => p.metodo === metodo)
      if (existe) return prev.filter(p => p.metodo !== metodo)

      const remaining = Math.max(0, totalCod - totalReconciled)
      const montoInicial = remaining > 0 ? Number(remaining.toFixed(2)) : ''
      return [...prev, { metodo, monto: montoInicial, referencia: '' }]
    })
  }

  function setMontoForma(metodo, monto) {
    setPayments(prev => prev.map(p => p.metodo === metodo ? { ...p, monto } : p))
  }

  function setReferenciaForma(metodo, referencia) {
    setPayments(prev => prev.map(p => p.metodo === metodo ? { ...p, referencia } : p))
  }

  async function handleConfirm() {
    if (!isSquare) {
      showToast(`La suma de los pagos ($${totalReconciled.toFixed(2)}) debe coincidir con el total COD ($${totalCod.toFixed(2)})`, 'warning')
      return
    }

    setLoading(true)
    try {
      // 1. Register Abonos for each payment entry
      for (const p of payments) {
        if (Number(p.monto) <= 0) continue
        await registrarAbono.mutateAsync({
          clienteId: despacho.cliente_id,
          monto: Number(p.monto),
          formaPago: p.metodo,
          referencia: p.referencia || null,
          descripcion: `COD Despacho ${numDisplay}`,
          despachoId: despacho.id
        })
      }

      // 2. Mark the COD payment method as paid in the despacho JSON
      const updatedFormasPago = formasPagoOriginales.map(f => {
        if (f.metodo === 'Cobro a destino') {
          return {
            ...f,
            cobro_destino_pagado: true,
            metodos_pagados: payments
          }
        }
        return f
      })

      // 3. Save the updated forma_pago back to database using worker endpoint
      const res = await authFetch('/api/despachos/editar-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          despachoId: despacho.id,
          formaPago: JSON.stringify(updatedFormasPago),
          formaPagoCliente: JSON.stringify(updatedFormasPago)
        })
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Error al actualizar forma de pago del despacho')
      }

      showToast('Cobro a destino conciliado y pagado exitosamente', 'success')
      qc.invalidateQueries({ queryKey: ['despachos'] })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] })
      qc.invalidateQueries({ queryKey: ['clientes'] })
      onClose()
    } catch (err) {
      showToast(err.message || 'Error al conciliar cobro a destino', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Conciliar COD — ${numDisplay}`} className="max-w-md">
      <div className="space-y-4">
        {/* Banner Total COD */}
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Total a Cobrar</p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              ${totalCod.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Registrado</p>
            <p className={`text-xl font-bold ${isSquare ? 'text-emerald-600' : 'text-amber-500'}`}>
              ${totalReconciled.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Banner Intento Previo */}
        {hasPropuesto && (
          <div className="flex gap-2.5 items-start bg-indigo-50/70 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30 text-indigo-900 dark:text-indigo-300 text-xs transition-all">
            <span className="text-base leading-none mt-0.5">✨</span>
            <div>
              <p className="font-bold text-indigo-950 dark:text-indigo-200">Pago previo auto-completado</p>
              <p className="text-indigo-850 dark:text-indigo-350 mt-0.5 leading-relaxed">
                Hemos pre-cargado los métodos del intento anterior para ahorrarte tiempo. Revísalos o edítalos libremente antes de confirmar.
              </p>
            </div>
          </div>
        )}

        {/* List of Payments */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Métodos de Pago Recibidos</h4>

          <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
            {payments.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4 bg-slate-50/30 dark:bg-slate-800/10 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                No hay métodos de pago agregados. Selecciona uno abajo.
              </p>
            ) : (
              payments.map((p) => {
                const restante = totalCod - totalReconciled
                return (
                  <div key={p.metodo} className="space-y-2 bg-sky-50/40 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40 p-3 rounded-xl transition-all">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-sky-700 dark:text-sky-350 shrink-0 truncate">
                        {p.metodo}
                      </span>
                      <button 
                        type="button" 
                        onClick={() => toggleForma(p.metodo)}
                        className="p-1 rounded-lg hover:bg-sky-100/50 dark:hover:bg-sky-900/40 text-sky-400 hover:text-sky-600 dark:text-sky-500 dark:hover:text-sky-350 transition-colors shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-2">
                      {/* Monto Input */}
                      <div className="relative flex-1 flex items-center">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={p.monto}
                          onChange={e => setMontoForma(p.metodo, e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0.00"
                          className="w-full pl-6 pr-16 py-1.5 rounded-lg text-xs font-semibold border border-sky-100 dark:border-sky-850 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        />
                        {restante > 0.01 && (
                          <button
                            type="button"
                            onClick={() => setMontoForma(p.metodo, Number(((Number(p.monto) || 0) + restante).toFixed(2)))}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-md transition-colors shrink-0"
                            title={`Completar con $${restante.toFixed(2)} restante`}
                          >
                            Restante
                          </button>
                        )}
                      </div>

                      {/* Referencia Input */}
                      {p.metodo !== 'Efectivo $' && p.metodo !== 'Efectivo Bs' && (
                        <input
                          type="text"
                          value={p.referencia}
                          onChange={e => setReferenciaForma(p.metodo, e.target.value)}
                          placeholder="Ref (opcional)"
                          className="flex-1 min-w-[100px] px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-sky-100 dark:border-sky-850 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        />
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Chips de Métodos Inactivos */}
        {allowedMethods.some(m => !payments.find(f => f.metodo === m)) && (
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Agregar Método de Pago
            </label>
            <div className="flex flex-wrap gap-1.5">
              {allowedMethods
                .filter(m => !payments.find(f => f.metodo === m))
                .map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleForma(m)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-650 transition-all active:scale-95 shadow-sm"
                  >
                    <Plus size={11} strokeWidth={2.5} className="text-slate-400" />
                    {m}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Warning Alert if mismatch */}
        {!isSquare && (
          <div className="flex gap-2 items-start bg-amber-50 dark:bg-amber-950/20 p-3 rounded-xl border border-amber-100 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Monto no coincide</p>
              <p>
                Faltan <span className="font-bold">${Math.abs(difference).toFixed(2)}</span> para cuadrar el cobro a destino.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !isSquare}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-md shadow-indigo-600/10"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            Confirmar Pago
          </button>
        </div>
      </div>
    </Modal>
  )
}
