// src/components/inventario/KardexModal.jsx
// Kardex profesional — historial completo de movimientos de un producto
import { useState, useMemo } from 'react'
import { Modal } from '../ui/Modal'
import {
  ArrowDownToLine, ArrowUpFromLine, Clock, Package, Hash,
  TrendingUp, TrendingDown, BarChart3, Layers, ChevronDown, ChevronUp, User,
} from 'lucide-react'
import { useKardex } from '../../hooks/useMovimientosInventario'
import { MOTIVOS_TIPO, formatCorrelativo, getMotivoChipClasses } from '../../utils/motivosTipo'

function formatFecha(ts) {
  return new Date(ts).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Tarjeta resumen ─────────────────────────────────────────────────────────
function SummaryCard({ icon: Icon, label, value, color, suffix }) {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red:     'bg-red-50 text-red-700 border-red-200',
    sky:     'bg-sky-50 text-sky-700 border-sky-200',
    slate:   'bg-slate-50 text-slate-600 border-slate-200',
  }
  const iconColor = {
    emerald: 'text-emerald-500',
    red:     'text-red-500',
    sky:     'text-sky-500',
    slate:   'text-slate-400',
  }
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} className={iconColor[color]} />
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <p className="text-lg font-black leading-none">
        {typeof value === 'number' ? value.toLocaleString('es-VE') : value}
        {suffix && <span className="text-xs font-medium ml-1 opacity-60">{suffix}</span>}
      </p>
    </div>
  )
}

export default function KardexModal({ isOpen, onClose, producto }) {
  const { data: movimientos = [], isLoading } = useKardex(producto?.id)
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [expandedRows, setExpandedRows] = useState(new Set())

  // Filtrar por fechas (client-side)
  const movimientosFiltrados = useMemo(() => {
    let result = movimientos
    if (fechaDesde) result = result.filter(m => m.creado_en >= fechaDesde + 'T00:00:00')
    if (fechaHasta) result = result.filter(m => m.creado_en <= fechaHasta + 'T23:59:59')
    return result
  }, [movimientos, fechaDesde, fechaHasta])

  // Resúmenes
  const stats = useMemo(() => {
    const ingresos = movimientosFiltrados.filter(m => m.tipo === 'ingreso')
    const egresos = movimientosFiltrados.filter(m => m.tipo === 'egreso')
    return {
      totalIngresos: ingresos.reduce((s, m) => s + Number(m.cantidad), 0),
      totalEgresos: egresos.reduce((s, m) => s + Number(m.cantidad), 0),
      count: movimientosFiltrados.length,
    }
  }, [movimientosFiltrados])

  function toggleRow(id) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!producto) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Kardex" className="max-w-2xl sm:max-w-4xl">
      <div className="space-y-4">

        {/* ── Encabezado del producto ─────────────────────────────────────── */}
        <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
          <div className="w-11 h-11 rounded-xl bg-sky-100 flex items-center justify-center shrink-0 overflow-hidden">
            {producto.imagen_url
              ? <img src={producto.imagen_url} alt="" className="w-full h-full object-cover rounded-xl" />
              : <Package size={20} className="text-sky-500" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-800 truncate">{producto.nombre}</h3>
            <div className="flex items-center gap-3 mt-0.5">
              {producto.codigo && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                  <Hash size={9} />{producto.codigo}
                </span>
              )}
              <span className="text-[11px] text-slate-400">
                {producto.categoria || 'Sin categoría'}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-slate-400 uppercase font-bold">Stock actual</p>
            <p className="text-xl font-black text-slate-800 leading-none">
              {Number(producto.stock_actual).toLocaleString('es-VE')}
              <span className="text-xs font-medium text-slate-400 ml-1">{producto.unidad}</span>
            </p>
          </div>
        </div>

        {/* ── Tarjetas resumen ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryCard icon={TrendingUp} label="Ingresos" value={stats.totalIngresos} color="emerald" suffix={producto.unidad} />
          <SummaryCard icon={TrendingDown} label="Egresos" value={stats.totalEgresos} color="red" suffix={producto.unidad} />
          <SummaryCard icon={BarChart3} label="Stock" value={Number(producto.stock_actual)} color="sky" suffix={producto.unidad} />
          <SummaryCard icon={Layers} label="Movimientos" value={stats.count} color="slate" />
        </div>

        {/* ── Filtro de fechas ────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">Filtrar:</span>
          <input
            type="date"
            value={fechaDesde}
            onChange={e => setFechaDesde(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-sky-500/30"
          />
          <span className="text-slate-300">—</span>
          <input
            type="date"
            value={fechaHasta}
            onChange={e => setFechaHasta(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-sky-500/30"
          />
          {(fechaDesde || fechaHasta) && (
            <button onClick={() => { setFechaDesde(''); setFechaHasta('') }}
              className="text-slate-400 hover:text-red-500 underline transition-colors">
              Limpiar
            </button>
          )}
        </div>

        {/* ── Tabla de movimientos ────────────────────────────────────────── */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-[3px] border-sky-300 border-t-sky-500 rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 mt-3">Cargando kardex...</p>
          </div>
        ) : movimientosFiltrados.length === 0 ? (
          <div className="text-center py-12">
            <Package size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">Sin movimientos</p>
            <p className="text-xs text-slate-300 mt-1">
              {fechaDesde || fechaHasta ? 'No hay movimientos en el rango seleccionado' : 'Este producto no tiene ingresos ni egresos registrados'}
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[70px_1fr_60px_70px_70px] sm:grid-cols-[80px_1fr_60px_70px_70px_70px_1fr] gap-1 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <span>Correlat.</span>
              <span>Fecha</span>
              <span className="text-center">Tipo</span>
              <span className="text-right">Cant.</span>
              <span className="text-right">Saldo</span>
              <span className="hidden sm:block text-center">Categoría</span>
              <span className="hidden sm:block">Motivo</span>
            </div>

            {/* Filas */}
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar divide-y divide-slate-50">
              {movimientosFiltrados.map((m, idx) => {
                const esIngreso = m.tipo === 'ingreso'
                const motivoCfg = MOTIVOS_TIPO[m.motivo_tipo] || MOTIVOS_TIPO.otro
                const motivoColors = getMotivoChipClasses(m.motivo_tipo)
                const isExpanded = expandedRows.has(m.id)
                const motivoLargo = m.motivo && m.motivo.length > 40

                return (
                  <div key={m.id}>
                    <div
                      className={`grid grid-cols-[70px_1fr_60px_70px_70px] sm:grid-cols-[80px_1fr_60px_70px_70px_70px_1fr] gap-1 px-3 py-2.5 hover:bg-slate-50/50 transition-colors items-center cursor-pointer ${
                        idx % 2 === 0 ? '' : 'bg-slate-50/30'
                      }`}
                      onClick={() => motivoLargo && toggleRow(m.id)}
                    >
                      {/* Correlativo */}
                      <span className="text-[11px] font-mono font-bold text-slate-600">
                        {formatCorrelativo(m.numero)}
                      </span>

                      {/* Fecha + Usuario */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Clock size={10} className="text-slate-300 shrink-0" />
                          <span className="text-[11px] text-slate-500 truncate">{formatFecha(m.creado_en)}</span>
                        </div>
                        <div className="flex items-center gap-1 ml-3.5">
                          {m.usuario_color && (
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.usuario_color }} />
                          )}
                          <User size={9} className="text-slate-300" />
                          <span className="text-[10px] text-slate-400 truncate">{m.usuario_nombre || 'Sin usuario'}</span>
                        </div>
                      </div>

                      {/* Tipo */}
                      <div className="flex justify-center">
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          esIngreso ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {esIngreso
                            ? <ArrowDownToLine size={9} />
                            : <ArrowUpFromLine size={9} />
                          }
                          {esIngreso ? 'Ing' : 'Egr'}
                        </span>
                      </div>

                      {/* Cantidad */}
                      <span className={`text-sm font-bold text-right ${esIngreso ? 'text-emerald-600' : 'text-red-600'}`}>
                        {esIngreso ? '+' : '-'}{Number(m.cantidad).toLocaleString('es-VE')}
                      </span>

                      {/* Saldo */}
                      <span className="text-sm font-bold text-slate-700 text-right">
                        {Number(m.stock_nuevo).toLocaleString('es-VE')}
                      </span>

                      {/* Categoría */}
                      <div className="hidden sm:flex justify-center">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${motivoColors.bg} ${motivoColors.text} ${motivoColors.border}`}>
                          <span className={`w-1 h-1 rounded-full ${motivoColors.dot}`} />
                          {motivoCfg.label}
                        </span>
                      </div>

                      {/* Motivo */}
                      <div className="hidden sm:flex items-center gap-1 min-w-0">
                        <span className="text-[11px] text-slate-400 truncate">{m.motivo || ''}</span>
                        {motivoLargo && (
                          isExpanded
                            ? <ChevronUp size={10} className="text-slate-300 shrink-0" />
                            : <ChevronDown size={10} className="text-slate-300 shrink-0" />
                        )}
                      </div>
                    </div>

                    {/* Motivo expandido (mobile + desktop con texto largo) */}
                    {isExpanded && (
                      <div className="px-4 py-2 bg-slate-50/50 border-t border-slate-100">
                        <p className="text-xs text-slate-500">{m.motivo}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Resumen footer */}
            <div className="border-t border-slate-200 px-3 py-2.5 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">{movimientosFiltrados.length} movimiento{movimientosFiltrados.length !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-emerald-600 font-bold">
                  + {stats.totalIngresos.toLocaleString('es-VE')} ingresos
                </span>
                <span className="text-[11px] text-red-600 font-bold">
                  - {stats.totalEgresos.toLocaleString('es-VE')} egresos
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
