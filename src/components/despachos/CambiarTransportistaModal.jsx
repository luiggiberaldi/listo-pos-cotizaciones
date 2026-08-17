// src/components/despachos/CambiarTransportistaModal.jsx
import { useState, useEffect } from 'react'
import { X, Truck, Plus, Loader2, MapPin, Building } from 'lucide-react'
import { useTransportistas, useCrearTransportista } from '../../hooks/useTransportistas'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { useEditarDespacho } from '../../hooks/useDespachos'
import CustomSelect from '../ui/CustomSelect'
import TransportistaFormCompact from '../transportistas/TransportistaFormCompact'
import { Modal } from '../ui/Modal'
import { showToast } from '../ui/Toast'
import { ESTADOS, getCiudades } from '../../data/venezuelaGeo'

export default function CambiarTransportistaModal({ isOpen, onClose, despacho }) {
  const { data: transportistas = [] } = useTransportistas()
  const { data: config = {} } = useConfigNegocio()
  const editarDespacho = useEditarDespacho()
  const crearTransp = useCrearTransportista()

  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [estadoDestino, setEstadoDestino] = useState('')
  const [ciudadDestino, setCiudadDestino] = useState('')
  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const [nuevoError, setNuevoError] = useState('')

  const tieneTransportista = !!despacho?.transportista_id
  const accionTitulo = tieneTransportista ? 'Cambiar' : 'Agregar'

  useEffect(() => {
    if (!despacho || !isOpen) return
    setTransportistaId(despacho.transportista_id || '')
    setFleteUsd(despacho.flete_usd !== null && despacho.flete_usd !== undefined ? String(despacho.flete_usd) : '')
    setEstadoDestino(despacho.flete_estado_destino_snapshot || despacho.direccion_envio_estado || despacho.cliente?.estado || '')
    setCiudadDestino(despacho.direccion_envio_ciudad || despacho.cliente?.ciudad || '')
    setShowNuevoTransp(false)
    setNuevoError('')
  }, [despacho, isOpen])

  const cargando = editarDespacho.isPending

  // ── Preview de comisión externa / nómina Carabobo (config global) ──
  const transportistaSel = transportistas.find(t => t.id === transportistaId)
  const esLocal = !!transportistaSel?.es_local
  const fleteNum = Number(fleteUsd) || 0
  const tipoCalculo = config.transp_tipo_calculo === 'fija' ? 'fija' : 'porcentaje'
  const pctComision = Number(config.transp_pct_comision) || 0
  const tarifaFija  = Number(config.transp_tarifa_fija_usd) || 0
  const estadoNormalizado = String(estadoDestino).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const esFueraCarabobo = !!estadoDestino && estadoNormalizado !== 'carabobo'
  let netoPreview = 0
  if (esLocal && esFueraCarabobo && fleteNum > 0) {
    netoPreview = tipoCalculo === 'fija'
      ? Math.min(tarifaFija, fleteNum)
      : Math.round(fleteNum * pctComision / 100 * 100) / 100
  }
  const descripcionPreview = !estadoDestino
    ? 'Debe indicar el estado de destino si hay flete.'
    : esFueraCarabobo
      ? (tipoCalculo === 'porcentaje'
        ? `${pctComision}% del flete fuera de Carabobo`
        : `Tarifa fija $${tarifaFija.toFixed(2)} fuera de Carabobo`)
      : 'Destino en Carabobo: se procesa por nómina externa'

  async function handleGuardar(e) {
    if (e) e.preventDefault()
    try {
      await editarDespacho.mutateAsync({
        despachoId: despacho.id,
        transportistaId: transportistaId || null,
        fleteUsd: fleteUsd !== '' ? Number(fleteUsd) : 0,
        direccionEnvioEstado: estadoDestino || null,
        direccionEnvioCiudad: ciudadDestino || null,
      })
      onClose()
    } catch {
      // useEditarDespacho displays its own toast error
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} width="max-w-md">
      <div className="flex flex-col h-full max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Truck size={16} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">{accionTitulo} Transportista</h3>
              <p className="text-[11px] text-slate-500 font-semibold">
                Despacho #{despacho?.numero || despacho?.id?.slice(0, 8)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Seleccionar Transportista</p>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <CustomSelect
                  value={transportistaId}
                  onChange={setTransportistaId}
                  showSubInTrigger={false}
                  options={transportistas.map(t => ({
                    value: t.id,
                    label: `${t.nombre}${t.es_local ? ' · LOCAL' : ''}${t.rif ? ` (${t.rif})` : ''}`,
                    selectedLabel: t.nombre,
                    sub: [t.vehiculo, t.placa_chuto ? `Placas: ${t.placa_chuto}${t.placa_batea ? `/${t.placa_batea}` : ''}` : '', t.color, t.es_local ? 'Local' : null].filter(Boolean).join(' · ') || undefined
                  }))}
                  placeholder="Seleccionar transportista..."
                  disabled={cargando}
                  searchable
                  clearable
                  icon={Truck}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowNuevoTransp(v => !v)}
                disabled={cargando}
                className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                title="Crear nuevo transportista"
              >
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>

            {/* ── Preview de comisión externa / nómina local ── */}
            {esLocal && (
              <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                <span className="font-bold">Chofer local</span> ·{' '}
                <span className={!estadoDestino ? 'text-red-700 font-semibold' : ''}>{descripcionPreview}</span>
                {esFueraCarabobo && fleteNum > 0 && (
                  <span className="block mt-0.5 text-amber-900 font-semibold">
                    → Comisión a pagar: <span className="font-black">${netoPreview.toFixed(2)}</span>
                  </span>
                )}
              </div>
            )}
            {!esLocal && transportistaSel && (
              <div className="mt-1 text-[11px] text-slate-500">
                Transportista propio del negocio (no se le paga neto del flete).
              </div>
            )}

            {showNuevoTransp && (
              <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-lg p-3 sm:p-4 space-y-3 mt-3">
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

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Flete ($ USD)</p>
            <input
              type="number"
              step="0.01"
              value={fleteUsd}
              onChange={e => setFleteUsd(e.target.value)}
              disabled={cargando}
              placeholder="Monto del flete..."
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            />
          </div>

          {esLocal && fleteNum > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin size={13} /> Estado de destino requerido
              </p>
              <div className="grid grid-cols-2 gap-2">
                <CustomSelect
                  options={ESTADOS.map(e => ({ value: e, label: e }))}
                  value={estadoDestino}
                  onChange={value => { setEstadoDestino(value); setCiudadDestino('') }}
                  placeholder="Elegir estado..."
                  icon={MapPin}
                  searchable
                  disabled={cargando}
                />
                <CustomSelect
                  options={(estadoDestino ? getCiudades(estadoDestino) : []).map(c => ({ value: c, label: c }))}
                  value={ciudadDestino}
                  onChange={setCiudadDestino}
                  placeholder={estadoDestino ? 'Elegir ciudad...' : 'Falta estado'}
                  icon={Building}
                  searchable
                  disabled={cargando || !estadoDestino}
                />
              </div>
              <p className="text-[10px] text-slate-500">
                Si no se indica una dirección alternativa, se usará el estado del cliente.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={cargando}
            className="px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleGuardar}
            disabled={cargando || (esLocal && fleteNum > 0 && !estadoDestino)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 rounded-lg transition-all"
          >
            {cargando ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Guardando...
              </>
            ) : (
              `${accionTitulo} Transportista`
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
