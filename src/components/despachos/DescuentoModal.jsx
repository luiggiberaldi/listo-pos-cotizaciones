// src/components/despachos/DescuentoModal.jsx
// Modal para aplicar descuentos por artículo en un despacho (solo logística/supervisor)
import { useEffect, useState, useMemo } from 'react'
import { X, Tag, Loader2, Trash2, Plus } from 'lucide-react'
import supabase from '../../services/supabase/client'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import { useDespachoDescuentos, useGuardarDescuentos } from '../../hooks/useDespachoDescuentos'

const TIPOS = [
  { key: 'porcentaje', label: '%', desc: 'del total' },
  { key: 'monto', label: '$', desc: 'fijo' },
  { key: 'monto_unitario', label: '$/u', desc: 'por unidad' },
]

export default function DescuentoModal({ isOpen, onClose, despacho }) {
  const [items, setItems] = useState([])
  const [cargandoItems, setCargandoItems] = useState(false)
  // { [cotizacionItemId]: { tipo: 'porcentaje'|'monto'|'monto_unitario', valor: string } }
  const [descLocal, setDescLocal] = useState({})

  const despachoId = despacho?.id
  const { data: descuentosGuardados = [], isLoading: cargandoDesc } = useDespachoDescuentos(isOpen ? despachoId : null)
  const guardarMut = useGuardarDescuentos()

  // Cargar ítems de la cotización
  useEffect(() => {
    if (!isOpen || !despacho?.cotizacion_id) return
    setCargandoItems(true)
    supabase
      .from('cotizacion_items')
      .select('id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden')
      .eq('cotizacion_id', despacho.cotizacion_id)
      .order('orden')
      .then(({ data }) => {
        setItems(data ?? [])
        setCargandoItems(false)
      })
  }, [isOpen, despacho?.cotizacion_id])

  // Inicializar descuentos locales cuando se cargan los guardados
  useEffect(() => {
    if (!descuentosGuardados.length) {
      setDescLocal({})
      return
    }
    const map = {}
    for (const d of descuentosGuardados) {
      map[d.cotizacion_item_id] = { tipo: d.tipo, valor: String(d.valor) }
    }
    setDescLocal(map)
  }, [descuentosGuardados])

  // Calcular montos de descuento
  const calculos = useMemo(() => {
    const result = {}
    let totalDesc = 0
    for (const item of items) {
      const d = descLocal[item.id]
      if (!d || !d.valor || Number(d.valor) <= 0) continue
      const totalLinea = Number(item.total_linea_usd)
      const valor = Number(d.valor)
      let monto
      if (d.tipo === 'porcentaje') {
        monto = valor > 100 ? totalLinea : totalLinea * valor / 100
      } else if (d.tipo === 'monto_unitario') {
        monto = valor * Number(item.cantidad)
        if (monto > totalLinea) monto = totalLinea
      } else {
        monto = valor > totalLinea ? totalLinea : valor
      }
      monto = Math.round(monto * 10000) / 10000
      result[item.id] = monto
      totalDesc += monto
    }
    return { porItem: result, totalDescuento: totalDesc }
  }, [items, descLocal])

  const subtotalOriginal = items.reduce((s, i) => s + Number(i.total_linea_usd || 0), 0)
  const totalFinal = Number(despacho?.total_usd || subtotalOriginal) - calculos.totalDescuento
  const itemsConDescuento = Object.keys(descLocal).length

  function toggleDescuento(itemId) {
    setDescLocal(prev => {
      if (prev[itemId]) {
        const next = { ...prev }
        delete next[itemId]
        return next
      }
      return { ...prev, [itemId]: { tipo: 'porcentaje', valor: '' } }
    })
  }

  function updateDesc(itemId, field, value) {
    setDescLocal(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }))
  }

  function descExplicacion(d, item) {
    if (!d || !d.valor || Number(d.valor) <= 0) return null
    const v = Number(d.valor)
    const cant = Number(item.cantidad)
    if (d.tipo === 'porcentaje') return `${v}% de ${fmtUsd(item.total_linea_usd)}`
    if (d.tipo === 'monto_unitario') return `${fmtUsd(v)} × ${cant} ${item.unidad_snap || 'und'}`
    return null
  }

  async function handleGuardar() {
    const descuentos = []
    for (const [itemId, d] of Object.entries(descLocal)) {
      const valor = Number(d.valor)
      if (valor <= 0) continue
      descuentos.push({ cotizacionItemId: itemId, tipo: d.tipo, valor })
    }
    await guardarMut.mutateAsync({ despachoId, descuentos })
    onClose()
  }

  if (!isOpen || !despacho) return null

  const cargando = cargandoItems || cargandoDesc
  const soloLectura = !['pendiente', 'despachada'].includes(despacho.estado)

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">

        {/* Header */}
        <div className="relative shrink-0 flex items-center justify-between px-5 py-3.5"
          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Tag size={15} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-white text-sm leading-tight">
                Descuentos
              </p>
              <p className="text-[11px] text-white/70 font-medium">
                DES-{String(despacho.numero).padStart(5, '0')}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl bg-white/15 hover:bg-white/25 transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {cargando ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" />Cargando...
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">Sin productos</p>
          ) : (
            items.map(item => {
              const totalLinea = Number(item.total_linea_usd || 0)
              const tieneDesc = !!descLocal[item.id]
              const montoDesc = calculos.porItem[item.id] || 0
              const d = descLocal[item.id]
              const valorInvalido = d && d.tipo === 'porcentaje' && Number(d.valor) > 100
              const valorExcede = d && d.tipo === 'monto' && Number(d.valor) > totalLinea
              const valorExcedeUnit = d && d.tipo === 'monto_unitario' && Number(d.valor) * Number(item.cantidad) > totalLinea
              const hayError = valorInvalido || valorExcede || valorExcedeUnit
              const explicacion = d ? descExplicacion(d, item) : null

              return (
                <div key={item.id} className={`rounded-xl transition-all ${
                  tieneDesc
                    ? 'bg-amber-50 ring-1 ring-amber-200 shadow-sm'
                    : 'bg-slate-50 ring-1 ring-slate-100'
                }`}>
                  {/* Info del producto */}
                  <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 leading-tight truncate">{item.nombre_snap}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {item.codigo_snap && <span className="font-mono mr-2">{item.codigo_snap}</span>}
                        {Number(item.cantidad)} {item.unidad_snap || 'und'} × {fmtUsd(item.precio_unit_usd)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {tieneDesc && montoDesc > 0 ? (
                        <>
                          <p className="text-[11px] text-slate-400 line-through leading-tight">{fmtUsd(totalLinea)}</p>
                          <p className="text-sm font-bold text-amber-700 leading-tight">{fmtUsd(totalLinea - montoDesc)}</p>
                        </>
                      ) : (
                        <p className="text-sm font-bold text-slate-700">{fmtUsd(totalLinea)}</p>
                      )}
                    </div>
                  </div>

                  {/* Controles de descuento */}
                  {!soloLectura && (
                    <div className="px-3.5 pb-3">
                      {!tieneDesc ? (
                        <button
                          onClick={() => toggleDescuento(item.id)}
                          className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-amber-600 transition-colors py-0.5"
                        >
                          <Plus size={12} /> Agregar descuento
                        </button>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            {/* Selector tipo */}
                            <div className="flex rounded-lg overflow-hidden ring-1 ring-amber-200 bg-white">
                              {TIPOS.map(t => (
                                <button
                                  key={t.key}
                                  onClick={() => updateDesc(item.id, 'tipo', t.key)}
                                  className={`px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                                    d.tipo === t.key
                                      ? 'bg-amber-500 text-white shadow-inner'
                                      : 'text-amber-600/70 hover:bg-amber-50'
                                  }`}
                                  title={t.desc}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>

                            {/* Input valor */}
                            <div className="relative flex-1 max-w-[120px]">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                value={d.valor}
                                onChange={e => updateDesc(item.id, 'valor', e.target.value)}
                                onFocus={e => e.target.select()}
                                placeholder="0"
                                className={`w-full pl-2.5 pr-2 py-1.5 text-sm font-medium border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                                  hayError
                                    ? 'border-red-300 bg-red-50 focus:ring-red-200 text-red-700'
                                    : 'border-amber-200 bg-white focus:ring-amber-300 text-slate-800'
                                }`}
                              />
                            </div>

                            {/* Preview monto */}
                            {montoDesc > 0 && (
                              <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                                hayError ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                              }`}>
                                -{fmtUsd(montoDesc)}
                              </span>
                            )}

                            {/* Eliminar */}
                            <button
                              onClick={() => toggleDescuento(item.id)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all ml-auto"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Explicación contextual */}
                          {explicacion && (
                            <p className="text-[10px] text-amber-500 pl-1 font-medium">{explicacion}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Solo lectura: mostrar descuento existente */}
                  {soloLectura && tieneDesc && montoDesc > 0 && (
                    <div className="px-3.5 pb-3">
                      <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 rounded-md px-2 py-1 text-[11px] font-medium">
                        <Tag size={10} />
                        {d.tipo === 'porcentaje' ? `${d.valor}%` : d.tipo === 'monto_unitario' ? `${fmtUsd(d.valor)}/u` : fmtUsd(d.valor)}
                        <span className="text-amber-500">(-{fmtUsd(montoDesc)})</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3.5 bg-gradient-to-b from-slate-50 to-white shrink-0">
          {/* Resumen */}
          <div className="space-y-1.5 mb-3">
            {calculos.totalDescuento > 0 && (
              <>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal</span>
                  <span>{fmtUsd(Number(despacho?.total_usd || subtotalOriginal))}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-amber-600 flex items-center gap-1">
                    <Tag size={10} />
                    Descuentos ({itemsConDescuento} {itemsConDescuento === 1 ? 'artículo' : 'artículos'})
                  </span>
                  <span className="font-bold text-amber-600">-{fmtUsd(calculos.totalDescuento)}</span>
                </div>
                <div className="border-t border-dashed border-slate-200 pt-1.5" />
              </>
            )}
            <div className="flex justify-between font-black text-slate-800 text-base">
              <span>Total final</span>
              <span>{fmtUsd(Math.max(0, totalFinal))}</span>
            </div>
          </div>

          {!soloLectura && (
            <button
              onClick={handleGuardar}
              disabled={guardarMut.isPending}
              className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50
                bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:from-amber-700 active:to-amber-800
                shadow-lg shadow-amber-200/50 active:shadow-sm active:translate-y-px"
            >
              {guardarMut.isPending ? (
                <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Guardando...</span>
              ) : (
                'Guardar descuentos'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
