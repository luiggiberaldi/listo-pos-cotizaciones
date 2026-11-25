// src/components/inventario/MovimientoLoteModal.jsx
// Modal para ingreso/egreso/conteo físico de inventario por lotes
import { useState, useMemo, useRef, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Search, Plus, X, Package, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Loader2, AlertCircle, AlertTriangle } from 'lucide-react'
import { useAplicarMovimientoLote, useConteoFisico } from '../../hooks/useMovimientosInventario'
import { smartSearchProductos } from '../../utils/smartSearch'
import { MOTIVOS_TIPO_LIST, getMotivoChipClasses } from '../../utils/motivosTipo'
import supabase from '../../services/supabase/client'
import { detectarCargasRecientesSimilares } from '../../utils/cargaDuplicada'

export default function MovimientoLoteModal({ isOpen, onClose, productos = [] }) {
  const [tipo, setTipo] = useState('ingreso')
  const [busqueda, setBusqueda] = useState('')
  const [items, setItems] = useState([]) // [{ producto_id, nombre, codigo, unidad, stock_actual, cantidad }]
  const [motivo, setMotivo] = useState('')
  const [motivoTipo, setMotivoTipo] = useState('compra_proveedor')
  const [error, setError] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [recientes24h, setRecientes24h] = useState([])
  const searchRef = useRef(null)
  const inputRef = useRef(null)
  // N29: conservar misma clave idempotente mientras no cambie la carga útil del envío
  const submitKeyRef = useRef({ signature: null, key: null })

  const movimientoMutation = useAplicarMovimientoLote()
  const conteoMutation = useConteoFisico()
  const pending = movimientoMutation.isPending || conteoMutation.isPending

  // Reset al abrir/cerrar
  useEffect(() => {
    if (isOpen) {
      setTipo('ingreso')
      setBusqueda('')
      setItems([])
      setMotivo('')
      setMotivoTipo('compra_proveedor')
      setError('')
      setShowSearch(false)
      setRecientes24h([])
      submitKeyRef.current = { signature: null, key: null }
    }
  }, [isOpen])

  // N32: Cargar ingresos de las últimas 24h para alertar posibles cargas duplicadas (no bloqueante)
  useEffect(() => {
    if (!isOpen || tipo !== 'ingreso') return
    let cancelled = false
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    supabase
      .from('inventario_movimientos')
      .select('producto_id, producto_nombre, tipo, cantidad, motivo, origen_tipo, creado_en')
      .eq('tipo', 'ingreso')
      .gte('creado_en', hace24h)
      .order('creado_en', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!cancelled && Array.isArray(data)) setRecientes24h(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isOpen, tipo])

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
    const q = busqueda.trim()
    if (!q) return []
    return smartSearchProductos(
      productos.filter(p => p.activo !== false && !idsSeleccionados.has(p.id)),
      q
    ).slice(0, 12)
  }, [busqueda, productos, idsSeleccionados])

  function cambiarTipoTab(nuevoTipo) {
    setTipo(nuevoTipo)
    setError('')
    submitKeyRef.current = { signature: null, key: null }
    if (nuevoTipo === 'conteo') {
      setMotivoTipo('ajuste_inventario')
    } else if (motivoTipo === 'ajuste_inventario' && nuevoTipo === 'ingreso') {
      setMotivoTipo('compra_proveedor')
    }
  }

  function agregarProducto(p) {
    setItems(prev => [...prev, {
      producto_id: p.id,
      nombre: p.nombre,
      codigo: p.codigo || '',
      unidad: p.unidad || 'und',
      stock_actual: Number(p.stock_actual ?? 0),
      cantidad: '',
    }])
    setBusqueda('')
    setShowSearch(false)
    setError('')
    submitKeyRef.current = { signature: null, key: null }
  }

  function quitarProducto(id) {
    setItems(prev => prev.filter(i => i.producto_id !== id))
    submitKeyRef.current = { signature: null, key: null }
  }

  function cambiarCantidad(id, val) {
    const num = val.replace(/[^\d.-]/g, '').replace(/(?!^)-/g, '')
    setItems(prev => prev.map(i => i.producto_id === id ? { ...i, cantidad: num } : i))
    setError('')
    submitKeyRef.current = { signature: null, key: null }
  }

  const esIngreso = tipo === 'ingreso'
  const esConteo = tipo === 'conteo'

  // Validación
  const itemsValidos = esConteo
    ? items.filter(i => i.cantidad !== '' && Number.isFinite(Number(i.cantidad)) && Number(i.cantidad) >= 0)
    : items.filter(i => Number(i.cantidad) > 0)
  const hayErrorStock = tipo === 'egreso' && items.some(i => Number(i.cantidad) > i.stock_actual)
  const alertasDuplicado = useMemo(() => {
    if (!esIngreso || itemsValidos.length === 0 || recientes24h.length === 0) return []
    return detectarCargasRecientesSimilares(
      recientes24h,
      itemsValidos.map(i => ({ producto_id: i.producto_id, nombre: i.nombre, cantidad: Number(i.cantidad) }))
    )
  }, [esIngreso, itemsValidos, recientes24h])
  const puedeEnviar = itemsValidos.length > 0 && motivo.trim().length > 0 && !hayErrorStock && !pending

  function resolverClaveEnvio(payloadSignature) {
    if (submitKeyRef.current.signature === payloadSignature && submitKeyRef.current.key) {
      return submitKeyRef.current.key
    }
    const key = crypto.randomUUID()
    submitKeyRef.current = { signature: payloadSignature, key }
    return key
  }

  async function handleSubmit() {
    if (!puedeEnviar) return
    setError('')
    try {
      if (esConteo) {
        const itemsConteo = itemsValidos.map(i => ({
          producto_id: i.producto_id,
          stock_contado: Number(i.cantidad),
          stock_esperado: Number(i.stock_actual),
        }))
        const idempotencyKey = resolverClaveEnvio(JSON.stringify({ tipo: 'conteo', motivo: motivo.trim(), itemsConteo }))
        await conteoMutation.mutateAsync({
          motivo: motivo.trim(),
          items: itemsConteo,
          idempotencyKey,
        })
      } else {
        const itemsMov = itemsValidos.map(i => ({
          producto_id: i.producto_id,
          cantidad: Number(i.cantidad),
        }))
        const idempotencyKey = resolverClaveEnvio(JSON.stringify({ tipo, motivo: motivo.trim(), motivo_tipo: motivoTipo, itemsMov }))
        await movimientoMutation.mutateAsync({
          tipo,
          motivo: motivo.trim(),
          motivo_tipo: motivoTipo,
          items: itemsMov,
          idempotencyKey,
        })
      }
      submitKeyRef.current = { signature: null, key: null }
      onClose()
    } catch (e) {
      if (e.status === 409) {
        submitKeyRef.current = { signature: null, key: null }
        // OP-2026-086 (B2): en el conteo, traer el stock actual del servidor y mostrar qué cambió,
        // para que el operador revise y vuelva a guardar sin cerrar la ventana.
        if (esConteo && items.length > 0) {
          try {
            const { data } = await supabase
              .from('productos')
              .select('id, stock_actual')
              .in('id', items.map(i => i.producto_id))
            const actual = new Map((data || []).map(r => [r.id, Number(r.stock_actual ?? 0)]))
            const cambiados = items.filter(i => actual.has(i.producto_id) && actual.get(i.producto_id) !== Number(i.stock_actual))
            if (cambiados.length > 0) {
              setItems(prev => prev.map(i => actual.has(i.producto_id) ? { ...i, stock_actual: actual.get(i.producto_id) } : i))
              setError(`El stock cambió mientras contabas: ${cambiados.map(i => `${i.nombre} (${i.stock_actual} → ${actual.get(i.producto_id)})`).join(', ')}. Ya se actualizó en pantalla; revisa tu conteo y vuelve a guardar.`)
              return
            }
          } catch {
            // si no se pudo refrescar, se muestra el mensaje del servidor
          }
        }
      }
      setError(e.message || 'Error al aplicar movimiento')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Movimiento de inventario" className="max-w-2xl lg:max-w-4xl">
      <div className="space-y-4">

        {/* Toggle Ingreso / Egreso / Conteo físico */}
        <div className="grid grid-cols-3 rounded-xl overflow-hidden border border-slate-200">
          <button type="button" onClick={() => cambiarTipoTab('ingreso')}
            className={`flex items-center justify-center gap-1.5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
              esIngreso ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}>
            <ArrowDownToLine size={15} /> Ingreso
          </button>
          <button type="button" onClick={() => cambiarTipoTab('egreso')}
            className={`flex items-center justify-center gap-1.5 py-2.5 text-xs sm:text-sm font-bold transition-all border-x border-slate-200 ${
              tipo === 'egreso' ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}>
            <ArrowUpFromLine size={15} /> Egreso
          </button>
          <button type="button" onClick={() => cambiarTipoTab('conteo')}
            className={`flex items-center justify-center gap-1.5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
              esConteo ? 'bg-violet-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}>
            <ClipboardCheck size={15} /> Conteo físico
          </button>
        </div>

        {/* ── Categoría de motivo (o aviso en modo conteo) ─────────────────── */}
        {esConteo ? (
          <div className="rounded-xl bg-violet-50 border border-violet-200 px-3.5 py-2.5 text-xs text-violet-800 leading-relaxed">
            <strong>Conteo físico:</strong> escribe la cantidad exacta que contaste en almacén. El sistema calculará la diferencia automáticamente y verificará que el inventario no haya cambiado mientras contabas.
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Categoría</label>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_TIPO_LIST.map(mt => {
                const sel = motivoTipo === mt.value
                const colors = getMotivoChipClasses(mt.value)
                const Icon = mt.icon
                return (
                  <button
                    key={mt.value}
                    type="button"
                    onClick={() => setMotivoTipo(mt.value)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      sel
                        ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ring-offset-1 ring-current/20`
                        : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                    }`}
                  >
                    <Icon size={12} />
                    {mt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

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
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto custom-scrollbar">
              {filtrados.map(p => (
                <button key={p.id} type="button" onClick={() => agregarProducto(p)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                  <Plus size={14} className="text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.nombre}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      {p.codigo && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 font-mono font-bold text-[10px] border border-sky-100">
                          {p.codigo}
                        </span>
                      )}
                      <span>Stock: {p.stock_actual ?? 0} {p.unidad}</span>
                      {p.categoria && <span className="text-slate-300">· {p.categoria}</span>}
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
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                {items.length} producto{items.length > 1 ? 's' : ''} seleccionado{items.length > 1 ? 's' : ''}
              </p>
              {esConteo && (
                <span className="text-[11px] font-semibold text-violet-600">Cantidad contada real</span>
              )}
            </div>
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto custom-scrollbar">
              {items.map(item => {
                const tieneValor = item.cantidad !== '' && Number.isFinite(Number(item.cantidad))
                const cant = Number(item.cantidad) || 0
                const sinStock = tipo === 'egreso' && cant > item.stock_actual
                const diffConteo = tieneValor ? Number((cant - item.stock_actual).toFixed(4)) : null
                return (
                  <div key={item.producto_id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.nombre}</p>
                      <p className="text-[11px] text-slate-400">
                        Sistema: {item.stock_actual} {item.unidad}
                        {!esConteo && cant > 0 && (
                          <span className={sinStock ? 'text-red-500 font-bold' : 'text-emerald-600'}>
                            {' → '}{esIngreso ? item.stock_actual + cant : item.stock_actual - cant}
                          </span>
                        )}
                        {esConteo && diffConteo !== null && (
                          <span className={
                            diffConteo > 0 ? 'text-emerald-600 font-semibold'
                              : diffConteo < 0 ? 'text-red-600 font-semibold'
                              : 'text-slate-500'
                          }>
                            {' → '}{cant} ({diffConteo > 0 ? `+${diffConteo}` : diffConteo === 0 ? 'sin diferencia' : diffConteo})
                          </span>
                        )}
                      </p>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.cantidad}
                      onChange={e => cambiarCantidad(item.producto_id, e.target.value)}
                      placeholder={esConteo ? String(item.stock_actual) : '0'}
                      className={`w-24 px-2 py-1.5 text-sm text-right border rounded-lg outline-none transition-all ${
                        sinStock
                          ? 'border-red-300 bg-red-50 text-red-700 focus:ring-2 focus:ring-red-300'
                          : esConteo
                            ? 'border-violet-200 bg-violet-50/40 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500'
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

        {/* Detalle / Notas */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">
            {esConteo ? 'Motivo del conteo físico' : 'Detalle / Notas'} <span className="text-red-400">*</span>
          </label>
          <textarea
            value={motivo}
            onChange={e => { setMotivo(e.target.value); setError(''); submitKeyRef.current = { signature: null, key: null } }}
            rows={2}
            placeholder={
              esConteo ? 'Ej: Conteo físico pasillo A / Auditoría semanal...'
              : motivoTipo === 'compra_proveedor' ? 'Ej: Compra proveedor Ferretotal, Factura #1234...'
              : motivoTipo === 'ajuste_inventario' ? 'Ej: Ajuste por conteo físico, diferencia detectada...'
              : motivoTipo === 'merma' ? 'Ej: Merma mensual, producto dañado en almacén...'
              : motivoTipo === 'devolucion' ? 'Ej: Devolución de cliente, producto defectuoso...'
              : motivoTipo === 'transferencia' ? 'Ej: Transferencia a sucursal Valencia...'
              : 'Describe el motivo del movimiento...'
            }
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all resize-none"
          />
        </div>

        {/* Alerta amarilla no bloqueante por posible carga repetida (N32) */}
        {alertasDuplicado.length > 0 && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-300 rounded-xl">
            <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900 space-y-0.5">
              <p className="font-bold">Posible carga repetida en las últimas 24h</p>
              <p>
                Ya existe un ingreso por la misma cantidad en{' '}
                {alertasDuplicado.map(a => `${a.nombre} (+${a.cantidad})`).join(', ')}. Verifica antes de confirmar si no es un lote distinto.
              </p>
            </div>
          </div>
        )}

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
              esConteo ? 'bg-violet-600 hover:bg-violet-700 shadow-violet-600/20'
                : esIngreso ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
                : 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
            }`}>
            {pending ? (
              <><Loader2 size={16} className="animate-spin" /> Aplicando...</>
            ) : esConteo ? (
              <><ClipboardCheck size={16} /> Aplicar conteo ({itemsValidos.length})</>
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
