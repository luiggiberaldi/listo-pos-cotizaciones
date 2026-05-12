// src/components/despachos/EditarItemsDespachoModal.jsx
import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Search, Plus, Minus, Trash2, Loader2, Package, Save, AlertCircle } from 'lucide-react'
import { useLineItems } from '../../hooks/useLineItems'
import { useInventario } from '../../hooks/useInventario'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useEditarItemsDespacho } from '../../hooks/useDespachos'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import { round4 } from '../../utils/dinero'
import { showToast } from '../ui/Toast'

export default function EditarItemsDespachoModal({ isOpen, onClose, despacho }) {
  const { data: inventarioData, isLoading: loadingInv } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const editarItems = useEditarItemsDespacho()
  const { items, setItems, agregarItem, eliminarPorId, cambiarCantidad, setCantidadDirecta, cambiarPrecio, setStockMap } = useLineItems({ checkStock: true })

  const [busqueda, setBusqueda] = useState('')
  const [cargandoItems, setCargandoItems] = useState(false)
  const [error, setError] = useState(null)

  // 1. Cargar items actuales del despacho
  useEffect(() => {
    if (!isOpen || !despacho?.id) return

    async function fetchItems() {
      setCargandoItems(true)
      setError(null)
      try {
        const { data, error: fetchErr } = await (await import('../../services/supabase/client')).default
          .from('notas_despacho_items')
          .select('*')
          .eq('despacho_id', despacho.id)
          .order('orden')
        
        if (fetchErr) throw fetchErr
        
        // Mapear al formato de useLineItems
        const mapped = (data || []).map(it => ({
          _key: `existing-${it.id}`,
          productoId: it.producto_id,
          codigoSnap: it.codigo_snap,
          nombreSnap: it.nombre_snap,
          unidadSnap: it.unidad_snap,
          cantidad: Number(it.cantidad),
          precioUnitUsd: Number(it.precio_unit_usd),
          descuentoPct: Number(it.descuento_pct || 0),
          orden: it.orden
        }))
        setItems(mapped)
      } catch (err) {
        console.error('Error fetching items:', err)
        setError('No se pudieron cargar los productos del despacho')
      } finally {
        setCargandoItems(false)
      }
    }

    fetchItems()
  }, [isOpen, despacho?.id, setItems])

  // 2. Sincronizar stock map
  useEffect(() => {
    if (productos.length > 0) {
      const map = {}
      productos.forEach(p => { map[p.id] = Number(p.stock_actual) || 0 })
      setStockMap(map)
    }
  }, [productos, setStockMap])

  // 3. Filtrar productos para agregar
  const productosFiltrados = useProductSearch(productos, busqueda)

  // 4. Calcular totales temporales
  const totales = useMemo(() => {
    let subtotal = 0
    items.forEach(it => {
      const linea = round4(it.cantidad * it.precioUnitUsd * (1 - (it.descuentoPct || 0) / 100))
      subtotal += linea
    })
    const flete = Number(despacho?.flete_usd || 0)
    const corte = Number(despacho?.corte_usd || 0)
    const descTotal = Number(despacho?.descuento_total_usd || 0)
    const total = Math.max(0, subtotal + flete + corte - descTotal)
    return { subtotal, total }
  }, [items, despacho])

  async function handleSave() {
    if (items.length === 0) {
      showToast('El despacho debe tener al menos un producto', 'error')
      return
    }

    // Mapear de vuelta al formato del API
    const itemsApi = items.map((it, idx) => ({
      producto_id: it.productoId,
      codigo_snap: it.codigoSnap,
      nombre_snap: it.nombreSnap,
      unidad_snap: it.unidadSnap,
      cantidad: it.cantidad,
      precio_unit_usd: it.precioUnitUsd,
      descuento_pct: it.descuentoPct || 0,
      orden: idx
    }))

    try {
      await editarItems.mutateAsync({
        despachoId: despacho.id,
        items: itemsApi
      })
      onClose()
    } catch (err) {
      // El hook ya muestra el toast
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-4xl h-full sm:h-[90vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <Package size={22} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg leading-tight">Editar productos</h3>
              <p className="text-xs text-slate-400 font-mono">DES-{String(despacho?.numero).padStart(5, '0')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          
          {/* Columna Izquierda: Buscador y Catálogo */}
          <div className="w-full md:w-5/12 border-r border-slate-100 flex flex-col bg-slate-50/50">
            <div className="p-4 bg-white border-b border-slate-100">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white text-sm transition-all"
                />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingInv ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 size={24} className="animate-spin text-indigo-500" />
                  <p className="text-xs text-slate-400">Cargando catálogo...</p>
                </div>
              ) : productosFiltrados.length === 0 ? (
                <p className="text-center py-10 text-xs text-slate-400 italic">No se encontraron productos</p>
              ) : (
                productosFiltrados.map(p => {
                  const enCarrito = items.some(it => it.productoId === p.id)
                  const stock = Number(p.stock_actual) || 0
                  return (
                    <div key={p.id} 
                      onClick={() => !enCarrito && stock > 0 && agregarItem(p)}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                        enCarrito ? 'bg-indigo-50 border-indigo-200 opacity-60 cursor-default' : 
                        stock <= 0 ? 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed' :
                        'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
                      }`}>
                      <div className="flex justify-between gap-2">
                        <p className="text-xs font-bold text-slate-700 leading-tight truncate">{p.nombre}</p>
                        <span className="text-xs font-black text-slate-900 shrink-0">{fmtUsd(p.precio_usd)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-mono text-slate-400 uppercase">{p.codigo || 'S/C'}</span>
                        <span className={`font-bold ${stock > 5 ? 'text-emerald-500' : stock > 0 ? 'text-amber-500' : 'text-red-500'}`}>
                          Stock: {stock} {p.unidad || 'und'}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Columna Derecha: Lista de items del despacho */}
          <div className="w-full md:w-7/12 flex flex-col bg-white">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Carrito del Despacho</span>
              <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-lg uppercase">
                {items.length} Items
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cargandoItems ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 size={32} className="animate-spin text-slate-300" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-20 text-red-500 gap-2 text-center">
                  <AlertCircle size={32} />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-2">
                  <Package size={48} strokeWidth={1} />
                  <p className="text-sm font-medium">Agrega productos del catálogo</p>
                </div>
              ) : (
                items.map((it, idx) => {
                  const stockRef = productos.find(p => p.id === it.productoId)?.stock_actual || 0
                  const stockMax = Number(stockRef) + (it._key.startsWith('existing') ? it.cantidad : 0)
                  
                  return (
                    <div key={it._key} className="p-4 rounded-2xl border border-slate-100 bg-white shadow-sm flex flex-col gap-3">
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 leading-tight">{it.nombreSnap}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{it.codigoSnap || 'SIN CÓDIGO'}</p>
                        </div>
                        <button onClick={() => eliminarPorId(it.productoId)} className="text-slate-300 hover:text-red-500 p-1 transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        {/* Cantidad Selector */}
                        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                          <button 
                            onClick={() => cambiarCantidad(it.productoId, -1)}
                            className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 active:scale-90 transition-transform">
                            <Minus size={14} />
                          </button>
                          <input 
                            type="number"
                            value={it.cantidad}
                            onChange={e => setCantidadDirecta(it.productoId, e.target.value)}
                            onBlur={e => { if(!e.target.value || Number(e.target.value) <= 0) setCantidadDirecta(it.productoId, 1) }}
                            className="w-12 text-center bg-transparent text-sm font-black text-slate-800 focus:outline-none"
                          />
                          <button 
                            onClick={() => cambiarCantidad(it.productoId, 1)}
                            className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 active:scale-90 transition-transform">
                            <Plus size={14} />
                          </button>
                        </div>

                        {/* Precio Input */}
                        <div className="relative flex-1 max-w-[120px]">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={it.precioUnitUsd}
                            onChange={e => cambiarPrecio(it.productoId, e.target.value)}
                            className="w-full pl-6 pr-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-right text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-400 transition-all"
                          />
                        </div>

                        {/* Total Linea */}
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-0.5">Subtotal</p>
                          <p className="text-sm font-black text-slate-900">{fmtUsd(it.cantidad * it.precioUnitUsd)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer de Totales */}
            <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0 space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal productos</span>
                  <span className="font-bold">{fmtUsd(totales.subtotal)}</span>
                </div>
                {Number(despacho?.flete_usd) > 0 && (
                  <div className="flex justify-between text-xs text-emerald-600">
                    <span>Flete / Envío</span>
                    <span>+{fmtUsd(despacho.flete_usd)}</span>
                  </div>
                )}
                {Number(despacho?.corte_usd) > 0 && (
                  <div className="flex justify-between text-xs text-emerald-600">
                    <span>Corte</span>
                    <span>+{fmtUsd(despacho.corte_usd)}</span>
                  </div>
                )}
                {Number(despacho?.descuento_total_usd) > 0 && (
                  <div className="flex justify-between text-xs text-amber-600">
                    <span>Descuento global</span>
                    <span>-{fmtUsd(despacho.descuento_total_usd)}</span>
                  </div>
                )}
                <div className="flex justify-between items-end pt-2 border-t border-slate-200">
                  <span className="text-sm font-bold text-slate-600">Nuevo Total Despacho</span>
                  <span className="text-2xl font-black text-slate-900 leading-none">{fmtUsd(totales.total)}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={onClose} disabled={editarItems.isPending}
                  className="flex-1 py-3.5 rounded-2xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-white active:scale-[0.98] transition-all disabled:opacity-50">
                  Descartar
                </button>
                <button 
                  onClick={handleSave}
                  disabled={editarItems.isPending || items.length === 0}
                  className="flex-[2] py-3.5 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                  {editarItems.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  Guardar Cambios Profundos
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
