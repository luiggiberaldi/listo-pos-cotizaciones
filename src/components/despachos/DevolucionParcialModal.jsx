import { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { AlertCircle, RotateCcw, FileText, CheckCircle, Package } from 'lucide-react'
import CustomSelect from '../ui/CustomSelect'
import supabase from '../../services/supabase/client'
import { useDevolucionParcialDespacho } from '../../hooks/useDespachos'
import { showToast } from '../ui/Toast'

export default function DevolucionParcialModal({ isOpen, onClose, despacho }) {
  const [loading, setLoading] = useState(false)
  const [itemsList, setItemsList] = useState([])
  const [motivoSelect, setMotivoSelect] = useState('')
  const [motivoText, setMotivoText] = useState('')
  const [generarReemplazo, setGenerarReemplazo] = useState(false)
  const [confirmarKardex, setConfirmarKardex] = useState(false)

  const lastValuesRef = useRef({})
  const mutation = useDevolucionParcialDespacho()

  useEffect(() => {
    if (isOpen && despacho?.id) {
      setItemsList([])
      setMotivoSelect('')
      setMotivoText('')
      setGenerarReemplazo(false)
      setConfirmarKardex(false)
      lastValuesRef.current = {}
      fetchItemsAndDevoluciones()
    }
  }, [isOpen, despacho])

  const fetchItemsAndDevoluciones = async () => {
    setLoading(true)
    try {
      const [itemsRes, devRes] = await Promise.all([
        supabase.from('notas_despacho_items').select('*').eq('despacho_id', despacho.id).order('orden', { ascending: true }),
        supabase.from('despacho_devoluciones').select('despacho_item_id, cantidad_devuelta').eq('despacho_id', despacho.id)
      ])

      if (itemsRes.error) throw itemsRes.error
      if (devRes.error) throw devRes.error

      const itemsData = itemsRes.data || []
      const devData = devRes.data || []

      const returnedQtyMap = {}
      devData.forEach(d => {
        returnedQtyMap[d.despacho_item_id] = (returnedQtyMap[d.despacho_item_id] || 0) + Number(d.cantidad_devuelta)
      })

      const mappedItems = itemsData.map(item => {
        const alreadyReturned = returnedQtyMap[item.id] || 0
        const maxReturnable = Number(item.cantidad) - alreadyReturned
        return {
          ...item,
          alreadyReturned,
          maxReturnable: Math.max(0, maxReturnable),
          cantidad_devolver: '',
          selected: false
        }
      })

      setItemsList(mappedItems)
    } catch (err) {
      console.error('[DEVOLUCION_MODAL] Error al cargar detalles:', err)
      showToast('Error al cargar productos del despacho', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCheckboxChange = (id) => {
    setItemsList(prev => prev.map(item => {
      if (item.id === id) {
        const nextSelected = !item.selected
        const qty = nextSelected ? String(item.maxReturnable) : ''
        if (nextSelected) {
          lastValuesRef.current[id] = qty
        }
        return {
          ...item,
          selected: nextSelected,
          cantidad_devolver: qty
        }
      }
      return item
    }))
  }

  const handleCantidadChange = (id, value) => {
    if (value !== '') {
      lastValuesRef.current[id] = value
    }
    setItemsList(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          cantidad_devolver: value
        }
      }
      return item
    }))
  }

  const saveAndClear = (id, currentVal) => {
    if (currentVal !== undefined && currentVal !== null && String(currentVal).trim() !== '') {
      lastValuesRef.current[id] = String(currentVal)
    }
    handleCantidadChange(id, '')
  }

  const handleBlur = (id, currentVal) => {
    if (String(currentVal).trim() === '') {
      const restored = lastValuesRef.current[id]
      if (restored !== undefined && restored !== null) {
        handleCantidadChange(id, restored)
      }
    }
  }

  const selectedItems = itemsList.filter(item => item.selected)
  
  // Calcular el total devuelto estimado
  const totalDevolverUsd = selectedItems.reduce((sum, item) => {
    const qty = Number(item.cantidad_devolver) || 0
    const priceAfterDiscount = Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100)
    return sum + (priceAfterDiscount * qty)
  }, 0)

  const roundedTotalDevolverUsd = Math.round(totalDevolverUsd * 100) / 100

  // Validaciones
  const hasSelectedItems = selectedItems.length > 0
  const allQtyValid = selectedItems.every(item => {
    const qty = Number(item.cantidad_devolver)
    return !isNaN(qty) && qty > 0 && qty <= item.maxReturnable
  })
  const hasMotivo = motivoSelect !== '' && (motivoSelect !== 'Otro' || motivoText.trim().length > 0)
  const isFormValid = hasSelectedItems && allQtyValid && hasMotivo && confirmarKardex

  const handleConfirm = async () => {
    if (!isFormValid) return

    const itemsPayload = selectedItems.map(item => ({
      despacho_item_id: item.id,
      producto_id: item.producto_id,
      cantidad_devuelta: Number(item.cantidad_devolver)
    }))

    const motivoFinal = motivoSelect === 'Otro' ? motivoText.trim() : motivoSelect

    try {
      await mutation.mutateAsync({
        despachoId: despacho.id,
        items: itemsPayload,
        motivo: motivoFinal,
        generarReemplazo
      })
      onClose()
    } catch (err) {
      console.error('[DEVOLUCION_MODAL] Error al confirmar:', err)
    }
  }

  const opcionesMotivo = [
    'Producto defectuoso',
    'Cantidad incorrecta',
    'Pedido equivocado',
    'Devolución de préstamo',
    'Otro'
  ]

  const hasCxC = (() => {
    if (!despacho?.forma_pago) return false
    try {
      const fps = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
      if (Array.isArray(fps)) {
        return fps.some(f => f.metodo === 'Cta por cobrar' || f.metodo === 'Cobro a destino')
      }
    } catch (e) {}
    return false
  })()

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Registrar Devolución Parcial — Despacho #${String(despacho?.numero).padStart(5, '0')}`}
    >
      <div className="space-y-3.5 max-h-[80vh] overflow-y-auto pr-1">
        {/* Banner Informativo Compacto */}
        <div className="p-2 rounded-lg border flex items-center gap-2 text-xs bg-amber-50 border-amber-200 text-amber-900 leading-tight">
          <AlertCircle size={16} className="shrink-0 text-amber-600" />
          <span>
            Registra el retorno de mercancía entregada. Se reintegrará el stock, se creará el movimiento en Kardex y se aplicará un abono si el despacho tiene saldo a crédito (CxC/COD).
          </span>
        </div>

        {/* Lista de Productos */}
        <div className="space-y-1.5">
          <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
            <Package size={14} className="text-slate-500" />
            Productos a devolver
          </h3>

          {loading ? (
            <div className="py-6 flex justify-center items-center">
              <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-slate-500 ml-2">Cargando productos...</span>
            </div>
          ) : itemsList.length === 0 ? (
            <p className="text-xs text-slate-500 py-3 text-center">No hay productos disponibles para devolver.</p>
          ) : (
            <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50">
              {itemsList.map(item => {
                const priceAfterDiscount = Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100)
                const isNoReturnable = item.maxReturnable <= 0

                return (
                  <div
                    key={item.id}
                    className={`py-1.5 px-3 flex items-center gap-3 transition-colors ${item.selected ? 'bg-amber-50/30' : 'bg-white'} ${isNoReturnable ? 'opacity-65 bg-slate-50' : ''}`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      disabled={isNoReturnable}
                      checked={item.selected}
                      onChange={() => handleCheckboxChange(item.id)}
                      className="w-4 h-4 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer disabled:cursor-not-allowed shrink-0"
                    />

                    {/* Detalles */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{item.nombre_snap}</p>
                      <div className="flex flex-wrap gap-x-2.5 text-[10px] text-slate-400 mt-0.5">
                        <span>Cód: {item.codigo_snap || 'N/A'}</span>
                        <span>Precio: ${priceAfterDiscount.toFixed(2)}</span>
                        <span>Entregado: {Number(item.cantidad)} {item.unidad_snap}</span>
                        {item.alreadyReturned > 0 && (
                          <span className="text-amber-700 font-medium">Devuelto: {item.alreadyReturned}</span>
                        )}
                      </div>
                    </div>

                    {/* Control de Cantidad (Stepper) Mejorado */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-1.5">
                        {/* Botón Restar */}
                        <button
                          type="button"
                          disabled={!item.selected || Number(item.cantidad_devolver) <= 0 || isNoReturnable}
                          onClick={() => {
                            const current = Number(item.cantidad_devolver) || 0
                            const step = item.unidad_snap === 'und' ? 1 : 0.1
                            handleCantidadChange(item.id, String(Math.max(0, Math.round((current - step) * 100) / 100)))
                          }}
                          className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 active:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed select-none text-sm font-bold shadow-sm transition-colors"
                        >
                          -
                        </button>

                        {/* Entrada Numérica */}
                        <input
                          type="number"
                          disabled={!item.selected || isNoReturnable}
                          min="0.01"
                          max={item.maxReturnable}
                          step="any"
                          value={item.cantidad_devolver}
                          onChange={e => handleCantidadChange(item.id, e.target.value)}
                          onFocus={() => saveAndClear(item.id, item.cantidad_devolver)}
                          onClick={() => saveAndClear(item.id, item.cantidad_devolver)}
                          onBlur={() => handleBlur(item.id, item.cantidad_devolver)}
                          placeholder="0"
                          className="w-14 text-center py-0.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-50 disabled:text-slate-400 font-extrabold"
                        />

                        {/* Botón Sumar */}
                        <button
                          type="button"
                          disabled={!item.selected || Number(item.cantidad_devolver) >= item.maxReturnable || isNoReturnable}
                          onClick={() => {
                            const current = Number(item.cantidad_devolver) || 0
                            const step = item.unidad_snap === 'und' ? 1 : 0.1
                            handleCantidadChange(item.id, String(Math.min(item.maxReturnable, Math.round((current + step) * 100) / 100)))
                          }}
                          className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 active:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed select-none text-sm font-bold shadow-sm transition-colors"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pr-1">
                        máx: {item.maxReturnable} {item.unidad_snap}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Motivo & Opciones (Distribución en Dos Columnas) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start">
          {/* Columna Izquierda: Motivo */}
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">Motivo de devolución <span className="text-red-500">*</span></label>
              <CustomSelect
                options={opcionesMotivo.map(op => ({ value: op, label: op }))}
                value={motivoSelect}
                onChange={val => setMotivoSelect(val)}
                placeholder="Seleccione un motivo..."
                searchable={false}
              />
            </div>

            {motivoSelect === 'Otro' && (
              <div>
                <textarea
                  value={motivoText}
                  onChange={e => setMotivoText(e.target.value)}
                  placeholder="Detalle el motivo..."
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 min-h-[42px] resize-none"
                />
              </div>
            )}
          </div>

          {/* Columna Derecha: Checkboxes */}
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 space-y-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={generarReemplazo}
                onChange={e => setGenerarReemplazo(e.target.checked)}
                className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
              />
              <div className="text-xs select-none">
                <span className="font-semibold text-slate-700 flex items-center gap-1">
                  <FileText size={12} className="text-slate-500" />
                  Generar cotización de reemplazo
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmarKardex}
                onChange={e => setConfirmarKardex(e.target.checked)}
                className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
              />
              <div className="text-xs select-none">
                <span className="font-semibold text-slate-700 flex items-center gap-1">
                  <RotateCcw size={12} className="text-slate-500" />
                  Confirmar ingreso de mercancía <span className="text-red-500">*</span>
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Resumen Compacto Horizontal */}
        {hasSelectedItems && (
          <div className="p-2.5 rounded-xl border border-amber-100 bg-amber-50/20 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 leading-snug">
            <div>
              <span className="font-semibold text-slate-600">Retorno: </span>
              <span className="font-bold text-slate-800">{selectedItems.length} {selectedItems.length === 1 ? 'prod.' : 'prod.'}</span>
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-600">Monto: </span>
              <span className="font-black text-amber-800 text-sm">${roundedTotalDevolverUsd.toFixed(2)} USD</span>
            </div>

            {hasCxC && (
              <div className="flex items-center gap-1 font-semibold text-amber-800">
                <CheckCircle size={14} className="shrink-0 text-amber-600" />
                <span>Se registrará abono de ${roundedTotalDevolverUsd.toFixed(2)} USD a la CxC</span>
              </div>
            )}
          </div>
        )}

        {/* Footer Acciones */}
        <div className="flex justify-end gap-2 pt-2.5 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isFormValid || mutation.isPending}
            className="px-3.5 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 bg-amber-600 hover:bg-amber-700"
          >
            {mutation.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : null}
            Registrar Devolución
          </button>
        </div>
      </div>
    </Modal>
  )
}
