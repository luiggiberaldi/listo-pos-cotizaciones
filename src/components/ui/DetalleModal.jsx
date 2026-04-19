// src/components/ui/DetalleModal.jsx
// Modal genérico de detalle para cotizaciones y despachos
import { useEffect, useState } from 'react'
import { X, Package, Loader2, Calendar, Clock, User, FileText, History } from 'lucide-react'
import supabase from '../../services/supabase/client'
import { fmtUsdSimple as fmtUsd, fmtFecha } from '../../utils/format'
import useAuthStore from '../../store/useAuthStore'

function ItemRow({ item, tasa = 0 }) {
  const cant     = Number(item.cantidad || 1)
  const precio   = Number(item.precio_unit_usd || 0)
  const desc     = Number(item.descuento_pct || 0)
  const total    = Number(item.total_linea_usd || cant * precio * (1 - desc / 100))

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-3 pr-3">
        <p className="text-sm font-medium text-slate-800 leading-tight">{item.nombre_snap}</p>
        {item.codigo_snap && <p className="text-[11px] text-slate-400 font-mono mt-0.5">{item.codigo_snap}</p>}
      </td>
      <td className="py-3 px-3 text-center text-sm text-slate-600 whitespace-nowrap">
        {cant} <span className="text-slate-400 text-[11px]">{item.unidad_snap || 'und'}</span>
      </td>
      <td className="py-3 px-3 text-right text-sm text-slate-600 whitespace-nowrap">{fmtUsd(precio)}</td>
      <td className="py-3 px-3 text-center text-sm text-slate-500 whitespace-nowrap hidden sm:table-cell">
        {desc > 0 ? `${desc}%` : <span className="text-slate-300">—</span>}
      </td>
      <td className="py-3 pl-3 text-right text-sm font-bold text-slate-800 whitespace-nowrap">{fmtUsd(total)}</td>
    </tr>
  )
}

function ItemCard({ item }) {
  const cant     = Number(item.cantidad || 1)
  const precio   = Number(item.precio_unit_usd || 0)
  const desc     = Number(item.descuento_pct || 0)
  const total    = Number(item.total_linea_usd || cant * precio * (1 - desc / 100))

  return (
    <div className="py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 leading-tight">{item.nombre_snap}</p>
          {item.codigo_snap && <p className="text-[11px] text-slate-400 font-mono mt-0.5">{item.codigo_snap}</p>}
        </div>
        <span className="text-sm font-bold text-slate-800 shrink-0">{fmtUsd(total)}</span>
      </div>
      <div className="flex gap-3 mt-1 text-xs text-slate-500">
        <span>{cant} {item.unidad_snap || 'und'}</span>
        <span>× {fmtUsd(precio)}</span>
        {desc > 0 && <span className="text-emerald-600">-{desc}%</span>}
      </div>
    </div>
  )
}

export default function DetalleModal({ isOpen, onClose, tipo = 'cotizacion', registro, tasa = 0 }) {
  const [items, setItems]       = useState([])
  const [cargando, setCargando] = useState(false)
  const [versiones, setVersiones] = useState([])
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  useEffect(() => {
    if (!isOpen || !registro) return
    const cotizacionId = tipo === 'cotizacion' ? registro.id : registro.cotizacion_id
    if (!cotizacionId) return

    setCargando(true)
    supabase
      .from('cotizacion_items')
      .select('producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
      .then(({ data }) => {
        setItems(data ?? [])
        setCargando(false)
      })

    // Cargar historial de versiones para supervisor
    if (esSupervisor && tipo === 'cotizacion' && registro.numero) {
      supabase
        .from('cotizaciones')
        .select('id, version, estado, total_usd, creado_en, vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombre)')
        .eq('numero', registro.numero)
        .order('version', { ascending: true })
        .then(({ data }) => {
          setVersiones(data && data.length > 1 ? data : [])
        })
    } else {
      setVersiones([])
    }
  }, [isOpen, registro?.id, registro?.cotizacion_id])

  if (!isOpen || !registro) return null

  const esCot = tipo === 'cotizacion'
  const numDisplay = esCot
    ? (registro.version > 1
        ? `COT-${String(registro.numero).padStart(5, '0')} Rev.${registro.version}`
        : `COT-${String(registro.numero).padStart(5, '0')}`)
    : `DES-${String(registro.numero).padStart(5, '0')}`

  const vendedorColor = registro.vendedor?.color || '#64748b'
  const subtotal  = Number(registro.subtotal_usd  || 0)
  const descuento = Number(registro.descuento_usd || 0)
  const envio     = Number(registro.costo_envio_usd || 0)
  const total     = Number(registro.total_usd     || 0)
  const notas     = registro.notas_cliente || registro.observaciones || ''

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
            {registro.cliente?.nombre && (
              <p className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>{registro.cliente.nombre}</p>
            )}
          </div>
          <button onClick={onClose}
            className="relative z-10 p-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Meta info */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Calendar size={12} className="text-slate-400" /> Creada: <strong className="text-slate-700">{fmtFecha(registro.creado_en)}</strong></span>
          {registro.valida_hasta && (
            <span className="inline-flex items-center gap-1"><Clock size={12} className="text-slate-400" /> Válida hasta: <strong className={new Date(registro.valida_hasta) < new Date() ? 'text-red-500' : 'text-slate-700'}>{fmtFecha(registro.valida_hasta)}</strong></span>
          )}
          {registro.vendedor?.nombre && (
            <span className="inline-flex items-center gap-1"><User size={12} className="text-slate-400" /> Vendedor: <strong style={{ color: vendedorColor }}>{registro.vendedor.nombre}</strong></span>
          )}
          {!esCot && registro.cotizacion && (
            <span className="inline-flex items-center gap-1"><FileText size={12} className="text-slate-400" /> Ref: <strong className="font-mono text-slate-700">
              COT-{String(registro.cotizacion.numero).padStart(5, '0')}{registro.cotizacion.version > 1 ? ` Rev.${registro.cotizacion.version}` : ''}
            </strong></span>
          )}
        </div>

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
                      <th className="pb-2 text-center px-3">Desc.</th>
                      <th className="pb-2 text-right pl-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => <ItemRow key={it.id} item={it} tasa={tasa} />)}
                  </tbody>
                </table>
              </div>
              {/* Mobile card layout */}
              <div className="sm:hidden">
                {items.map(it => <ItemCard key={it.id} item={it} />)}
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

          {/* Historial de versiones (solo supervisor, solo cotizaciones con >1 versión) */}
          {versiones.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <History size={12} />Historial de revisiones
              </p>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                {versiones.map((v, i) => {
                  const esCurrent = v.id === registro.id
                  const estadoLabel = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', anulada: 'Anulada', vencida: 'Vencida' }
                  return (
                    <div key={v.id} className={`px-3 py-2 flex items-center justify-between text-xs ${i > 0 ? 'border-t border-slate-100' : ''} ${esCurrent ? 'bg-primary-light/50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${esCurrent ? 'text-primary' : 'text-slate-600'}`}>
                          Rev.{v.version}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          v.estado === 'enviada' ? 'bg-blue-100 text-blue-700' :
                          v.estado === 'aceptada' ? 'bg-emerald-100 text-emerald-700' :
                          v.estado === 'rechazada' ? 'bg-red-100 text-red-700' :
                          v.estado === 'anulada' ? 'bg-slate-200 text-slate-500' :
                          v.estado === 'borrador' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {estadoLabel[v.estado] || v.estado}
                        </span>
                        {v.vendedor?.nombre && <span className="text-slate-400">{v.vendedor.nombre}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-slate-500">
                        <span>{fmtFecha(v.creado_en)}</span>
                        <span className="font-medium text-slate-700">{fmtUsd(v.total_usd)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Totales */}
        {esCot && (
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 space-y-1.5 shrink-0">
            {subtotal > 0 && descuento > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Subtotal</span><span>{fmtUsd(subtotal)}</span>
              </div>
            )}
            {descuento > 0 && (
              <div className="flex justify-between text-xs text-emerald-600">
                <span>Descuento ({registro.descuento_global_pct}%)</span><span>-{fmtUsd(descuento)}</span>
              </div>
            )}
            {envio > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Costo de envío</span><span>{fmtUsd(envio)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-slate-800 text-base pt-1 border-t border-slate-200">
              <span>Total</span><span>{fmtUsd(total)}</span>
            </div>
          </div>
        )}
        {!esCot && (
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 shrink-0">
            <div className="flex justify-between font-black text-slate-800 text-base">
              <span>Total</span><span>{fmtUsd(total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
