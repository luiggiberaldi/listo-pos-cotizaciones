// src/components/despachos/EditarItemsDespachoModal.jsx
import { useState, useEffect, useMemo } from 'react'
import { X, Search, Plus, Minus, Trash2, Loader2, Package, Save, AlertCircle, CreditCard, CheckCircle } from 'lucide-react'
import { useLineItems } from '../../hooks/useLineItems'
import { useInventario } from '../../hooks/useInventario'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useEditarItemsDespacho } from '../../hooks/useDespachos'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import { round4 } from '../../utils/dinero'
import { showToast } from '../ui/Toast'
import { FORMAS_PAGO } from '../../constants/formasPago'

export default function EditarItemsDespachoModal({ isOpen, onClose, despacho }) {
  const { data: inventarioData, isLoading: loadingInv } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const editarItems = useEditarItemsDespacho()
  const { items, setItems, agregarItem, eliminarPorId, cambiarCantidad, setCantidadDirecta, cambiarPrecio, setStockMap } = useLineItems({ checkStock: true })

  const [busqueda, setBusqueda] = useState('')
  const [cargandoItems, setCargandoItems] = useState(false)
  const [error, setError] = useState(null)

  // Pagos
  const [pagos, setPagos] = useState([])
  const [mostrarSelectorMetodo, setMostrarSelectorMetodo] = useState(false)

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

    // 1.1 Cargar pagos actuales
    if (despacho.forma_pago_cliente || despacho.forma_pago) {
      try {
        const fpRaw = despacho.forma_pago_cliente || despacho.forma_pago
        const parsed = JSON.parse(fpRaw)
        const pagosArray = Array.isArray(parsed) && parsed.length > 0 ? parsed : []
        if (pagosArray.length > 0) {
          setPagos(pagosArray)
        } else {
          setPagos([{ metodo: 'Por definir', monto: Number(despacho.total_usd) || 0 }])
        }
      } catch {
        setPagos([{ metodo: despacho.forma_pago || 'Efectivo', monto: Number(despacho.total_usd) || 0 }])
      }
    } else {
      setPagos([{ metodo: 'Por definir', monto: Number(despacho.total_usd) || 0 }])
    }
  }, [isOpen, despacho?.id, despacho?.forma_pago, despacho?.forma_pago_cliente, despacho?.total_usd, setItems])

  // 2. Sincronizar stock map
  useEffect(() => {
    if (productos.length > 0) {
      const map = {}
      productos.forEach(p => { map[p.id] = Number(p.stock_actual) || 0 })
      setStockMap(map)
    }
  }, [productos, setStockMap])

  // 3. Filtrar productos
  const productosFiltrados = useProductSearch(productos, busqueda)

  // 4. Calcular totales
  const totales = useMemo(() => {
    let subtotal = 0
    items.forEach(it => {
      subtotal += round4(it.cantidad * it.precioUnitUsd * (1 - (it.descuentoPct || 0) / 100))
    })
    const flete = Number(despacho?.flete_usd || 0)
    const corte = Number(despacho?.corte_usd || 0)
    const descTotal = Number(despacho?.descuento_total_usd || 0)
    const total = Math.max(0, subtotal + flete + corte - descTotal)
    const totalPagos = pagos.reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
    const diferencia = Math.round((total - totalPagos) * 100) / 100
    const estaCuadrado = Math.abs(diferencia) < 0.01
    return { subtotal, total, totalPagos, diferencia, estaCuadrado }
  }, [items, despacho, pagos])

  async function handleSave() {
    if (items.length === 0) {
      showToast('El despacho debe tener al menos un producto', 'error')
      return
    }
    if (!totales.estaCuadrado) {
      showToast(`Los pagos no cuadran con el total. Diferencia: ${fmtUsd(totales.diferencia)}`, 'error')
      return
    }
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
      await editarItems.mutateAsync({ despachoId: despacho.id, items: itemsApi, pagos: JSON.stringify(pagos) })
      onClose()
    } catch {
      // El hook ya muestra el toast
    }
  }

  if (!isOpen) return null

  const metodosDisponibles = FORMAS_PAGO.filter(m => !pagos.some(pg => pg.metodo === m))

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Modal — más ancho para dar espacio al contenido */}
      <div className="bg-white w-full max-w-5xl h-full sm:h-[92vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">

        {/* ── Header ── */}
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

        {/* ── Columnas: Catálogo + Carrito ── */}
        <div className="flex flex-col md:flex-row min-h-0 flex-1 overflow-hidden">

          {/* Columna Izquierda: Catálogo */}
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
                    <div
                      key={p.id}
                      onClick={() => !enCarrito && stock > 0 && agregarItem(p)}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                        enCarrito ? 'bg-indigo-50 border-indigo-200 opacity-60 cursor-default' :
                        stock <= 0 ? 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed' :
                        'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <p className="text-xs font-bold text-slate-700 leading-tight">{p.nombre}</p>
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

          {/* Columna Derecha: Carrito */}
          <div className="w-full md:w-7/12 flex flex-col bg-white">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
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
                items.map((it) => (
                  <div key={it._key} className="px-3 py-2.5 rounded-xl border border-slate-100 bg-white shadow-sm flex flex-col gap-2">
                    {/* Nombre + eliminar */}
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 leading-tight">{it.nombreSnap}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{it.codigoSnap || 'SIN CÓDIGO'}</p>
                      </div>
                      <button onClick={() => eliminarPorId(it.productoId)} className="text-slate-300 hover:text-red-500 p-0.5 transition-colors shrink-0 self-start">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {/* Controles en una sola fila compacta */}
                    <div className="flex items-center gap-2">
                      {/* Cantidad */}
                      <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                        <button onClick={() => cambiarCantidad(it.productoId, -1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 active:scale-90 transition-transform">
                          <Minus size={11} />
                        </button>
                        <input
                          type="number"
                          value={it.cantidad}
                          onChange={e => setCantidadDirecta(it.productoId, e.target.value)}
                          onBlur={e => { if (!e.target.value || Number(e.target.value) <= 0) setCantidadDirecta(it.productoId, 1) }}
                          className="w-9 text-center bg-transparent text-xs font-black text-slate-800 focus:outline-none"
                        />
                        <button onClick={() => cambiarCantidad(it.productoId, 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 active:scale-90 transition-transform">
                          <Plus size={11} />
                        </button>
                      </div>
                      {/* Precio */}
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={it.precioUnitUsd}
                          onChange={e => cambiarPrecio(it.productoId, e.target.value)}
                          className="w-full pl-5 pr-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-right text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-400 transition-all"
                        />
                      </div>
                      {/* Subtotal */}
                      <div className="ml-auto text-right">
                        <p className="text-[9px] text-slate-400 uppercase font-bold tracking-widest leading-none mb-0.5">Subtotal</p>
                        <p className="text-sm font-black text-slate-900">{fmtUsd(it.cantidad * it.precioUnitUsd)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── SECCIÓN PAGOS — franja full-width debajo de las columnas ── */}
        <div className="shrink-0 border-t-2 border-slate-100 bg-gradient-to-b from-slate-50 to-white">

          {/* Header pagos */}
          <div className="flex items-center justify-between px-6 pt-3 pb-2">
            <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <CreditCard size={13} /> Métodos de Pago
            </span>
            {totales.estaCuadrado ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                <CheckCircle size={12} /> Pagos cuadrados ✓
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-1 rounded-full border ${
                totales.diferencia > 0
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-red-50 text-red-600 border-red-200'
              }`}>
                <AlertCircle size={12} />
                {totales.diferencia > 0
                  ? `Pendiente: ${fmtUsd(totales.diferencia)}`
                  : `Exceso: ${fmtUsd(Math.abs(totales.diferencia))}`}
              </span>
            )}
          </div>

          {/* Tabla de pagos */}
          <div className="px-6 pb-3 space-y-1.5">
            {pagos.map((p, i) => (
              <div key={i} className="flex flex-col gap-2 bg-white rounded-2xl border border-slate-200 px-4 py-2.5 shadow-sm hover:border-slate-300 transition-colors group">
                <div className="flex items-center gap-3">
                  {/* Nombre del método */}
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide w-32 shrink-0">{p.metodo}</span>

                  {/* Input monto — generoso y legible */}
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-slate-400 text-sm font-bold shrink-0">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={p.monto}
                      onChange={e => {
                        const newPagos = [...pagos]
                        newPagos[i] = { ...p, monto: e.target.value }
                        setPagos(newPagos)
                      }}
                      className="flex-1 min-w-0 max-w-[160px] py-1.5 px-3 rounded-xl border border-slate-200 text-base font-black text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all bg-slate-50 focus:bg-white"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* +Resto */}
                    {!totales.estaCuadrado && totales.diferencia > 0 && (
                      <button
                        onClick={() => {
                          const newPagos = [...pagos]
                          newPagos[i] = { ...p, monto: Math.round((Number(p.monto) + totales.diferencia) * 100) / 100 }
                          setPagos(newPagos)
                        }}
                        className="px-2.5 py-1 text-[11px] font-black bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors whitespace-nowrap"
                        title="Añadir la diferencia pendiente a este método"
                      >
                        + Resto
                      </button>
                    )}
                    {/* Eliminar — solo si hay más de 1 método */}
                    {pagos.length > 1 && (
                      <button
                        onClick={() => setPagos(pagos.filter((_, idx) => idx !== i))}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar este método"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {/* Opcional: Días de Vencimiento para Cta por cobrar */}
                {p.metodo === 'Cta por cobrar' && (
                  <div className="flex items-center gap-2 pl-[140px]">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Días venc.:</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={p.diasVencimiento || ''}
                      onChange={e => {
                        const newPagos = [...pagos]
                        newPagos[i] = { ...p, diasVencimiento: e.target.value }
                        setPagos(newPagos)
                      }}
                      className="w-24 px-2 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white transition-all"
                      placeholder="Opcional"
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Añadir método */}
            {!totales.estaCuadrado && Math.abs(totales.diferencia) > 0.01 && (
              <div>
                {mostrarSelectorMetodo ? (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-3">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider mb-2">
                      Seleccionar método de pago para {fmtUsd(totales.diferencia)} pendiente
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {metodosDisponibles.map(metodo => (
                        <button
                          key={metodo}
                          onClick={() => {
                            setPagos([...pagos, { metodo, monto: Math.max(0, totales.diferencia) }])
                            setMostrarSelectorMetodo(false)
                          }}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-400 transition-all shadow-sm"
                        >
                          {metodo}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setMostrarSelectorMetodo(false)}
                      className="mt-2 text-[10px] text-indigo-400 hover:text-indigo-600 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setMostrarSelectorMetodo(true)}
                    className="w-full py-2 flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-xs font-bold hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all"
                  >
                    <Plus size={14} /> Añadir método para la diferencia ({fmtUsd(totales.diferencia)})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer Totales + Botones ── */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 shrink-0">
          <div className="flex items-center justify-between gap-6">
            {/* Desglose de totales */}
            <div className="flex items-center gap-6 text-xs text-slate-500 flex-wrap">
              <span>Subtotal: <strong className="text-slate-700">{fmtUsd(totales.subtotal)}</strong></span>
              {Number(despacho?.flete_usd) > 0 && (
                <span className="text-emerald-600">Flete: <strong>+{fmtUsd(despacho.flete_usd)}</strong></span>
              )}
              {Number(despacho?.corte_usd) > 0 && (
                <span className="text-emerald-600">Corte: <strong>+{fmtUsd(despacho.corte_usd)}</strong></span>
              )}
              {Number(despacho?.descuento_total_usd) > 0 && (
                <span className="text-amber-600">Desc: <strong>-{fmtUsd(despacho.descuento_total_usd)}</strong></span>
              )}
              <span className="text-base font-black text-slate-900">
                Total: {fmtUsd(totales.total)}
              </span>
            </div>

            {/* Botones */}
            <div className="flex gap-3 shrink-0">
              <button
                onClick={onClose}
                disabled={editarItems.isPending}
                className="px-5 py-3 rounded-2xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                Descartar
              </button>
              <button
                onClick={handleSave}
                disabled={editarItems.isPending || items.length === 0 || !totales.estaCuadrado}
                className="px-6 py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {editarItems.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
