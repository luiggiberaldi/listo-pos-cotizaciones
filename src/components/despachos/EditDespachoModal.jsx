// src/components/despachos/EditDespachoModal.jsx
// Modal para editar forma de pago, transportista y notas de un despacho pendiente
import { useState, useEffect } from 'react'
import { X, Pencil, Loader2, Truck, ChevronDown, StickyNote } from 'lucide-react'
import { useTransportistas } from '../../hooks/useTransportistas'
import { useEditarDespacho } from '../../hooks/useDespachos'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'

const FORMAS_PAGO = ['Efectivo', 'Zelle', 'Pago Móvil', 'USDT', 'Transferencia', 'Cta por cobrar']

export default function EditDespachoModal({ isOpen, onClose, despacho }) {
  const { data: transportistas = [] } = useTransportistas()
  const editarDespacho = useEditarDespacho()

  const [formasPago, setFormasPago] = useState([])
  const [referenciaPago, setReferenciaPago] = useState('')
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [notas, setNotas] = useState('')
  const [showTransportistaMenu, setShowTransportistaMenu] = useState(false)

  // Inicializar valores del despacho actual
  useEffect(() => {
    if (!despacho || !isOpen) return
    // Parsear forma de pago
    try {
      const fp = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
      if (Array.isArray(fp)) setFormasPago(fp)
      else setFormasPago([])
    } catch { setFormasPago([]) }
    setReferenciaPago(despacho.referencia_pago || '')
    setTransportistaId(despacho.transportista_id || '')
    setFleteUsd(despacho.flete_usd ? String(Number(despacho.flete_usd)) : '')
    setNotas(despacho.notas || '')
  }, [despacho, isOpen])

  if (!isOpen || !despacho) return null

  const totalBase = Number(despacho.total_usd || 0) - Number(despacho.flete_usd || 0)
  const totalConFlete = totalBase + (Number(fleteUsd) || 0)
  const montoAsignado = formasPago.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
  const pagoCuadrado = formasPago.length > 0 && Math.abs(montoAsignado - totalConFlete) < 0.02

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`

  const toggleForma = (metodo) => {
    setFormasPago(prev => {
      const existe = prev.find(fp => fp.metodo === metodo)
      if (existe) return prev.filter(fp => fp.metodo !== metodo)
      const restante = totalConFlete - prev.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
      return [...prev, { metodo, monto: restante > 0 ? Number(restante.toFixed(2)) : '' }]
    })
  }

  const setMontoForma = (metodo, monto) => {
    setFormasPago(prev => prev.map(fp => fp.metodo === metodo ? { ...fp, monto } : fp))
  }

  async function handleGuardar() {
    const fpJson = JSON.stringify(formasPago)
    await editarDespacho.mutateAsync({
      despachoId: despacho.id,
      formaPago: fpJson,
      formaPagoCliente: fpJson,
      referenciaPago: referenciaPago || null,
      transportistaId: transportistaId || null,
      fleteUsd: Number(fleteUsd) || 0,
      notas: notas || null,
    })
    onClose()
  }

  const cargando = editarDespacho.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg p-4 sm:p-6 max-h-[90vh] flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <Pencil size={20} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg">Editar despacho</h3>
              <p className="text-sm text-slate-500 font-mono">{numDisplay}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">

          {/* Forma de pago */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Formas de pago <span className="text-red-500">*</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {FORMAS_PAGO.map(fp => {
                const activo = formasPago.some(f => f.metodo === fp)
                return (
                  <button key={fp} type="button"
                    onClick={() => toggleForma(fp)}
                    disabled={cargando}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all min-h-[44px] ${
                      activo
                        ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                    }`}>
                    {fp}
                  </button>
                )
              })}
            </div>

            {formasPago.length > 0 && (
              <div className="space-y-2 mt-2">
                {formasPago.map(fp => (
                  <div key={fp.metodo} className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-600 w-28 truncate">{fp.metodo}</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={fp.monto}
                        onChange={e => setMontoForma(fp.metodo, e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
                        disabled={cargando}
                      />
                    </div>
                  </div>
                ))}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${
                  pagoCuadrado
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-600 border border-red-200'
                }`}>
                  <span>Asignado: ${montoAsignado.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span>Total: ${totalConFlete.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {pagoCuadrado
                    ? <span className="text-emerald-500">✓</span>
                    : <span className="text-red-400">Faltan ${(totalConFlete - montoAsignado).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  }
                </div>
              </div>
            )}
            {formasPago.length === 0 && (
              <p className="text-xs text-slate-400">Selecciona al menos una forma de pago</p>
            )}
          </div>

          {/* Referencia de pago */}
          {formasPago.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Referencia / comprobante (opcional)</label>
              <input
                type="text"
                value={referenciaPago}
                onChange={e => setReferenciaPago(e.target.value)}
                placeholder="Nº confirmación, comprobante..."
                className="w-full px-3 py-2.5 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white min-h-[44px]"
                disabled={cargando}
              />
            </div>
          )}

          {/* Transportista */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transportista</p>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTransportistaMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowTransportistaMenu(false), 200)}
                disabled={cargando}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-slate-50 hover:border-indigo-300 transition-colors text-left min-h-[44px]"
              >
                <span className="flex items-center gap-2 truncate">
                  <Truck size={15} className="text-slate-400 shrink-0" />
                  {transportistaId
                    ? <span className="text-slate-700">{transportistas.find(t => t.id === transportistaId)?.nombre || 'Seleccionado'}</span>
                    : <span className="text-slate-400">Sin transportista (opcional)</span>
                  }
                </span>
                <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${showTransportistaMenu ? 'rotate-180' : ''}`} />
              </button>
              {showTransportistaMenu && (
                <div className="absolute left-0 right-0 bottom-full mb-1 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20 max-h-48 overflow-y-auto"
                  onMouseDown={e => e.preventDefault()}>
                  <button
                    onClick={() => { setTransportistaId(''); setFleteUsd(''); setShowTransportistaMenu(false) }}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                      !transportistaId ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    Sin transportista
                  </button>
                  {transportistas.map(t => (
                    <button key={t.id}
                      onClick={() => { setTransportistaId(t.id); setShowTransportistaMenu(false) }}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                        transportistaId === t.id ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{t.nombre}</p>
                        {(t.vehiculo || t.placa_chuto) && (
                          <p className="text-xs text-slate-400 truncate">
                            {[t.vehiculo, t.placa_chuto].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      {transportistaId === t.id && <span className="text-indigo-500 shrink-0">✓</span>}
                    </button>
                  ))}
                  {transportistas.length === 0 && (
                    <p className="px-4 py-2.5 text-sm text-slate-400">No hay transportistas registrados</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Flete */}
          {transportistaId && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monto del flete (USD)</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fleteUsd}
                onChange={e => setFleteUsd(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 focus:bg-white transition-colors min-h-[44px]"
                disabled={cargando}
              />
              {Number(fleteUsd) > 0 && (
                <p className="text-xs text-indigo-500 font-medium">
                  Total con flete: ${totalConFlete.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
          )}

          {/* Notas */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <StickyNote size={13} /> Notas / observaciones
            </p>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Observaciones adicionales..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white resize-none"
              disabled={cargando}
            />
          </div>

        </div>{/* fin scrollable */}

        {/* Botones */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button onClick={onClose} disabled={cargando}
            className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-base hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleGuardar} disabled={cargando || !pagoCuadrado}
            title={formasPago.length === 0 ? 'Selecciona forma de pago' : !pagoCuadrado ? 'Los montos no cuadran con el total' : undefined}
            className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20">
            {cargando
              ? <><Loader2 size={16} className="animate-spin" />Guardando...</>
              : <><Pencil size={16} />Guardar cambios</>}
          </button>
        </div>
      </div>
    </div>
  )
}
