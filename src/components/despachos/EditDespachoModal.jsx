// src/components/despachos/EditDespachoModal.jsx
// Modal para editar forma de pago, transportista y notas de un despacho pendiente
import { useState, useEffect } from 'react'
import { X, Pencil, Loader2, Truck, ChevronDown, StickyNote, Plus, User, Clock } from 'lucide-react'
import { useTransportistas, useCrearTransportista } from '../../hooks/useTransportistas'
import { useEditarDespacho } from '../../hooks/useDespachos'
import { useClientes } from '../../hooks/useClientes'
import { useFormasPago } from '../../hooks/useFormasPago'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import CustomSelect from '../ui/CustomSelect'
import TransportistaFormCompact from '../transportistas/TransportistaFormCompact'
import ClienteForm from '../clientes/ClienteForm'
import { Modal } from '../ui/Modal'
import { showToast } from '../ui/Toast'

import { FORMAS_PAGO } from '../../constants/formasPago'


export default function EditDespachoModal({ isOpen, onClose, despacho }) {
  const { data: transportistas = [] } = useTransportistas()
  const { data: clientes = [] } = useClientes()
  const editarDespacho = useEditarDespacho()
  const crearTransp = useCrearTransportista()

  const [clienteId, setClienteId] = useState('')
  const [referenciaPago, setReferenciaPago] = useState('')
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [corteUsd, setCorteUsd] = useState('')
  const [notas, setNotas] = useState('')
  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [nuevoError, setNuevoError] = useState('')

  // 1. Cálculos derivados (necesarios para el hook)
  const totalBase = Number(despacho?.total_usd || 0) - Number(despacho?.flete_usd || 0) - Number(despacho?.corte_usd || 0)
  const totalParaPago = totalBase + (Number(corteUsd) || 0)
  const totalConFlete = totalParaPago + (Number(fleteUsd) || 0)

  // 2. Hook de formas de pago
  const {
    formasPago, setFormas, toggleForma, setMontoForma, updateForma,
    totalAsignado, pagoCuadrado, diferencia, hayVuelto, faltante
  } = useFormasPago(totalConFlete)

  // 3. Inicializar valores del despacho actual
  useEffect(() => {
    if (!despacho || !isOpen) return
    // Parsear forma de pago
    try {
      const fp = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
      if (Array.isArray(fp)) setFormas(fp)
      else setFormas([])
    } catch { setFormas([]) }
    setReferenciaPago(despacho.referencia_pago || '')
    setTransportistaId(despacho.transportista_id || '')
    setFleteUsd(despacho.flete_usd ? String(Number(despacho.flete_usd)) : '')
    setCorteUsd(despacho.corte_usd ? String(Number(despacho.corte_usd)) : '')
    setNotas(despacho.notas || '')
    setClienteId(despacho.cliente_id || '')
  }, [despacho, isOpen, setFormas])

  if (!isOpen || !despacho) return null

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`


  async function handleGuardar() {
    const fpJson = JSON.stringify(formasPago)
    await editarDespacho.mutateAsync({
      despachoId: despacho.id,
      formaPago: fpJson,
      formaPagoCliente: fpJson,
      referenciaPago: referenciaPago || null,
      transportistaId: transportistaId || null,
      fleteUsd: Number(fleteUsd) || 0,
      corteUsd: Number(corteUsd) || 0,
      notas: notas || null,
      clienteId: clienteId || null,
    })
    onClose()
  }

  const cargando = editarDespacho.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-2xl p-4 sm:p-8 max-h-[90vh] flex flex-col gap-4">

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
        <div className="flex-1 min-h-0 overflow-y-auto pb-24 space-y-5">

          {/* ── 0. Cliente ── */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente (Facturar a nombre de...)</p>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <CustomSelect
                  value={clienteId}
                  onChange={setClienteId}
                  options={clientes.map(c => ({
                    value: c.id,
                    label: c.nombre,
                    sub: c.rif_cedula
                  }))}
                  placeholder="Seleccionar cliente..."
                  disabled={cargando}
                  searchable
                  icon={User}
                />
              </div>
              <button type="button"
                onClick={() => setShowNuevoCliente(true)}
                disabled={cargando}
                className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                title="Crear nuevo cliente">
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>
          </div>

          {/* ── 1. Transportista ── */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transportista</p>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <CustomSelect
                  value={transportistaId}
                  onChange={(v) => {
                    setTransportistaId(v)
                    if (!v) setFleteUsd('')
                  }}
                  showSubInTrigger={false}
                  options={transportistas.map(t => ({
                    value: t.id,
                    label: `${t.nombre}${t.rif ? ` (${t.rif})` : ''}`,
                    selectedLabel: t.nombre,
                    sub: [t.vehiculo, t.placa_chuto ? `Placas: ${t.placa_chuto}${t.placa_batea ? `/${t.placa_batea}` : ''}` : '', t.color].filter(Boolean).join(' · ') || undefined
                  }))}
                  placeholder="Seleccionar transportista..."
                  disabled={cargando}
                  searchable
                  clearable
                  icon={Truck}
                />
              </div>
              <button type="button"
                onClick={() => setShowNuevoTransp(v => !v)}
                disabled={cargando}
                className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                title="Crear nuevo transportista">
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>

            {showNuevoTransp && (
              <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-lg p-3 sm:p-4 space-y-3">
                <p className="text-sm font-bold text-emerald-700">Nuevo transportista</p>
                {nuevoError && <p className="text-xs text-red-500 font-medium">{nuevoError}</p>}
                <TransportistaFormCompact
                  cargando={crearTransp.isPending}
                  onCancelar={() => { setShowNuevoTransp(false); setNuevoError('') }}
                  onGuardar={async (campos) => {
                    setNuevoError('')
                    try {
                      const nuevo = await crearTransp.mutateAsync(campos)
                      const idNuevo = nuevo.transportista?.id || nuevo.id
                      if (!idNuevo) throw new Error('No se pudo obtener el ID del transportista creado')
                      
                      setTransportistaId(idNuevo)
                      setShowNuevoTransp(false)
                      showToast.success('Transportista creado y seleccionado')
                    } catch (e) {
                      const msg = e.message || 'Error al crear'
                      setNuevoError(msg)
                      showToast.error(msg)
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* ── 2. Flete (solo si hay transportista) ── */}
          {transportistaId && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monto del flete (USD)</p>
              <input
                type="number" min="0" step="0.01" value={fleteUsd}
                onChange={e => setFleteUsd(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white transition-colors min-h-[44px]"
                disabled={cargando}
              />
              {Number(fleteUsd) > 0 && (
                <p className="text-xs text-indigo-500 font-medium">
                  + Flete: ${Number(fleteUsd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
          )}

          {/* ── 3. Forma de pago ── */}
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
                {formasPago.map(fp => {
                  const restante = totalConFlete - formasPago.reduce((s, f) => s + (Number(f.monto) || 0), 0)
                  const mostrarResto = formasPago.length > 1 && (!fp.monto || Number(fp.monto) === 0) && restante > 0.01
                  return (
                  <div key={fp.metodo} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-600 w-28 truncate">{fp.metodo}</span>
                      <div className="relative flex-1 flex items-center">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={fp.monto}
                          onChange={e => setMontoForma(fp.metodo, e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0.00"
                          className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white"
                          disabled={cargando}
                        />
                        {mostrarResto && (
                          <button type="button"
                            onClick={() => setMontoForma(fp.metodo, Number(restante.toFixed(2)))}
                            className="ml-1 px-2 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors shrink-0"
                            title={`Asignar $${restante.toFixed(2)} restante`}>
                            Resto
                          </button>
                        )}
                      </div>
                    </div>
                    {fp.metodo === 'Cta por cobrar' && (
                      <div className="flex items-center gap-2 pl-28">
                        <span className="text-xs text-slate-500 font-medium">Días venc.:</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={fp.diasVencimiento ?? ''}
                          onChange={e => updateForma(fp.metodo, { diasVencimiento: e.target.value ? parseInt(e.target.value) : null })}
                          placeholder="Opcional"
                          className="w-24 px-2 py-1.5 rounded-lg text-xs border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white"
                          disabled={cargando}
                        />
                      </div>
                    )}
                  </div>
                  )
                })}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${
                  pagoCuadrado
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : hayVuelto
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-red-50 text-red-600 border border-red-200'
                }`}>
                  <span>Asignado: ${totalAsignado.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span>Total (con flete): ${totalConFlete.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {pagoCuadrado
                    ? <span className="text-emerald-500">✓</span>
                    : hayVuelto
                      ? <span className="text-amber-600">Sobran ${diferencia.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      : <span className="text-red-400">Faltan ${Math.abs(diferencia).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  }
                </div>
              </div>
            )}
            {formasPago.length === 0 && (
              <p className="text-xs text-slate-400">Selecciona al menos una forma de pago</p>
            )}
          </div>

          {/* ── 4. Notas ── */}

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <StickyNote size={13} /> Notas / observaciones
            </p>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Observaciones adicionales..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white resize-none"
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

      {/* Modal: Nuevo Cliente */}
      <Modal 
        isOpen={showNuevoCliente} 
        onClose={() => setShowNuevoCliente(false)} 
        title="Nuevo cliente"
        className="sm:max-w-2xl"
      >
        <ClienteForm 
          onSuccess={(nuevo) => {
            const cid = nuevo?.cliente?.id || nuevo?.id
            if (cid) setClienteId(cid)
            setShowNuevoCliente(false)
          }}
          onCancel={() => setShowNuevoCliente(false)}
        />
      </Modal>

    </div>
  )
}
