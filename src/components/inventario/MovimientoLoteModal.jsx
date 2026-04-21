// src/components/inventario/MovimientoLoteModal.jsx
// Modal para ingreso/egreso de inventario por lotes
import { useState, useMemo, useRef, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Search, Plus, Minus, X, Package, ArrowDownToLine, ArrowUpFromLine, Loader2, AlertCircle } from 'lucide-react'
import { useAplicarMovimientoLote } from '../../hooks/useMovimientosInventario'

export default function MovimientoLoteModal({ isOpen, onClose, productos = [] }) {
  const [tipo, setTipo] = useState('ingreso')
  const [busqueda, setBusqueda] = useState('')
  const [items, setItems] = useState([]) // [{ producto_id, nombre, codigo, unidad, stock_actual, cantidad }]
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const searchRef = useRef(null)
  const inputRef = useRef(null)

  const mutation = useAplicarMovimientoLote()

  // Reset al abrir/cerrar
  useEffect(() => {
    if (isOpen) {
      setTipo('ingreso')
      setBusqueda('')
      setItems([])
      setMotivo('')
      setError('')
      setShowSearch(false)
    }
  }, [isOpen])

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Productos filtrados (excluir ya seleccionados)
  const idsSeleccionados = new Set(items.map(i => i.producto_id))
  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return []
    const q = busqueda.toLowerCase()
    return productos
      .filter(p => p.activo !== false && !idsSeleccionados.has(p.id))
      .filter(p =>
        (p.nombre || '').toLowerCase().includes(q) ||
        (p.codigo || '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [busqueda, productos, idsSeleccionados])

  function agregarProducto(p) {
    setItems(prev => [...prev, {
      producto_id: p.id,
      nombre: p.nombre,
      codigo: p.codigo || '',
      unidad: p.unidad || 'und',
      stock_actual: p.stock_actual ?? 0,
      cantidad: '',
    }])
    setBusqueda('')
    setShowSearch(false)
    setError('')
  }

  function quitarProducto(id) {
    setItems(prev => prev.filter(i => i.producto_id !== id))
  }

  function cambiarCantidad(id, val) {
    const num = val.replace(/[^\d.]/g, '')
    setItems(prev => prev.map(i => i.producto_id === id ? { ...i, cantidad: num } : i))
    setError('')
  }

  // Validación
  const itemsValidos = items.filter(i => Number(i.cantidad) > 0)
  const hayErrorStock = tipo === 'egreso' && items.some(i => Number(i.cantidad) > i.stock_actual)
  const puedeEnviar = itemsValidos.length > 0 && motivo.trim().length > 0 && !hayErrorStock && !mutation.isPending

  async function handleSubmit() {
    if (!puedeEnviar) return
    setError('')
    try {
      await mutation.mutateAsync({
        tipo,
        motivo: motivo.trim(),
        items: itemsValidos.map(i => ({
          producto_id: i.producto_id,
          cantidad: Number(i.cantidad),
        })),
      })
      onClose()
    } catch (e) {
      setError(e.message || 'Error al aplicar movimiento')
    }
  }

  const esIngreso = tipo === 'ingreso'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Movimiento de inventario" className="max-w-lg sm:max-w-2xl">
      <div className="space-y-4">

        {/* Toggle Ingreso / Egreso */}
        <div className="flex rounded-xl overflow-hidden border border-slate-200">
          <button type="button" onClick={() => { setTipo('ingreso'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold transition-all ${
              esIngreso ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}>
            <ArrowDownToLine size={16} /> Ingreso
          </button>
          <button type="button" onClick={() => { setTipo('egreso'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold transition-all ${
              !esIngreso ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}>
            <ArrowUpFromLine size={16} /> Egreso
          </button>
        </div>

        {/* Buscador de productos */}
        <div className="relative" ref={searchRef}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={busqueda}
              onChange={e => { setBusqueda(e.target.value); setShowSearch(true) }}
              onFocus={() => busqueda.trim() && setShowSearch(true)}
              placeholder="Buscar producto por nombre o código..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
            />
          </div>

          {/* Dropdown de resultados */}
          {showSearch && filtrados.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
              {filtrados.map(p => (
                <button key={p.id} type="button" onClick={() => agregarProducto(p)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
                  <Plus size={14} className="text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.nombre}</p>
                    <p className="text-[11px] text-slate-400">
                      {p.codigo && <span>{p.codigo} · </span>}
                      Stock: {p.stock_actual ?? 0} {p.unidad}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {showSearch && busqueda.trim() && filtrados.length === 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3">
              <p className="text-xs text-slate-400 text-center">No se encontraron productos</p>
            </div>
          )}
        </div>

        {/* Lista de productos seleccionados */}
        {items.length > 0 ? (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                {items.length} producto{items.length > 1 ? 's' : ''} seleccionado{items.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto custom-scrollbar">
              {items.map(item => {
                const cant = Number(item.cantidad) || 0
                const sinStock = tipo === 'egreso' && cant > item.stock_actual
                return (
                  <div key={item.producto_id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.nombre}</p>
                      <p className="text-[11px] text-slate-400">
                        Stock: {item.stock_actual} {item.unidad}
                        {cant > 0 && (
                          <span className={sinStock ? 'text-red-500 font-bold' : 'text-emerald-600'}>
                            {' → '}{esIngreso ? item.stock_actual + cant : item.stock_actual - cant}
                          </span>
                        )}
                      </p>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.cantidad}
                      onChange={e => cambiarCantidad(item.producto_id, e.target.value)}
                      placeholder="0"
                      className={`w-20 px-2 py-1.5 text-sm text-right border rounded-lg outline-none transition-all ${
                        sinStock
                          ? 'border-red-300 bg-red-50 text-red-700 focus:ring-2 focus:ring-red-300'
                          : 'border-slate-200 bg-slate-50 focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500'
                      }`}
                    />
                    <span className="text-xs text-slate-400 w-8">{item.unidad}</span>
                    <button type="button" onClick={() => quitarProducto(item.producto_id)}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-slate-200 rounded-xl py-8 text-center">
            <Package size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-400">Busca y agrega productos arriba</p>
          </div>
        )}

        {/* Motivo */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">
            Motivo <span className="text-red-400">*</span>
          </label>
          <textarea
            value={motivo}
            onChange={e => { setMotivo(e.target.value); setError('') }}
            rows={2}
            placeholder="Ej: Compra proveedor Ferretotal, Merma mensual, Ajuste inventario físico..."
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Botones */}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={!puedeEnviar}
            className={`px-5 py-2.5 rounded-xl text-white text-sm font-black transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
              esIngreso ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20' : 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
            }`}>
            {mutation.isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Aplicando...</>
            ) : (
              <>{esIngreso ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
                Aplicar {esIngreso ? 'ingreso' : 'egreso'} ({itemsValidos.length})
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
