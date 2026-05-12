// src/components/despachos/DescuentoModal.jsx
// Modal de descuentos por artículo — solo logística/supervisor
import { useEffect, useState, useMemo, useCallback } from 'react'
import { X, Tag, Loader2, Trash2, AlertCircle, ChevronRight, Truck, ChevronLeft, Check } from 'lucide-react'
import supabase from '../../services/supabase/client'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import { useDespachoDescuentos, useGuardarDescuentos } from '../../hooks/useDespachoDescuentos'

function calcMonto(tipo, valor, totalLinea, cantidad) {
  if (tipo === 'nuevo_precio') {
    if (valor === '' || Number(valor) < 0) return 0
    const v = Number(valor)
    const precioOriginal = totalLinea / Number(cantidad)
    if (v >= precioOriginal) return 0
    return Math.round((precioOriginal - v) * Number(cantidad) * 10000) / 10000
  }
  if (!valor || Number(valor) <= 0) return 0
  const v = Number(valor)
  if (tipo === 'porcentaje') return v > 100 ? totalLinea : Math.round(totalLinea * v / 100 * 10000) / 10000
  if (tipo === 'monto_unitario') { const m = v * Number(cantidad); return Math.round(Math.min(m, totalLinea) * 10000) / 10000 }
  return Math.round(Math.min(v, totalLinea) * 10000) / 10000
}

function getError(d, item) {
  if (!d?.valor || d.valor === '') return null
  const v = Number(d.valor), t = Number(item.total_linea_usd)
  if (d.tipo === 'nuevo_precio') {
    const precioUnit = Number(item.precio_unit_usd)
    if (v < 0) return 'No puede ser negativo'
    if (v >= precioUnit) return `Debe ser menor a ${fmtUsd(precioUnit)}`
    return null
  }
  if (d.tipo === 'porcentaje' && v > 100) return 'Máximo 100%'
  if (d.tipo === 'monto_unitario' && v * Number(item.cantidad) > t) return `Máximo ${fmtUsd(t / Number(item.cantidad))}/u`
  if (d.tipo === 'monto' && v > t) return 'Excede el total'
  return null
}

/* ─── Tarjeta de artículo (edición) ────────────────────────────────────── */
function ItemRow({ item, desc, montoDesc, soloLectura, editandoId, onEdit, onUpdate, onRemove }) {
  const total = Number(item.total_linea_usd || 0)
  const precioUnit = Number(item.precio_unit_usd || 0)
  const cantidad = Number(item.cantidad || 0)
  const tiene = !!desc && montoDesc > 0
  const editando = editandoId === item.id
  const error = desc ? getError(desc, item) : null
  const nuevoTotal = total - montoDesc
  const nuevoPrecioUnit = cantidad > 0 ? nuevoTotal / cantidad : 0

  return (
    <div className={`transition-all rounded-2xl ${
      editando ? 'bg-amber-50 ring-1 ring-amber-200' :
      tiene ? 'bg-amber-50/50 ring-1 ring-amber-100' :
      'bg-white ring-1 ring-slate-100'
    }`}>
      <button type="button"
        onClick={() => !soloLectura && onEdit(editando ? null : item.id)}
        disabled={soloLectura && !tiene}
        className={`w-full text-left px-4 py-3 ${soloLectura ? 'cursor-default' : 'cursor-pointer active:bg-black/[0.02]'} transition-colors rounded-2xl`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-800 leading-snug truncate">{item.nombre_snap}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {item.codigo_snap && <span className="font-mono mr-1.5">{item.codigo_snap}</span>}
              {cantidad} {item.unidad_snap || 'und'}
            </p>
          </div>
          {!soloLectura && (
            <div className="flex items-center gap-1 shrink-0 mt-0.5 -mr-1">
              {tiene && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(item.id)
                  }}
                  className="p-1.5 text-amber-500/70 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Eliminar descuento"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <ChevronRight size={16} className={`transition-transform ${editando ? 'rotate-90 text-amber-500' : 'text-slate-300'}`} />
            </div>
          )}
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide leading-none mb-0.5">Precio unit.</p>
            {tiene ? (
              <p className="text-[13px] leading-tight">
                <span className="text-slate-400 line-through mr-1.5">{fmtUsd(precioUnit)}</span>
                <span className="font-bold text-amber-700">{fmtUsd(nuevoPrecioUnit)}</span>
              </p>
            ) : (
              <p className="text-[13px] font-semibold text-slate-700 leading-tight">{fmtUsd(precioUnit)}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide leading-none mb-0.5">Total</p>
            {tiene ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-400 line-through">{fmtUsd(total)}</span>
                <span className="text-[16px] font-bold text-amber-700 leading-tight">{fmtUsd(nuevoTotal)}</span>
              </div>
            ) : (
              <p className="text-[16px] font-bold text-slate-700 leading-tight">{fmtUsd(total)}</p>
            )}
          </div>
        </div>
      </button>

      {editando && !soloLectura && (
        <div className="px-4 pb-3.5 pt-1 space-y-2.5 border-t border-amber-100/80">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-[13px] pointer-events-none font-medium">$</span>
              <input type="number" inputMode="decimal" step="any" min="0"
                value={desc?.valor || ''} onChange={e => onUpdate(item.id, 'valor', e.target.value)}
                onFocus={e => e.target.select()} placeholder="Nuevo precio unitario..." autoFocus
                className={`w-full py-2 text-[15px] font-semibold rounded-lg tabular-nums focus:outline-none focus:ring-1 transition-all pl-7 pr-3 ${
                  error ? 'border border-red-300 bg-red-50/50 focus:ring-red-300 text-red-700' : 'border border-amber-200 bg-white focus:ring-amber-300 text-slate-800'
                }`} />
            </div>
          </div>
          {error && <p className="text-[11px] text-red-500 font-medium flex items-center gap-1 pl-0.5"><AlertCircle size={11} /> {error}</p>}
        </div>
      )}

      {soloLectura && tiene && (
        <div className="px-4 pb-3 -mt-1">
          <span className="inline-flex items-center gap-1 bg-amber-100/80 text-amber-700 rounded-md px-2 py-1 text-[11px] font-semibold">
            <Tag size={10} />
            {desc.tipo === 'nuevo_precio' ? `Nuevo precio: ${fmtUsd(desc.valor)}/u` : desc.tipo === 'porcentaje' ? `${desc.valor}%` : desc.tipo === 'monto_unitario' ? `${fmtUsd(desc.valor)}/u` : fmtUsd(desc.valor)}
            (Ahorro: {fmtUsd(montoDesc)})
          </span>
        </div>
      )}
    </div>
  )
}

/* ─── Pantalla de confirmación ─────────────────────────────────────────── */
function Confirmacion({ items, descLocal, calc, flete, subtotalProductos, totalDespacho, totalFinal, onConfirmar, onVolver, guardando }) {
  const itemsConDesc = items.filter(i => calc.porItem[i.id] > 0)
  const itemsSinDesc = items.filter(i => !calc.porItem[i.id])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header confirmación */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <button onClick={onVolver} disabled={guardando}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
            <ChevronLeft size={20} />
          </button>
          <div>
            <p className="text-[15px] font-bold text-slate-800">Confirmar descuentos</p>
            <p className="text-[11px] text-slate-400">Revisa el resumen antes de guardar</p>
          </div>
        </div>
      </div>

      {/* Informe scrolleable */}
      <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
        <div className="p-4 sm:p-5 pb-6 space-y-4">

          {/* Artículos CON descuento */}
          {itemsConDesc.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-2">
                Artículos con descuento ({itemsConDesc.length})
              </p>
              <div className="space-y-1">
                {itemsConDesc.map(item => {
                  const d = descLocal[item.id]
                  const monto = calc.porItem[item.id]
                  const total = Number(item.total_linea_usd)
                  const precioUnit = Number(item.precio_unit_usd)
                  const cant = Number(item.cantidad)
                  const nuevoTotal = total - monto
                  const nuevoPrecioUnit = cant > 0 ? nuevoTotal / cant : 0
                  const tipoLabel = d.tipo === 'nuevo_precio' ? `Precio final: ${fmtUsd(d.valor)}/u` : (d.tipo === 'porcentaje' ? `${d.valor}%` : fmtUsd(d.valor))

                  return (
                    <div key={item.id} className="bg-amber-50/60 rounded-xl px-3.5 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-slate-800 truncate">{item.nombre_snap}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {cant} {item.unidad_snap || 'und'} · Descuento: {tipoLabel}
                          </p>
                        </div>
                        <span className="text-[11px] font-bold text-amber-600 shrink-0">-{fmtUsd(monto)}</span>
                      </div>
                      <div className="flex justify-between mt-1.5 text-[11px]">
                        <div>
                          <span className="text-slate-400">Unit: </span>
                          <span className="text-slate-400 line-through">{fmtUsd(precioUnit)}</span>
                          <span className="text-amber-700 font-semibold ml-1">{fmtUsd(nuevoPrecioUnit)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Total: </span>
                          <span className="text-slate-400 line-through">{fmtUsd(total)}</span>
                          <span className="text-amber-700 font-bold ml-1">{fmtUsd(nuevoTotal)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Artículos SIN descuento */}
          {itemsSinDesc.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Sin cambios ({itemsSinDesc.length})
              </p>
              <div className="space-y-1">
                {itemsSinDesc.map(item => (
                  <div key={item.id} className="flex items-center justify-between bg-slate-50/60 rounded-xl px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-slate-500 truncate">{item.nombre_snap}</p>
                      <p className="text-[10px] text-slate-400">{Number(item.cantidad)} {item.unidad_snap || 'und'}</p>
                    </div>
                    <span className="text-[12px] font-semibold text-slate-500 tabular-nums shrink-0">{fmtUsd(item.total_linea_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resumen financiero */}
          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Resumen</p>

            <div className="flex justify-between text-[12px] text-slate-500">
              <span>Subtotal productos</span>
              <span className="tabular-nums">{fmtUsd(subtotalProductos)}</span>
            </div>

            {flete > 0 && (
              <div className="flex justify-between text-[12px] text-slate-500">
                <span className="flex items-center gap-1"><Truck size={11} /> Flete</span>
                <span className="tabular-nums">{fmtUsd(flete)}</span>
              </div>
            )}

            {calc.total > 0 && (
              <div className="flex justify-between text-[13px]">
                <span className="text-amber-600 font-semibold">Descuento total</span>
                <span className="font-bold text-amber-600 tabular-nums">-{fmtUsd(calc.total)}</span>
              </div>
            )}

            <div className="border-t border-dashed border-slate-300 my-1" />

            <div className="flex justify-between items-baseline">
              <span className="font-extrabold text-slate-800 text-[16px]">Total a cobrar</span>
              <span className="font-black text-slate-800 text-xl tabular-nums">{fmtUsd(Math.max(0, totalFinal))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Botones confirmar / volver */}
      <div className="shrink-0 px-5 pt-2 pb-4 sm:rounded-b-3xl space-y-2">
        <button onClick={onConfirmar} disabled={guardando}
          className="w-full py-3.5 rounded-2xl text-[14px] font-bold text-white transition-all
            shadow-lg active:shadow-sm active:translate-y-px
            bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 shadow-green-200/50
            disabled:opacity-60">
          {guardando
            ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Guardando...</span>
            : <span className="flex items-center justify-center gap-2"><Check size={16} /> Confirmar y guardar</span>
          }
        </button>
        <button onClick={onVolver} disabled={guardando}
          className="w-full py-2.5 rounded-2xl text-[13px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all">
          Volver a editar
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL PRINCIPAL
   ═══════════════════════════════════════════════════════════════════════════ */
export default function DescuentoModal({ isOpen, onClose, despacho }) {
  const [items, setItems] = useState([])
  const [cargandoItems, setCargandoItems] = useState(false)
  const [descLocal, setDescLocal] = useState({})
  const [editandoId, setEditandoId] = useState(null)
  const [confirmando, setConfirmando] = useState(false)

  const despachoId = despacho?.id
  const { data: guardados = [], isLoading: cargandoDesc } = useDespachoDescuentos(isOpen ? despachoId : null)
  const guardarMut = useGuardarDescuentos()

  useEffect(() => {
    if (!isOpen || !despacho?.cotizacion_id) return
    setCargandoItems(true)
    supabase
      .from('cotizacion_items')
      .select('id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,total_linea_usd,orden')
      .eq('cotizacion_id', despacho.cotizacion_id)
      .order('orden')
      .then(({ data }) => { setItems(data ?? []); setCargandoItems(false) })
  }, [isOpen, despacho?.cotizacion_id])

  useEffect(() => {
    if (!guardados.length || !items.length) { 
      if (!guardados.length) setDescLocal(prev => Object.keys(prev).length === 0 ? prev : {}); 
      return 
    }
    const m = {}
    for (const d of guardados) {
      const item = items.find(i => i.id === d.cotizacion_item_id)
      if (!item) continue
      const precioUnit = Number(item.precio_unit_usd)
      let nuevoPrecio = precioUnit
      if (d.tipo === 'monto_unitario') nuevoPrecio = precioUnit - Number(d.valor)
      else if (d.tipo === 'porcentaje') nuevoPrecio = precioUnit * (1 - Number(d.valor)/100)
      else if (d.tipo === 'nuevo_precio') nuevoPrecio = Number(d.valor)
      m[d.cotizacion_item_id] = { tipo: 'nuevo_precio', valor: String(Math.round(nuevoPrecio*10000)/10000) }
    }
    setDescLocal(prev => JSON.stringify(prev) === JSON.stringify(m) ? prev : m)
  }, [guardados, items])

  useEffect(() => { if (!isOpen) { setEditandoId(null); setConfirmando(false) } }, [isOpen])

  const calc = useMemo(() => {
    const porItem = {}
    let total = 0
    for (const item of items) {
      const d = descLocal[item.id]
      if (!d?.valor || d.valor === '') continue
      const m = calcMonto(d.tipo, d.valor, Number(item.total_linea_usd), item.cantidad)
      if (m > 0) { porItem[item.id] = m; total += m }
    }
    return { porItem, total: Math.round(total * 10000) / 10000 }
  }, [items, descLocal])

  const subtotalProductos = items.reduce((s, i) => s + Number(i.total_linea_usd || 0), 0)
  const flete = Number(despacho?.flete_usd || 0)
  const totalDespacho = Number(despacho?.total_usd || (subtotalProductos + flete))
  const totalFinal = totalDespacho - calc.total
  const tieneErrores = items.some(i => { const d = descLocal[i.id]; return d && getError(d, i) })

  const handleUpdate = useCallback((id, field, value) => {
    setDescLocal(prev => ({ ...prev, [id]: { ...(prev[id] || { tipo: 'nuevo_precio', valor: '' }), [field]: value } }))
  }, [])

  const handleRemove = useCallback(id => {
    setDescLocal(prev => { const n = { ...prev }; delete n[id]; return n })
    setEditandoId(null)
  }, [])

  const handleEdit = useCallback(id => {
    if (id && !descLocal[id]) {
      setDescLocal(prev => ({ ...prev, [id]: { tipo: 'nuevo_precio', valor: '' } }))
    }
    setEditandoId(id)
  }, [descLocal])

  async function handleConfirmar() {
    const descuentos = []
    for (const [id, d] of Object.entries(descLocal)) {
      if (d.valor === '') continue
      const v = Number(d.valor)
      const item = items.find(i => i.id === id)
      if (v < 0 || getError(d, item)) continue
      
      const precioUnit = Number(item.precio_unit_usd)
      const descuentoUnitario = precioUnit - v
      if (descuentoUnitario <= 0) continue

      descuentos.push({ cotizacionItemId: id, tipo: 'monto_unitario', valor: Math.round(descuentoUnitario * 10000) / 10000 })
    }
    await guardarMut.mutateAsync({ despachoId, descuentos })
    setConfirmando(false)
    onClose()
  }

  if (!isOpen || !despacho) return null
  const cargando = cargandoItems || cargandoDesc
  const soloLectura = !['pendiente', 'despachada'].includes(despacho.estado)
  const nDesc = Object.keys(calc.porItem).length

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && !confirmando && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md sm:mx-4
        max-h-[88vh] sm:max-h-[85vh] flex flex-col pb-[env(safe-area-inset-bottom)]">

        {/* ── Vista de confirmación ──────────────────────────────────── */}
        {confirmando ? (
          <Confirmacion
            items={items} descLocal={descLocal} calc={calc}
            flete={flete} subtotalProductos={subtotalProductos}
            totalDespacho={totalDespacho} totalFinal={totalFinal}
            onConfirmar={handleConfirmar}
            onVolver={() => setConfirmando(false)}
            guardando={guardarMut.isPending}
          />
        ) : (
          <>
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-4 rounded-t-3xl sm:rounded-t-3xl"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <div>
                <p className="font-bold text-white text-base leading-tight">Descuentos</p>
                <p className="text-[11px] text-white/70 font-medium mt-0.5">
                  Despacho #{String(despacho.numero).padStart(5, '0')}
                </p>
              </div>
              <button onClick={onClose}
                className="p-2 -mr-1 rounded-xl bg-white/15 hover:bg-white/25 transition-colors">
                <X size={16} className="text-white" />
              </button>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
              {cargando ? (
                <div className="flex items-center justify-center py-20 gap-2 text-slate-400">
                  <Loader2 size={20} className="animate-spin text-amber-400" />
                  <span className="text-sm">Cargando...</span>
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-20">Sin artículos</p>
              ) : (
                <div className="p-3 sm:p-4 space-y-2">
                  {items.map(item => (
                    <ItemRow key={item.id} item={item}
                      desc={descLocal[item.id]} montoDesc={calc.porItem[item.id] || 0}
                      soloLectura={soloLectura} editandoId={editandoId}
                      onEdit={handleEdit} onUpdate={handleUpdate} onRemove={handleRemove} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {!cargando && items.length > 0 && (
              <div className="shrink-0 border-t border-slate-100 px-5 pt-3 pb-4 sm:rounded-b-3xl">
                <div className="space-y-1 mb-3">
                  <div className="flex justify-between text-[12px] text-slate-400">
                    <span>Subtotal productos</span>
                    <span className="tabular-nums">{fmtUsd(subtotalProductos)}</span>
                  </div>
                  {flete > 0 && (
                    <div className="flex justify-between text-[12px] text-slate-400">
                      <span className="flex items-center gap-1"><Truck size={11} /> Flete</span>
                      <span className="tabular-nums">{fmtUsd(flete)}</span>
                    </div>
                  )}
                  {calc.total > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-amber-600 font-medium">Descuento{nDesc > 1 ? ` (${nDesc} arts.)` : ''}</span>
                      <span className="font-bold text-amber-600 tabular-nums">-{fmtUsd(calc.total)}</span>
                    </div>
                  )}
                  <div className="border-t border-dashed border-slate-200 my-1" />
                  <div className="flex justify-between items-baseline">
                    <span className="font-extrabold text-slate-800 text-[15px]">Total a cobrar</span>
                    <span className="font-black text-slate-800 text-lg tabular-nums">{fmtUsd(Math.max(0, totalFinal))}</span>
                  </div>
                </div>

                {!soloLectura && (
                  <button onClick={() => setConfirmando(true)}
                    disabled={tieneErrores}
                    className={`w-full py-3.5 rounded-2xl text-[14px] font-bold text-white transition-all
                      shadow-lg active:shadow-sm active:translate-y-px ${
                      tieneErrores ? 'bg-slate-300 cursor-not-allowed shadow-none'
                        : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-amber-200/50'
                    }`}>
                    {tieneErrores ? 'Corrige los errores'
                      : calc.total > 0 ? `Revisar y guardar (-${fmtUsd(calc.total)})` : 'Guardar descuentos'
                    }
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
