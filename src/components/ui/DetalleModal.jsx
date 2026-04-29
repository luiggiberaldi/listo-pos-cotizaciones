// src/components/ui/DetalleModal.jsx
// Modal genérico de detalle para cotizaciones y despachos
import { useEffect, useState } from 'react'
import { X, Package, Loader2, Calendar, User, FileText, CreditCard, Hash, Truck, DollarSign } from 'lucide-react'
import supabase from '../../services/supabase/client'
import { apiUrl } from '../../services/apiBase'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import useAuthStore from '../../store/useAuthStore'
import { useTasaCambio } from '../../hooks/useTasaCambio'

function calcDescMonto(desc, totalLinea, cantidad) {
  if (!desc) return 0
  const v = Number(desc.valor)
  if (!v || v <= 0) return 0
  if (desc.tipo === 'porcentaje') return Math.round(totalLinea * v / 100 * 10000) / 10000
  return Math.round(Math.min(v * Number(cantidad), totalLinea) * 10000) / 10000
}

function ItemRow({ item, descuento, fmt }) {
  const cant     = Number(item.cantidad || 1)
  const precio   = Number(item.precio_unit_usd || 0)
  const total    = Number(item.total_linea_usd || cant * precio)
  const descMonto = calcDescMonto(descuento, total, cant)
  const totalFinal = total - descMonto

  return (
    <tr className={`border-b border-slate-100 last:border-0 ${descMonto > 0 ? 'bg-amber-50/70' : ''}`}>
      <td className="py-3 pr-3">
        <p className="text-sm font-medium text-slate-800 leading-tight">{item.nombre_snap}</p>
        {item.codigo_snap && <p className="text-[11px] text-slate-400 font-mono mt-0.5">{item.codigo_snap}</p>}
        {descMonto > 0 && (
          <p className="text-[11px] text-amber-600 mt-0.5 font-medium">
            Desc: {descuento.tipo === 'porcentaje' ? `${descuento.valor}%` : `${fmt(descuento.valor)}/u`} = -{fmt(descMonto)}
          </p>
        )}
      </td>
      <td className="py-3 px-3 text-center text-sm text-slate-600 whitespace-nowrap">
        {cant} <span className="text-slate-400 text-[11px]">{item.unidad_snap || 'und'}</span>
      </td>
      <td className="py-3 px-3 text-right text-sm text-slate-600 whitespace-nowrap">
        {descMonto > 0 ? (
          <span>
            <span className="line-through text-slate-400">{fmt(precio)}</span>
            <br /><span className="text-amber-700 font-medium">{fmt(cant > 0 ? totalFinal / cant : 0)}</span>
          </span>
        ) : fmt(precio)}
      </td>
      <td className="py-3 pl-3 text-right text-sm font-bold whitespace-nowrap">
        {descMonto > 0 ? (
          <span>
            <span className="line-through text-slate-400 font-normal text-xs">{fmt(total)}</span>
            <br /><span className="text-amber-700">{fmt(totalFinal)}</span>
          </span>
        ) : <span className="text-slate-800">{fmt(total)}</span>}
      </td>
    </tr>
  )
}

function ItemCard({ item, descuento, fmt }) {
  const cant     = Number(item.cantidad || 1)
  const precio   = Number(item.precio_unit_usd || 0)
  const total    = Number(item.total_linea_usd || cant * precio)
  const descMonto = calcDescMonto(descuento, total, cant)
  const totalFinal = total - descMonto

  return (
    <div className={`py-3 border-b border-slate-100 last:border-0 ${descMonto > 0 ? 'bg-amber-50/70 -mx-3 px-3 rounded-lg' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 leading-tight">{item.nombre_snap}</p>
          {item.codigo_snap && <p className="text-[11px] text-slate-400 font-mono mt-0.5">{item.codigo_snap}</p>}
        </div>
        {descMonto > 0 ? (
          <div className="text-right shrink-0">
            <span className="text-xs text-slate-400 line-through">{fmt(total)}</span>
            <p className="text-sm font-bold text-amber-700">{fmt(totalFinal)}</p>
          </div>
        ) : (
          <span className="text-sm font-bold text-slate-800 shrink-0">{fmt(total)}</span>
        )}
      </div>
      <div className="flex gap-3 mt-1 text-xs text-slate-500">
        <span>{cant} {item.unidad_snap || 'und'}</span>
        <span>× {fmt(precio)}</span>
      </div>
      {descMonto > 0 && (
        <p className="text-[11px] text-amber-600 mt-1 font-medium">
          Desc: {descuento.tipo === 'porcentaje' ? `${descuento.valor}%` : `${fmt(descuento.valor)}/u`} = -{fmt(descMonto)}
        </p>
      )}
    </div>
  )
}

export default function DetalleModal({ isOpen, onClose, tipo = 'cotizacion', registro, tasa = 0 }) {
  const [items, setItems]       = useState([])
  const [cargando, setCargando] = useState(false)
  const [descuentos, setDescuentos] = useState({}) // { cotizacion_item_id: { tipo, valor } }
  const { perfil } = useAuthStore()
  const { tasaBcv, tasaUsdt } = useTasaCambio()

  // Leer moneda seleccionada del PDF (compartida via localStorage)
  const monedaPdf = typeof window !== 'undefined'
    ? (localStorage.getItem('construacero_moneda_pdf') || '$')
    : '$'

  // Función de formato según moneda seleccionada (solo para cotizaciones)
  const esCot = tipo === 'cotizacion'
  const factorBcv = tasaBcv.precio > 0 && tasaUsdt.precio > 0
    ? tasaUsdt.precio / tasaBcv.precio
    : 0
  const fmt = esCot && monedaPdf === 'bcv' && factorBcv > 0
    ? (n) => `$${(Number(n || 0) * factorBcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : esCot && monedaPdf === 'bs' && tasa > 0
      ? (n) => fmtBs(Number(n || 0) * tasa)
      : fmtUsd
  const monedaTag = esCot && monedaPdf === 'bcv' ? 'BCV' : esCot && monedaPdf === 'bs' ? 'Bs' : null

  useEffect(() => {
    if (!isOpen || !registro) return
    const cotizacionId = tipo === 'cotizacion' ? registro.id : registro.cotizacion_id
    if (!cotizacionId) return

    setCargando(true)
    supabase
      .from('cotizacion_items')
      .select('id, producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
      .then(({ data }) => {
        setItems(data ?? [])
        setCargando(false)
      })

    // Cargar descuentos si es despacho
    if (!esCot && registro.id) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.access_token) return
        fetch(apiUrl(`/api/despachos/${registro.id}/descuentos`), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).then(r => r.ok ? r.json() : []).then(data => {
          const m = {}
          for (const d of (data || [])) m[d.cotizacion_item_id] = { tipo: d.tipo, valor: d.valor }
          setDescuentos(m)
        }).catch(() => {})
      })
    } else {
      setDescuentos({})
    }

  }, [isOpen, registro?.id, registro?.cotizacion_id])

  if (!isOpen || !registro) return null

  const numDisplay = esCot
    ? `COT-${String(registro.numero).padStart(5, '0')}`
    : `DES-${String(registro.numero).padStart(5, '0')}`

  const vendedorColor = registro.vendedor?.color || '#64748b'
  const envio     = Number(registro.costo_envio_usd || 0)
  const total     = Number(registro.total_usd     || 0)
  const notas     = registro.notas_cliente || registro.observaciones || ''

  // Parse formas de pago para despachos
  let formasDisplay = []
  if (!esCot && registro.forma_pago) {
    try {
      const parsed = JSON.parse(registro.forma_pago)
      if (Array.isArray(parsed)) formasDisplay = parsed
    } catch { formasDisplay = [{ metodo: registro.forma_pago, monto: null }] }
  }

  const tieneTransporte = !esCot && (registro.transportista?.nombre || Number(registro.flete_usd || 0) > 0)
  const tienePago = !esCot && (formasDisplay.length > 0 || registro.referencia_pago)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">

        {/* Header */}
        <div className="relative h-16 shrink-0 flex items-end justify-between px-5 pb-3"
          style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
          <div className="relative z-10">
            <p className="font-black text-white text-base font-mono leading-tight drop-shadow">{numDisplay}</p>
          </div>
          <button onClick={onClose}
            className="relative z-10 p-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* ── Info general ── */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Calendar size={12} className="text-slate-400" /> {fmtFecha(registro.creado_en)}</span>
          {registro.vendedor?.nombre && (
            <span className="inline-flex items-center gap-1"><User size={12} className="text-slate-400" /> <strong style={{ color: vendedorColor }}>{registro.vendedor.nombre}</strong></span>
          )}
          {!esCot && registro.cotizacion && (
            <span className="inline-flex items-center gap-1"><FileText size={12} className="text-slate-400" /> <strong className="font-mono text-slate-700">
              COT-{String(registro.cotizacion.numero).padStart(5, '0')}
            </strong></span>
          )}
        </div>

        {/* ── Bloque Pago (solo despachos) ── */}
        {tienePago && (
          <div className="mx-5 mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard size={11} /> Pago
            </p>
            <div className="flex flex-wrap gap-1.5">
              {formasDisplay.map((fp, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700">
                  {fp.metodo}
                  {fp.monto != null && <span className="text-emerald-600 font-bold">${Number(fp.monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                </span>
              ))}
            </div>
            {registro.referencia_pago && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Hash size={10} className="text-slate-400" /> Ref: <span className="font-mono font-medium text-slate-700">{registro.referencia_pago}</span>
              </p>
            )}
          </div>
        )}

        {/* ── Bloque Transporte (solo despachos, si hay transportista o flete) ── */}
        {tieneTransporte && (
          <div className="mx-5 mt-2 rounded-xl bg-blue-50/60 border border-blue-200 p-3">
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
              <Truck size={11} /> Transporte
            </p>
            <div className="flex items-center justify-between gap-3">
              {registro.transportista?.nombre && (
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{registro.transportista.nombre}</p>
                  {(registro.transportista.vehiculo || registro.transportista.placa_chuto) && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {[registro.transportista.vehiculo, registro.transportista.placa_chuto, registro.transportista.placa_batea].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              )}
              {Number(registro.flete_usd || 0) > 0 && (
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-medium text-slate-400 uppercase">Flete</p>
                  <p className="text-sm font-bold text-emerald-700">{fmtUsd(registro.flete_usd)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Cliente ── */}
        {(registro.cliente_factura || registro.cliente)?.nombre && (
          <div className="px-5 py-2.5 mt-1 border-b border-slate-100">
            {registro.cliente_factura && registro.cliente && registro.cliente_factura.id !== registro.cliente.id ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide">Cotizó</span>
                  <span className="text-xs font-medium truncate max-w-[250px]" style={{ color: registro.cliente.vendedor?.color || '#475569' }}>{registro.cliente.nombre}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-amber-500 uppercase tracking-wide font-semibold">Facturó</span>
                  <span className="text-xs font-bold truncate max-w-[250px]"
                    style={{ color: registro.cliente_factura.vendedor?.color || vendedorColor }}>
                    {registro.cliente_factura.nombre}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Cliente</span>
                <span className="text-xs font-semibold truncate max-w-[300px]"
                  style={{ color: (registro.cliente_factura || registro.cliente)?.vendedor?.color || vendedorColor }}>
                  {(registro.cliente_factura || registro.cliente).nombre}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tabla de productos */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Package size={12} />Productos
          </p>

          {cargando ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" />Cargando productos...
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Sin productos registrados</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="overflow-x-auto hidden sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      <th className="pb-2 text-left pr-3">Producto</th>
                      <th className="pb-2 text-center px-3">Cant.</th>
                      <th className="pb-2 text-right px-3">Precio</th>
                      <th className="pb-2 text-right pl-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => <ItemRow key={it.id} item={it} descuento={descuentos[it.id]} fmt={fmt} />)}
                  </tbody>
                </table>
              </div>
              {/* Mobile card layout */}
              <div className="sm:hidden">
                {items.map(it => <ItemCard key={it.id} item={it} descuento={descuentos[it.id]} fmt={fmt} />)}
              </div>
            </>
          )}

          {/* Notas */}
          {notas && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
              <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wider mb-1">Notas</p>
              {notas}
            </div>
          )}
        </div>

        {/* Totales */}
        {esCot && (
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 space-y-1.5 shrink-0">
            {monedaTag && (
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${monedaPdf === 'bcv' ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'}`}>
                  {monedaTag}
                </span>
                <span className="text-[10px] text-slate-400">
                  {monedaPdf === 'bcv' ? `Factor: ${factorBcv.toFixed(2)}` : `Tasa: ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/$`}
                </span>
              </div>
            )}
            {envio > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Costo de envío</span><span>{fmt(envio)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-slate-800 text-base pt-1 border-t border-slate-200">
              <span>Total</span><span>{fmt(total)}</span>
            </div>
            {monedaPdf !== 'bs' && tasa > 0 && (
              <div className="flex justify-end text-xs text-slate-400">
                <span>{fmtBs(usdToBs(total, tasa))}</span>
              </div>
            )}
          </div>
        )}
        {!esCot && (() => {
          const flete = Number(registro.flete_usd || 0)
          const descuento = Number(registro.descuento_total_usd || 0)
          const totalConFlete = total // total_usd ya incluye el flete
          const subtotal = total - flete // total de productos sin flete
          const totalFinal = totalConFlete - descuento
          const hayDesglose = descuento > 0 || flete > 0

          return (
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 shrink-0 space-y-1.5">
            {hayDesglose && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Subtotal</span><span>{fmtUsd(subtotal)}</span>
              </div>
            )}
            {descuento > 0 && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>Descuento</span><span>-{fmtUsd(descuento)}</span>
              </div>
            )}
            {flete > 0 && (
              <div className="flex justify-between text-xs text-emerald-600">
                <span>Flete</span><span>+{fmtUsd(flete)}</span>
              </div>
            )}
            <div className={`flex justify-between font-black text-slate-800 text-base ${hayDesglose ? 'pt-1 border-t border-slate-200' : ''}`}>
              <span>Total</span><span>{fmtUsd(totalFinal)}</span>
            </div>
            {tasa > 0 && (
              <div className="flex justify-end text-xs text-slate-400">
                <span>{fmtBs(usdToBs(totalFinal, tasa))}</span>
              </div>
            )}
          </div>
          )
        })()}
      </div>
    </div>
  )
}
