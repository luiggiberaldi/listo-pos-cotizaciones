import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Modal as _Modal } from '../ui/Modal'
import { AlertCircle as _AlertCircle, RotateCcw as _RotateCcw, CheckCircle as _CheckCircle, Package as _Package, Trash2 as _Trash2, Plus as _Plus } from 'lucide-react'
import _CustomSelect from '../ui/CustomSelect'
import supabase from '../../services/supabase/client'
import { useDevolucionParcialDespacho } from '../../hooks/useDespachos'
import { useInventario } from '../../hooks/useInventario'
import _ProductoAutocomplete from '../cotizaciones/ProductoAutocomplete'
import { showToast } from '../ui/Toast'

// Métodos permitidos para cobrar la diferencia. Se excluyen 'Donación' y
// 'Cta por cobrar': no cobrar ya deja el cargo completo como deuda en CxC.
const METODOS_COBRO_DIFERENCIA = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT', 'Cruce']
const REFERENCIA_REQUERIDA = ['Transf. / Pago Móvil']

export default function DevolucionParcialModal({ isOpen, onClose, despacho }) {
  const [loading, setLoading] = useState(false)
  const [itemsList, setItemsList] = useState([])
  const [motivoSelect, setMotivoSelect] = useState('')
  const [motivoText, setMotivoText] = useState('')
  const [generarReemplazo, setGenerarReemplazo] = useState(false)
  const [confirmarKardex, setConfirmarKardex] = useState(false)

  // --- Estados para intercambio de productos ---
  const [realizarIntercambio, setRealizarIntercambio] = useState(false)
  const [exchangeItems, setExchangeItems] = useState([])
  const [clienteInfo, setClienteInfo] = useState(null)
  const [pagosDiferencia, setPagosDiferencia] = useState([])

  const lastValuesRef = useRef({})
  const idempotencyKeyRef = useRef(null)
  const mutation = useDevolucionParcialDespacho()

  // Cargar catálogo de productos localmente para el intercambio
  const { data: catalogoRes } = useInventario({ pageSize: 1500 })
  const productosCatalog = catalogoRes?.productos || []

  useEffect(() => {
    if (isOpen && despacho?.id) {
      setItemsList([])
      setMotivoSelect('')
      setMotivoText('')
      setGenerarReemplazo(false)
      setConfirmarKardex(false)
      setRealizarIntercambio(false)
      setExchangeItems([])
      setClienteInfo(null)
      setPagosDiferencia([])
      lastValuesRef.current = {}
      idempotencyKeyRef.current = null
      fetchItemsAndDevoluciones()
    }
  }, [isOpen, despacho, fetchItemsAndDevoluciones])

  const fetchItemsAndDevoluciones = useCallback(async () => {
    setLoading(true)
    try {
      const clienteId = despacho.cliente_factura_id || despacho.cliente_id;
      const [itemsRes, exchangePrevRes, devRes, clRes] = await Promise.all([
        supabase.from('notas_despacho_items').select('*').eq('despacho_id', despacho.id).order('orden', { ascending: true }),
        supabase.from('despacho_devolucion_intercambios').select('*').eq('despacho_id', despacho.id),
        supabase.from('despacho_devoluciones').select('despacho_item_id, producto_id, cantidad_devuelta').eq('despacho_id', despacho.id),
        supabase.from('clientes').select('nombre, saldo_pendiente, saldo_a_favor').eq('id', clienteId).maybeSingle()
      ])

      if (itemsRes.error) throw itemsRes.error
      if (devRes.error) throw devRes.error

      if (clRes && !clRes.error && clRes.data) {
        setClienteInfo(clRes.data)
      }

      const itemsData = itemsRes.data || []
      const exchangePrevData = exchangePrevRes?.data || []
      const devData = devRes.data || []

      const returnedQtyMap = {}
      const returnedExchangeQtyMap = {}
      devData.forEach(d => {
        if (d.despacho_item_id) {
          returnedQtyMap[d.despacho_item_id] = (returnedQtyMap[d.despacho_item_id] || 0) + Number(d.cantidad_devuelta)
        } else if (d.producto_id) {
          returnedExchangeQtyMap[d.producto_id] = (returnedExchangeQtyMap[d.producto_id] || 0) + Number(d.cantidad_devuelta)
        }
      })

      const mappedItems = itemsData.map(item => {
        const alreadyReturned = returnedQtyMap[item.id] || 0
        const maxReturnable = Number(item.cantidad) - alreadyReturned
        return {
          ...item,
          alreadyReturned,
          maxReturnable: Math.max(0, maxReturnable),
          cantidad_devolver: '',
          selected: false,
          es_intercambio: false
        }
      })

      const mappedExchangeItems = exchangePrevData.map(item => {
        const alreadyReturned = returnedExchangeQtyMap[item.producto_id] || 0
        const maxReturnable = Number(item.cantidad) - alreadyReturned
        return {
          id: item.id,
          despacho_id: item.despacho_id,
          producto_id: item.producto_id,
          nombre_snap: item.nombre_snap,
          codigo_snap: item.codigo_snap,
          unidad_snap: item.unidad_snap,
          cantidad: item.cantidad,
          precio_unit_usd: item.precio_unit_usd,
          descuento_pct: 0,
          alreadyReturned,
          maxReturnable: Math.max(0, maxReturnable),
          cantidad_devolver: '',
          selected: false,
          es_intercambio: true
        }
      })

      setItemsList([...mappedItems, ...mappedExchangeItems])
    } catch (err) {
      console.error('[DEVOLUCION_MODAL] Error al cargar detalles:', err)
      showToast('Error al cargar productos del despacho', 'error')
    } finally {
      setLoading(false)
    }
  }, [despacho])

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

  // --- Manejadores para productos de intercambio ---
  const handleAddExchangeProduct = (producto) => {
    setExchangeItems(prev => {
      const exists = prev.find(p => p.id === producto.id)
      if (exists) {
        showToast('El producto ya está en la lista de intercambio', 'info')
        return prev
      }
      return [...prev, {
        ...producto,
        cantidad: 1,
        precio_unit_usd: Number(producto.precio_usd || 0)
      }]
    })
  }

  const handleRemoveExchangeProduct = (id) => {
    setExchangeItems(prev => prev.filter(p => p.id !== id))
  }

  const handleUpdateExchangeQty = (id, val) => {
    setExchangeItems(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, cantidad: val }
      }
      return p
    }))
  }

  const handleUpdateExchangePrice = (id, val) => {
    setExchangeItems(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, precio_unit_usd: val }
      }
      return p
    }))
  }

  const selectedItems = itemsList.filter(item => item.selected)
  
  // Calcular el total devuelto estimado
  const totalDevolverUsd = selectedItems.reduce((sum, item) => {
    const qty = Number(item.cantidad_devolver) || 0
    const priceAfterDiscount = Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100)
    return sum + (priceAfterDiscount * qty)
  }, 0)

  const roundedTotalDevolverUsd = Math.round(totalDevolverUsd * 100) / 100

  // Calcular el total de intercambio
  const totalIntercambioUsd = exchangeItems.reduce((sum, item) => {
    const qty = Number(item.cantidad) || 0
    const price = Number(item.precio_unit_usd) || 0
    return sum + (price * qty)
  }, 0)

  const roundedTotalIntercambioUsd = Math.round(totalIntercambioUsd * 100) / 100
  const balanceNetoUsd = Math.round((totalIntercambioUsd - totalDevolverUsd) * 100) / 100

  // ─── Cobro de la diferencia (solo cuando el intercambio supera lo devuelto) ───
  const metodosPagoOriginal = useMemo(() => {
    try {
      const raw = despacho?.forma_pago_cliente ?? despacho?.forma_pago
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!Array.isArray(arr)) return []
      return [...new Set(arr.map(p => String(p?.metodo || '').trim()).filter(m => METODOS_COBRO_DIFERENCIA.includes(m)))]
    } catch { return [] }
  }, [despacho?.forma_pago, despacho?.forma_pago_cliente])

  const cobradoDiferencia = Math.round(pagosDiferencia.reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100) / 100
  const pendienteDiferencia = Math.round((balanceNetoUsd - cobradoDiferencia) * 100) / 100
  const cobroDiferenciaValido = !(balanceNetoUsd > 0) || (
    pagosDiferencia.length <= 12 &&
    pagosDiferencia.every(p =>
      METODOS_COBRO_DIFERENCIA.includes(p.metodo) &&
      Number(p.monto) > 0 &&
      (!REFERENCIA_REQUERIDA.includes(p.metodo) || String(p.referencia || '').trim() !== '')
    ) &&
    cobradoDiferencia <= balanceNetoUsd + 0.011
  )

  const handleAddPagoDiferencia = () => {
    setPagosDiferencia(prev => [...prev, { metodo: '', monto: '', referencia: '' }])
  }
  const handleUpdatePagoDiferencia = (idx, field, value) => {
    setPagosDiferencia(prev => prev.map((p, i) => {
      if (i !== idx) return p
      // Al cambiar a un método que no requiere referencia, se limpia la obsoleta
      if (field === 'metodo' && !REFERENCIA_REQUERIDA.includes(value)) return { ...p, metodo: value, referencia: '' }
      return { ...p, [field]: value }
    }))
  }
  const handleRemovePagoDiferencia = (idx) => {
    setPagosDiferencia(prev => prev.filter((_, i) => i !== idx))
  }
  // Completa el monto de la fila con el saldo pendiente de la diferencia
  const handleMontoTotal = (idx) => {
    const pendiente = Math.max(0, pendienteDiferencia)
    setPagosDiferencia(prev => prev.map((p, i) => (i === idx ? { ...p, monto: pendiente.toFixed(2) } : p)))
  }
  const handleUsarMismosMetodos = () => {
    if (metodosPagoOriginal.length === 0) {
      showToast('El despacho no registra métodos de pago reutilizables', 'info')
      return
    }
    const cantidad = metodosPagoOriginal.length
    const montoBase = Math.floor((balanceNetoUsd / cantidad) * 100) / 100
    setPagosDiferencia(metodosPagoOriginal.map((m, i) => ({
      metodo: m,
      monto: i === cantidad - 1
        ? Math.round((balanceNetoUsd - montoBase * (cantidad - 1)) * 100) / 100
        : montoBase,
      referencia: '',
    })))
  }

  // Validaciones
  const hasSelectedItems = selectedItems.length > 0
  const allQtyValid = selectedItems.every(item => {
    const qty = Number(item.cantidad_devolver)
    return !isNaN(qty) && qty > 0 && qty <= item.maxReturnable
  })
  const hasMotivo = motivoSelect !== '' && (motivoSelect !== 'Otro' || motivoText.trim().length > 0)

  const allExchangeValid = !realizarIntercambio || (
    exchangeItems.length > 0 &&
    exchangeItems.every(item => {
      const qty = Number(item.cantidad)
      const price = Number(item.precio_unit_usd)
      return !isNaN(qty) && qty > 0 && !isNaN(price) && price >= 0
    })
  )

  const isFormValid = hasSelectedItems && allQtyValid && hasMotivo && confirmarKardex && allExchangeValid && cobroDiferenciaValido

  const handleConfirm = async () => {
    if (!isFormValid) return

    const itemsPayload = selectedItems.map(item => ({
      despacho_item_id: item.es_intercambio ? null : item.id,
      producto_id: item.producto_id,
      cantidad_devuelta: Number(item.cantidad_devolver),
      es_intercambio: !!item.es_intercambio,
      intercambio_id: item.es_intercambio ? item.id : null
    }))

    const motivoFinal = motivoSelect === 'Otro' ? motivoText.trim() : motivoSelect

    try {
      idempotencyKeyRef.current = idempotencyKeyRef.current || globalThis.crypto?.randomUUID?.()
      await mutation.mutateAsync({
        despachoId: despacho.id,
        items: itemsPayload,
        motivo: motivoFinal,
        generarReemplazo,
        idempotencyKey: idempotencyKeyRef.current,
        exchangeItems: realizarIntercambio
          ? exchangeItems.map(it => ({
              producto_id: it.id,
              cantidad: Number(it.cantidad),
              precio_unit_usd: Number(it.precio_unit_usd)
            }))
          : [],
        pagosDiferencia: balanceNetoUsd > 0
          ? pagosDiferencia
              .filter(p => METODOS_COBRO_DIFERENCIA.includes(p.metodo) && Number(p.monto) > 0)
              .map(p => ({
                metodo: p.metodo,
                monto: Math.round(Number(p.monto) * 100) / 100,
                referencia: String(p.referencia || '').trim() || null,
              }))
          : []
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

  return (
    <_Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Registrar Devolución Parcial — Despacho #${String(despacho?.numero).padStart(5, '0')}`}
      className="max-w-6xl w-full"
    >
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        
        {/* Ficha Financiera del Cliente */}
        {clienteInfo && (
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs shadow-sm bg-gradient-to-r from-white to-slate-50/50">
            <div>
              <span className="text-slate-400 font-bold uppercase tracking-wider block text-[9px]">Cliente Facturación</span>
              <span className="font-extrabold text-slate-800 text-sm leading-tight block">{clienteInfo.nombre}</span>
            </div>
            <div className="flex gap-6 shrink-0">
              <div className="text-left sm:text-right">
                <span className="text-slate-400 font-bold uppercase tracking-wider block text-[9px]">Deuda Pendiente</span>
                <span className="font-black text-red-600 text-sm">${Number(clienteInfo.saldo_pendiente || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-slate-400 font-bold uppercase tracking-wider block text-[9px]">Saldo a Favor</span>
                <span className="font-black text-emerald-600 text-sm">${Number(clienteInfo.saldo_a_favor || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              </div>
            </div>
          </div>
        )}

        {/* Layout de Dos Columnas en PC */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* COLUMNA IZQUIERDA (Devoluciones) */}
          <div className="lg:col-span-6 space-y-4">
            
            {/* Banner Informativo */}
            <div className="p-2.5 rounded-lg border flex items-center gap-2 text-xs bg-amber-50 border-amber-200 text-amber-900 leading-tight">
              <_AlertCircle size={16} className="shrink-0 text-amber-600" />
              <span>
                Registra el retorno de mercancía entregada. Se reintegrará el stock y se calcularán los ajustes en CxC.
              </span>
            </div>

            {/* Lista de Productos del Despacho */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                <_Package size={14} className="text-slate-500" />
                Productos a devolver
              </h3>

              {loading ? (
                <div className="py-6 flex justify-center items-center">
                  <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-slate-500 ml-2">Cargando productos...</span>
                </div>
              ) : itemsList.length === 0 || itemsList.every(i => i.maxReturnable <= 0) ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/90 text-amber-900 text-xs flex items-start gap-2">
                    <_AlertCircle size={16} className="shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-bold">Todos los productos de este despacho han sido devueltos en su totalidad.</p>
                      <p className="mt-0.5 text-[11px] opacity-80">No hay unidades disponibles para registrar una nueva devolución.</p>
                    </div>
                  </div>
                  {itemsList.length > 0 && (
                    <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50 opacity-75">
                      {itemsList.map(item => (
                        <div key={item.id} className="py-2.5 px-3 flex items-center justify-between gap-3 bg-white">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-semibold text-slate-800 truncate">{item.nombre_snap}</p>
                              {item.es_intercambio && (
                                <span className="px-1.5 py-0.2 text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded">INTERCAMBIO</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-2.5 text-[10px] text-slate-400 mt-0.5">
                              <span>Cód: {item.codigo_snap || 'N/A'}</span>
                              <span>Entregado: {Number(item.cantidad)} {item.unidad_snap}</span>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-black text-amber-800 bg-amber-100 border border-amber-200 rounded-md shrink-0 select-none">
                            DEVUELTO 100%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Ítems activos para devolución */}
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50 shadow-xs">
                    {itemsList.filter(i => i.maxReturnable > 0).map(item => {
                      const priceAfterDiscount = Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100)
                      return (
                        <div
                          key={item.id}
                          className={`py-2 px-3 flex items-center gap-3 transition-colors ${item.selected ? 'bg-amber-50/30' : 'bg-white'}`}
                        >
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => handleCheckboxChange(item.id)}
                            className="w-4 h-4 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer shrink-0"
                          />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{item.nombre_snap}</p>
                              {item.es_intercambio && (
                                <span className="px-1.5 py-0.2 text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded shrink-0">INTERCAMBIO PREVIO</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-2.5 text-[10px] text-slate-400 mt-0.5">
                              <span>Cód: {item.codigo_snap || 'N/A'}</span>
                              <span>Precio: ${priceAfterDiscount.toFixed(2)}</span>
                              <span>Entregado: {Number(item.cantidad)} {item.unidad_snap}</span>
                              {item.alreadyReturned > 0 && (
                                <span className="text-amber-700 font-medium">Devuelto previo: {item.alreadyReturned}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={!item.selected || Number(item.cantidad_devolver) <= 0}
                                onClick={() => {
                                  const current = Number(item.cantidad_devolver) || 0
                                  const step = item.unidad_snap === 'und' ? 1 : 0.1
                                  handleCantidadChange(item.id, String(Math.max(0, Math.round((current - step) * 100) / 100)))
                                }}
                                className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed select-none text-sm font-bold shadow-sm transition-colors"
                              >
                                -
                              </button>

                              <input
                                type="number"
                                disabled={!item.selected}
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

                              <button
                                type="button"
                                disabled={!item.selected || Number(item.cantidad_devolver) >= item.maxReturnable}
                                onClick={() => {
                                  const current = Number(item.cantidad_devolver) || 0
                                  const step = item.unidad_snap === 'und' ? 1 : 0.1
                                  handleCantidadChange(item.id, String(Math.min(item.maxReturnable, Math.round((current + step) * 100) / 100)))
                                }}
                                className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed select-none text-sm font-bold shadow-sm transition-colors"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pr-1">
                              Máx: {item.maxReturnable} {item.unidad_snap}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Sección secundaria de ítems devueltos al 100% */}
                  {itemsList.some(i => i.maxReturnable <= 0) && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Historial de productos devueltos al 100%</p>
                      <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50/60 opacity-80">
                        {itemsList.filter(i => i.maxReturnable <= 0).map(item => (
                          <div key={item.id} className="py-2 px-3 flex items-center justify-between gap-3 bg-white">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-semibold text-slate-700 truncate">{item.nombre_snap}</p>
                                {item.es_intercambio && (
                                  <span className="px-1.5 py-0.2 text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded">INTERCAMBIO</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-2.5 text-[10px] text-slate-400 mt-0.5">
                                <span>Cód: {item.codigo_snap || 'N/A'}</span>
                                <span>Entregado: {Number(item.cantidad)} {item.unidad_snap}</span>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] font-extrabold text-amber-800 bg-amber-100/90 border border-amber-200/80 rounded-md shrink-0 select-none">
                              DEVUELTO 100%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Motivo de Devolución */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">Motivo de devolución <span className="text-red-500">*</span></label>
                <_CustomSelect
                  options={opcionesMotivo.map(op => ({ value: op, label: op }))}
                  value={motivoSelect}
                  onChange={val => setMotivoSelect(val)}
                  placeholder="Seleccione un motivo..."
                  searchable={false}
                />
              </div>

              {motivoSelect === 'Otro' && (
                <textarea
                  value={motivoText}
                  onChange={e => setMotivoText(e.target.value)}
                  placeholder="Detalle el motivo..."
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 min-h-[42px] resize-none"
                />
              )}
            </div>
          </div>

          {/* COLUMNA DERECHA (Intercambios) */}
          <div className="lg:col-span-6 space-y-4">
            
            {/* Opción Intercambio */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={realizarIntercambio}
                  onChange={e => {
                    setRealizarIntercambio(e.target.checked)
                    if (!e.target.checked) setExchangeItems([])
                  }}
                  className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
                />
                <div className="text-xs select-none">
                  <span className="font-bold text-slate-800 block">Realizar intercambio de productos</span>
                  <span className="text-slate-500">Permite entregar productos de reemplazo de forma inmediata.</span>
                </div>
              </label>
            </div>

            {realizarIntercambio && (
              <div className="border border-slate-200 rounded-2xl p-4 bg-white space-y-3 animate-in fade-in duration-200">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                  <_Package size={14} className="text-slate-500" />
                  Productos de reemplazo (Intercambio)
                </h3>

                {/* Buscador de productos en catálogo */}
                <_ProductoAutocomplete
                  productos={productosCatalog}
                  onAgregar={handleAddExchangeProduct}
                  idsAgregados={new Set(exchangeItems.map(p => p.id))}
                  placeholder="Buscar producto en catálogo..."
                />

                {/* Lista de productos agregados */}
                {exchangeItems.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center italic">No has agregado productos de intercambio.</p>
                ) : (
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50 max-h-[260px] overflow-y-auto">
                    {exchangeItems.map(item => (
                      <div key={item.id} className="py-2 px-3 flex items-center gap-3 bg-white">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{item.nombre}</p>
                          <div className="flex flex-wrap gap-x-2 text-[10px] text-slate-400 mt-0.5">
                            <span>Cód: {item.codigo || 'N/A'}</span>
                            <span className="text-emerald-600 font-semibold">Stock: {item.stock_actual} {item.unidad}</span>
                          </div>
                        </div>

                        {/* Cantidad */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={Number(item.cantidad) <= 1}
                            onClick={() => handleUpdateExchangeQty(item.id, Math.max(1, Number(item.cantidad) - 1))}
                            className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 select-none text-xs font-bold shadow-sm transition-colors"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.cantidad}
                            onChange={e => handleUpdateExchangeQty(item.id, e.target.value === '' ? '' : (Number(e.target.value) || 1))}
                            onBlur={e => {
                              if (e.target.value === '') handleUpdateExchangeQty(item.id, 1)
                            }}
                            className="w-12 text-center py-0.5 text-xs border border-slate-200 rounded-lg font-extrabold focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 h-6 shadow-sm"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateExchangeQty(item.id, Number(item.cantidad || 1) + 1)}
                            className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 select-none text-xs font-bold shadow-sm transition-colors"
                          >
                            +
                          </button>
                        </div>

                        {/* Precio editable */}
                        <div className="flex items-center border border-slate-200 rounded-lg bg-white shadow-sm focus-within:ring-1 focus-within:ring-amber-500 focus-within:border-amber-500 overflow-hidden h-6 shrink-0">
                          <span className="pl-2 pr-1 text-[10px] text-slate-400 font-bold select-none">$</span>
                          <input
                            type="number"
                            step="any"
                            value={item.precio_unit_usd}
                            onChange={e => handleUpdateExchangePrice(item.id, Number(e.target.value) || 0)}
                            className="w-16 text-right pr-2 py-0 text-xs font-bold focus:outline-none bg-transparent h-full"
                          />
                        </div>

                        {/* Eliminar */}
                        <button
                          type="button"
                          onClick={() => handleRemoveExchangeProduct(item.id)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                          title="Eliminar"
                        >
                          <_Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Checkboxes de Confirmación */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmarKardex}
                  onChange={e => setConfirmarKardex(e.target.checked)}
                  className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
                />
                <div className="text-xs select-none">
                  <span className="font-semibold text-slate-700 flex items-center gap-1">
                    <_RotateCcw size={12} className="text-slate-500" />
                    Confirmar ingreso de mercancía devuelta a stock <span className="text-red-500">*</span>
                  </span>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Resumen de Balance y Ajustes en Formato Ticket */}
        {hasSelectedItems && (
          <div className="border border-slate-200 rounded-2xl bg-white shadow-sm p-4 space-y-3 relative overflow-hidden text-xs">
            <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
            <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider border-b pb-2 flex items-center justify-between">
              <span>Resumen del Intercambio</span>
              <span className="text-[10px] text-slate-400 font-mono">PRO-FORMA</span>
            </h4>
            
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-slate-600">
                <span>Subtotal Devolución ({selectedItems.length} {selectedItems.length === 1 ? 'producto' : 'productos'})</span>
                <span className="font-bold text-slate-800">${roundedTotalDevolverUsd.toFixed(2)} USD</span>
              </div>
              
              {realizarIntercambio && (
                <div className="flex justify-between items-center text-slate-600">
                  <span>Subtotal Intercambio ({exchangeItems.length} {exchangeItems.length === 1 ? 'producto' : 'productos'})</span>
                  <span className="font-bold text-slate-800">${roundedTotalIntercambioUsd.toFixed(2)} USD</span>
                </div>
              )}
              
              {/* Línea punteada divisoria */}
              <div className="border-t border-dashed border-slate-200 my-2" />
              
              {/* Balance Neto */}
              <div className="flex justify-between items-center text-slate-800 font-bold text-sm">
                <span>Balance Neto</span>
                <span className={`font-black ${balanceNetoUsd > 0 ? 'text-amber-800' : balanceNetoUsd < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {balanceNetoUsd > 0 ? '+' : ''}${balanceNetoUsd.toFixed(2)} USD
                </span>
              </div>
            </div>
            
            {/* Caja explicativa de acciones financieras */}
            <div className={`p-2.5 rounded-xl border leading-relaxed flex gap-2.5 ${
              balanceNetoUsd > 0 
                ? 'bg-amber-50 border-amber-200 text-amber-900' 
                : balanceNetoUsd < 0 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <_CheckCircle size={15} className={`shrink-0 mt-0.5 ${balanceNetoUsd > 0 ? 'text-amber-600' : balanceNetoUsd < 0 ? 'text-emerald-600' : 'text-slate-500'}`} />
              <div className="space-y-0.5">
                {balanceNetoUsd > 0 ? (
                  <>
                    <p className="font-bold">El cliente debe pagar la diferencia</p>
                    <p className="text-[11px] opacity-90">
                      El total a pagar al cliente es <strong>$0.00 USD</strong>. Se registrará un nuevo <strong>cargo (deuda)</strong> por <strong>${balanceNetoUsd.toFixed(2)} USD</strong> en su cuenta por cobrar.
                    </p>
                  </>
                ) : balanceNetoUsd < 0 ? (
                  <>
                    <p className="font-bold">Saldo a favor del cliente</p>
                    <p className="text-[11px] opacity-90">
                      Se aplicará un <strong>abono</strong> para disminuir su deuda actual o se registrará un crédito de <strong>saldo a favor</strong> de <strong>${Math.abs(balanceNetoUsd).toFixed(2)} USD</strong> para futuras compras.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold">Intercambio equivalente</p>
                    <p className="text-[11px] opacity-90">
                      El valor de los productos es el mismo. No se generarán movimientos de cobro ni abonos en la cuenta del cliente.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Cobro de la diferencia: métodos con que paga el cliente el restante */}
            {balanceNetoUsd > 0 && (
              <div className="border border-amber-200 rounded-xl bg-amber-50/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h5 className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Cobro de la diferencia</h5>
                  {metodosPagoOriginal.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-500">Pagó originalmente con:</span>
                      {metodosPagoOriginal.map(m => (
                        <span key={m} className="px-1.5 py-0.5 text-[9px] font-bold text-slate-600 bg-white border border-slate-200 rounded">{m}</span>
                      ))}
                      <button
                        type="button"
                        onClick={handleUsarMismosMetodos}
                        className="px-2 py-0.5 text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200 transition-colors"
                      >
                        Usar mismos métodos
                      </button>
                    </div>
                  )}
                </div>

                {pagosDiferencia.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">Sin pagos registrados: los ${balanceNetoUsd.toFixed(2)} quedarán como deuda en CxC.</p>
                ) : (
                  <div className="space-y-1.5">
                    {pagosDiferencia.map((pago, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 flex-wrap">
                        {/* Método — selector redondeado consistente con el modal */}
                        <div className="w-[150px] shrink-0">
                          <_CustomSelect
                            options={METODOS_COBRO_DIFERENCIA.map(m => ({ value: m, label: m }))}
                            value={pago.metodo}
                            onChange={val => handleUpdatePagoDiferencia(idx, 'metodo', val)}
                            placeholder="Método..."
                            searchable={false}
                          />
                        </div>
                        {/* Monto + acceso rápido TOTAL (completa el pendiente) */}
                        <div className="flex items-center border border-slate-200 rounded-xl bg-white overflow-hidden focus-within:ring-1 focus-within:ring-amber-500 focus-within:border-amber-500 shrink-0">
                          <span className="pl-2.5 pr-1 text-[10px] text-slate-400 font-bold select-none">$</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={pago.monto}
                            onChange={e => handleUpdatePagoDiferencia(idx, 'monto', e.target.value)}
                            placeholder="0.00"
                            className="w-[68px] text-right py-2.5 pr-2 text-xs font-bold focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleMontoTotal(idx)}
                            disabled={pendienteDiferencia <= 0.011}
                            title="Completar con el saldo pendiente de la diferencia"
                            className="mr-1.5 ml-0.5 px-1.5 py-0.5 text-[9px] font-black text-amber-800 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all select-none shrink-0"
                          >
                            TOTAL
                          </button>
                        </div>
                        {/* Referencia — solo para métodos que la requieren */}
                        {REFERENCIA_REQUERIDA.includes(pago.metodo) && (
                          <input
                            type="text"
                            value={pago.referencia || ''}
                            onChange={e => handleUpdatePagoDiferencia(idx, 'referencia', e.target.value)}
                            placeholder="Referencia *"
                            className={`flex-1 min-w-[110px] px-2.5 py-2.5 text-xs border rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 ${!String(pago.referencia || '').trim() ? 'border-red-300' : 'border-slate-200'}`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemovePagoDiferencia(idx)}
                          className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                          title="Quitar"
                        >
                          <_Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleAddPagoDiferencia}
                    disabled={pagosDiferencia.length >= 12}
                    title={pagosDiferencia.length >= 12 ? 'Máximo 12 métodos de pago' : undefined}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-amber-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <_Plus size={12} /> Agregar método de pago
                  </button>
                  <div className="text-[11px] font-semibold">
                    {pendienteDiferencia > 0.011 ? (
                      <span className="text-amber-800">Cobrado ${cobradoDiferencia.toFixed(2)} · Quedará como deuda: ${pendienteDiferencia.toFixed(2)}</span>
                    ) : (
                      <span className="text-emerald-700">Diferencia cubierta ✓ (cobrado ${cobradoDiferencia.toFixed(2)})</span>
                    )}
                  </div>
                </div>
                {cobradoDiferencia > balanceNetoUsd + 0.011 && (
                  <p className="text-[10px] font-bold text-red-600">La suma de los pagos supera la diferencia a cobrar (${balanceNetoUsd.toFixed(2)}).</p>
                )}
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
    </_Modal>
  )
}
