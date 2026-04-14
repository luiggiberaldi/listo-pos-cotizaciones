// src/components/cotizaciones/CotizacionBuilder.jsx
// Constructor de cotizaciones — crear y editar borradores
// Flujo: seleccionar cliente → agregar productos → ajustar → guardar/enviar
import { useState, useEffect, useCallback } from 'react'
import {
  User, Truck, Search, Plus, Trash2, ChevronDown,
  Save, Send, ArrowLeft, Loader2, AlertCircle, DollarSign,
} from 'lucide-react'
import { useClientes }         from '../../hooks/useClientes'
import { useInventario }       from '../../hooks/useInventario'
import { useTransportistas }   from '../../hooks/useTransportistas'
import { useGuardarBorrador, useEnviarCotizacion } from '../../hooks/useCotizaciones'
import { round2, round4 }      from '../../utils/dinero'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'
import { getLocalISODate }     from '../../utils/dateHelpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _itemCounter = 0

function calcTotales(items, descGlobalPct, costoEnvio) {
  const subtotal    = round2(items.reduce((s, it) =>
    round2(s + round2(it.cantidad * it.precioUnitUsd * (1 - it.descuentoPct / 100))), 0))
  const descuentoUsd = round2(subtotal * (Number(descGlobalPct) || 0) / 100)
  const totalUsd     = round2(subtotal - descuentoUsd + (Number(costoEnvio) || 0))
  return { subtotal, descuentoUsd, totalUsd }
}

// ─── Línea de ítem ────────────────────────────────────────────────────────────
function ItemLinea({ item, idx, onChange, onDelete }) {
  const lineTotal = round2(item.cantidad * item.precioUnitUsd * (1 - item.descuentoPct / 100))

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/50">
      <td className="py-2 px-3 text-sm text-slate-800 max-w-[180px]">
        <div className="font-medium truncate">{item.nombreSnap}</div>
        {item.codigoSnap && <div className="text-xs text-slate-400 font-mono">{item.codigoSnap}</div>}
      </td>
      <td className="py-2 px-2 text-xs text-slate-400">{item.unidadSnap}</td>
      <td className="py-2 px-2">
        <input type="number" min="0.01" step="0.01"
          value={item.cantidad}
          onChange={e => onChange(idx, 'cantidad', Math.max(0.01, Number(e.target.value)))}
          className="w-20 px-2 py-1 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
        />
      </td>
      <td className="py-2 px-2">
        <input type="number" min="0" step="0.01"
          value={item.precioUnitUsd}
          onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
          className="w-24 px-2 py-1 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
        />
      </td>
      <td className="py-2 px-2">
        <div className="flex items-center">
          <input type="number" min="0" max="100" step="0.5"
            value={item.descuentoPct}
            onChange={e => onChange(idx, 'descuentoPct', Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-16 px-2 py-1 text-sm text-right border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
          <span className="ml-1 text-xs text-slate-400">%</span>
        </div>
      </td>
      <td className="py-2 px-2 text-sm font-semibold text-slate-800 text-right">
        {fmtUsd(lineTotal)}
      </td>
      <td className="py-2 px-2">
        <button onClick={() => onDelete(idx)}
          className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

// ─── Tarjeta de ítem (móvil) ────────────────────────────────────────────────
function ItemCard({ item, idx, onChange, onDelete }) {
  const lineTotal = round2(item.cantidad * item.precioUnitUsd * (1 - item.descuentoPct / 100))

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-slate-800 truncate">{item.nombreSnap}</p>
          {item.codigoSnap && <p className="text-xs text-slate-400 font-mono">{item.codigoSnap}</p>}
          <p className="text-xs text-slate-400">{item.unidadSnap}</p>
        </div>
        <button onClick={() => onDelete(idx)}
          className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Cantidad</label>
          <input type="number" min="0.01" step="0.01"
            value={item.cantidad}
            onChange={e => onChange(idx, 'cantidad', Math.max(0.01, Number(e.target.value)))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Precio USD</label>
          <input type="number" min="0" step="0.01"
            value={item.precioUnitUsd}
            onChange={e => onChange(idx, 'precioUnitUsd', Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Desc. %</label>
          <input type="number" min="0" max="100" step="0.5"
            value={item.descuentoPct}
            onChange={e => onChange(idx, 'descuentoPct', Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-full px-3 py-2.5 text-sm text-right border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-focus bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500">Total</label>
          <div className="px-3 py-2.5 text-sm text-right font-bold text-slate-800 bg-white border border-slate-200 rounded-xl">
            {fmtUsd(lineTotal)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Buscador de productos ────────────────────────────────────────────────────
function BuscadorProductos({ onAgregar }) {
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const { data: productos = [], isLoading } = useInventario({ busqueda })

  function buscar(e) { e.preventDefault(); setBusqueda(texto) }

  return (
    <div className="space-y-3">
      <form onSubmit={buscar} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input type="text" value={texto} onChange={e => setTexto(e.target.value)}
            placeholder="Buscar producto por nombre o código..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary"
          />
        </div>
        <button type="submit" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors">
          Buscar
        </button>
      </form>

      {isLoading && <p className="text-xs text-slate-400">Buscando...</p>}

      {productos.length > 0 && (
        <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
          {productos.map(p => (
            <button key={p.id} type="button" onClick={() => onAgregar(p)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-primary-light/50 transition-colors text-left">
              <div>
                <p className="text-sm font-medium text-slate-800">{p.nombre}</p>
                <p className="text-xs text-slate-400">{p.codigo ?? ''} · {p.unidad}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-semibold text-slate-700">{fmtUsd(p.precio_usd)}</span>
                <Plus size={14} className="text-primary" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Modal de envío (pide tasa BCV) ──────────────────────────────────────────
function ModalEnvio({ isOpen, onConfirm, onCancel, cargando }) {
  const [tasa, setTasa] = useState('')
  const [error, setError] = useState('')

  if (!isOpen) return null

  function confirmar() {
    if (!tasa || isNaN(Number(tasa)) || Number(tasa) <= 0) {
      setError('Ingresa la tasa BCV vigente')
      return
    }
    onConfirm(Number(tasa))
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-4 sm:p-6 space-y-4">
        <h3 className="font-black text-slate-800 text-lg">Enviar cotización</h3>
        <p className="text-sm text-slate-500">
          Ingresa la tasa BCV del día para calcular el total en Bs. Este valor quedará registrado en la cotización.
        </p>
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <DollarSign size={14} className="text-slate-400" />
            Tasa BCV (Bs por USD)
          </label>
          <input type="number" min="0.01" step="0.01" value={tasa}
            onChange={e => { setTasa(e.target.value); setError('') }}
            placeholder="Ej: 48.50"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-focus"
            autoFocus
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando ? <><Loader2 size={15} className="animate-spin" />Enviando...</> : 'Confirmar envío'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CotizacionBuilder({ cotizacionExistente = null, onVolver, onGuardado }) {
  const esEdicion = !!cotizacionExistente

  // Estado del formulario
  const [clienteId,          setClienteId]          = useState(cotizacionExistente?.cliente_id ?? '')
  const [transportistaId,    setTransportistaId]    = useState(cotizacionExistente?.transportista_id ?? '')
  const [validaHasta,        setValidaHasta]        = useState(cotizacionExistente?.valida_hasta ?? '')
  const [notasCliente,       setNotasCliente]       = useState(cotizacionExistente?.notas_cliente ?? '')
  const [notasInternas,      setNotasInternas]      = useState(cotizacionExistente?.notas_internas ?? '')
  const [descuentoGlobalPct, setDescuentoGlobalPct] = useState(cotizacionExistente?.descuento_global_pct ?? 0)
  const [costoEnvioUsd,      setCostoEnvioUsd]      = useState(cotizacionExistente?.costo_envio_usd ?? 0)
  const [items,              setItems]              = useState(
    (cotizacionExistente?.items ?? []).map(it => ({
      _key:          `item-${++_itemCounter}`,
      productoId:    it.producto_id,
      codigoSnap:    it.codigo_snap,
      nombreSnap:    it.nombre_snap,
      unidadSnap:    it.unidad_snap,
      cantidad:      Number(it.cantidad),
      precioUnitUsd: Number(it.precio_unit_usd),
      descuentoPct:  Number(it.descuento_pct),
    }))
  )

  const [errorGeneral,  setErrorGeneral]  = useState('')
  const [modalEnvio,    setModalEnvio]    = useState(false)
  const [cotizacionId,  setCotizacionId]  = useState(cotizacionExistente?.id ?? null)

  const { data: clientes      = [] } = useClientes()
  const { data: transportistas = [] } = useTransportistas()
  const guardarBorrador  = useGuardarBorrador()
  const enviarCotizacion = useEnviarCotizacion()

  const { subtotal, descuentoUsd, totalUsd } = calcTotales(items, descuentoGlobalPct, costoEnvioUsd)

  // ── Agregar producto ─────────────────────────────────────────────────────
  function agregarProducto(p) {
    setItems(prev => [...prev, {
      _key:          `item-${++_itemCounter}`,
      productoId:    p.id,
      codigoSnap:    p.codigo ?? '',
      nombreSnap:    p.nombre,
      unidadSnap:    p.unidad ?? 'und',
      cantidad:      1,
      precioUnitUsd: Number(p.precio_usd),
      descuentoPct:  0,
    }])
  }

  // ── Cambiar campo de un ítem ─────────────────────────────────────────────
  function cambiarItem(idx, campo, valor) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [campo]: valor } : it))
  }

  // ── Eliminar ítem ────────────────────────────────────────────────────────
  function eliminarItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Validar antes de guardar ─────────────────────────────────────────────
  function validar() {
    if (!clienteId) return 'Selecciona un cliente'
    if (items.length === 0) return 'Agrega al menos un producto'
    return null
  }

  // ── Guardar borrador ─────────────────────────────────────────────────────
  async function handleGuardar() {
    const err = validar()
    if (err) { setErrorGeneral(err); return }
    setErrorGeneral('')

    try {
      const id = await guardarBorrador.mutateAsync({
        cotizacionId,
        campos: { clienteId, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd },
        items,
      })
      setCotizacionId(id)
      onGuardado?.()
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al guardar')
    }
  }

  // ── Enviar cotización ────────────────────────────────────────────────────
  async function handleEnviar(tasaBcv) {
    // Primero guardar el borrador actualizado
    const err = validar()
    if (err) { setErrorGeneral(err); setModalEnvio(false); return }

    try {
      let id = cotizacionId
      if (!id) {
        id = await guardarBorrador.mutateAsync({
          cotizacionId,
          campos: { clienteId, transportistaId, validaHasta, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd },
          items,
        })
        setCotizacionId(id)
      }
      await enviarCotizacion.mutateAsync({ cotizacionId: id, tasaBcv })
      setModalEnvio(false)
      onGuardado?.()
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al enviar')
      setModalEnvio(false)
    }
  }

  const cargando = guardarBorrador.isPending || enviarCotizacion.isPending

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <div className="min-h-full bg-slate-50">

      {/* ── Header del builder ────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={onVolver}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="font-bold text-slate-800 text-base md:text-lg truncate">
            {esEdicion
              ? cotizacionExistente.version > 1
                ? `Editar Rev.${cotizacionExistente.version} — COT-${String(cotizacionExistente.numero).padStart(5,'0')}`
                : `Editar borrador — COT-${String(cotizacionExistente.numero).padStart(5,'0')}`
              : 'Nueva cotización'}
          </h2>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2">
          <button onClick={handleGuardar} disabled={cargando}
            className="flex items-center gap-2 px-3 md:px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
            {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            <span className="hidden sm:inline">Guardar borrador</span>
          </button>
          <button onClick={() => { const e = validar(); if (e) { setErrorGeneral(e); return } setErrorGeneral(''); setModalEnvio(true) }}
            disabled={cargando}
            className="flex items-center gap-2 px-3 md:px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
            {enviarCotizacion.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            <span className="hidden sm:inline">Enviar cotización</span>
          </button>
        </div>
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-6">

        {/* Error general */}
        {errorGeneral && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} className="shrink-0" />
            {errorGeneral}
          </div>
        )}

        {/* ── Sección 1: Cliente + Transportista ─────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
            1. Cliente y envío
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Cliente */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <User size={14} className="text-slate-400" /> Cliente *
              </label>
              <select value={clienteId} onChange={e => setClienteId(e.target.value)}
                className={inputCls} disabled={cargando}>
                <option value="">Seleccionar cliente...</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.rif_cedula ? ` (${c.rif_cedula})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Transportista */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Truck size={14} className="text-slate-400" /> Transportista
              </label>
              <select value={transportistaId} onChange={e => setTransportistaId(e.target.value)}
                className={inputCls} disabled={cargando}>
                <option value="">Sin transportista</option>
                {transportistas.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}{t.zona_cobertura ? ` — ${t.zona_cobertura}` : ''}
                    {t.tarifa_base > 0 ? ` ($${Number(t.tarifa_base).toFixed(2)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Válida hasta */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Válida hasta</label>
              <input type="date" value={validaHasta} onChange={e => setValidaHasta(e.target.value)}
                min={getLocalISODate()} className={inputCls} disabled={cargando} />
            </div>
          </div>
        </div>

        {/* ── Sección 2: Productos ────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
            2. Productos
          </h3>

          {/* Buscador */}
          <BuscadorProductos onAgregar={agregarProducto} />

          {/* Tabla de ítems */}
          {items.length > 0 && (
            <>
              {/* Desktop: tabla */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="text-left py-2 px-3">Producto</th>
                    <th className="text-left py-2 px-2">Unidad</th>
                    <th className="text-right py-2 px-2">Cantidad</th>
                    <th className="text-right py-2 px-2">Precio USD</th>
                    <th className="text-right py-2 px-2">Desc.</th>
                    <th className="text-right py-2 px-2">Total</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <ItemLinea key={it._key} item={it} idx={idx}
                      onChange={cambiarItem} onDelete={eliminarItem} />
                  ))}
                </tbody>
              </table>
              </div>
              {/* Móvil: cards */}
              <div className="md:hidden space-y-3">
                {items.map((it, idx) => (
                  <ItemCard key={it._key} item={it} idx={idx}
                    onChange={cambiarItem} onDelete={eliminarItem} />
                ))}
              </div>
            </>
          )}

          {items.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">
              Busca y agrega productos a la cotización
            </p>
          )}
        </div>

        {/* ── Sección 3: Totales ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
            3. Descuentos y totales
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Inputs */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Descuento global (%)</label>
                <input type="number" min="0" max="100" step="0.5"
                  value={descuentoGlobalPct}
                  onChange={e => setDescuentoGlobalPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                  className={inputCls} disabled={cargando} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Costo de envío (USD)</label>
                <input type="number" min="0" step="0.01"
                  value={costoEnvioUsd}
                  onChange={e => setCostoEnvioUsd(Math.max(0, Number(e.target.value)))}
                  className={inputCls} disabled={cargando} />
              </div>
            </div>

            {/* Resumen */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium">{fmtUsd(subtotal)}</span>
              </div>
              {descuentoUsd > 0 && (
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>Descuento ({descuentoGlobalPct}%)</span>
                  <span>-{fmtUsd(descuentoUsd)}</span>
                </div>
              )}
              {costoEnvioUsd > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Envío</span>
                  <span>{fmtUsd(costoEnvioUsd)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-800 text-lg border-t border-slate-200 pt-2 mt-2">
                <span>TOTAL</span>
                <span>{fmtUsd(totalUsd)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sección 4: Notas ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
            4. Notas
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Notas para el cliente <span className="text-slate-400">(aparece en PDF)</span>
              </label>
              <textarea value={notasCliente} onChange={e => setNotasCliente(e.target.value)}
                rows={3} placeholder="Ej: Precios válidos por 15 días..."
                className={`${inputCls} resize-none`} disabled={cargando} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Notas internas <span className="text-slate-400">(no aparece en PDF)</span>
              </label>
              <textarea value={notasInternas} onChange={e => setNotasInternas(e.target.value)}
                rows={3} placeholder="Observaciones internas..."
                className={`${inputCls} resize-none`} disabled={cargando} />
            </div>
          </div>
        </div>

        {/* Botones inferiores */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pb-8">
          <button onClick={onVolver} disabled={cargando}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleGuardar} disabled={cargando}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-semibold text-sm transition-colors disabled:opacity-50">
            {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Guardar borrador
          </button>
          <button onClick={() => { const e = validar(); if (e) { setErrorGeneral(e); return } setErrorGeneral(''); setModalEnvio(true) }}
            disabled={cargando}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors disabled:opacity-50">
            <Send size={15} />
            Enviar cotización
          </button>
        </div>
      </div>

      {/* Modal de envío */}
      <ModalEnvio
        isOpen={modalEnvio}
        onConfirm={handleEnviar}
        onCancel={() => setModalEnvio(false)}
        cargando={enviarCotizacion.isPending}
      />
    </div>
  )
}
