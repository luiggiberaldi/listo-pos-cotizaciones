// src/views/ComisionesView.jsx
// Vista de comisiones por despacho entregado
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, CheckCircle, Clock, Filter, TrendingUp, Eye, X, FileText, ArrowLeft } from 'lucide-react'
import { useComisiones, useComisionesResumen, useMarcarComisionPagada } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd, fmtFecha } from '../utils/format'
import PageHeader    from '../components/ui/PageHeader'
import Skeleton      from '../components/ui/Skeleton'
import EmptyState    from '../components/ui/EmptyState'
import ConfirmModal  from '../components/ui/ConfirmModal'

// ─── Tarjeta de resumen ───────────────────────────────────────────────────────
function ResumenCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3 cursor-default"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}>
      {/* Orbe decorativo */}
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-center gap-2.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={18} className="text-white" />
        </div>
        <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
      </div>
      <div className="relative z-10">
        <p className="text-2xl font-black leading-tight text-white">{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</p>}
      </div>
    </div>
  )
}

// ─── Tarjeta de comisión ──────────────────────────────────────────────────────
function ComisionCard({ comision, esSupervisor, onMarcarPagada, marcando, onVerDetalle }) {
  const esPendiente = comision.estado === 'pendiente'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 hover:shadow-lg transition-all duration-200">

      {/* Header: vendedor + estado */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-black"
            style={{ background: comision.vendedor?.color || '#1B365D' }}>
            {(comision.vendedor?.nombre || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">
              {comision.vendedor?.nombre ?? 'Vendedor'}
            </p>
            <p className="text-xs text-slate-400">
              Despacho #{comision.despacho?.numero ?? '—'} · Cot. #{comision.cotizacion?.numero ?? '—'}
            </p>
          </div>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 border ${
          esPendiente
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {esPendiente ? 'Pendiente' : 'Pagada'}
        </span>
      </div>

      {/* Desglose */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
          <p className="text-slate-400 font-medium mb-0.5">Cabilla ({comision.pct_cabilla}%)</p>
          <p className="text-slate-600 font-semibold">{fmtUsd(comision.monto_cabilla)}</p>
          <p className="text-emerald-600 font-black">{fmtUsd(comision.comision_cabilla)}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
          <p className="text-slate-400 font-medium mb-0.5">Otros ({comision.pct_otros}%)</p>
          <p className="text-slate-600 font-semibold">{fmtUsd(comision.monto_otros)}</p>
          <p className="text-emerald-600 font-black">{fmtUsd(comision.comision_otros)}</p>
        </div>
      </div>

      {/* Total + acción */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400 font-medium">Total comisión</p>
          <p className="text-xl font-black text-slate-800">{fmtUsd(comision.total_comision)}</p>
        </div>
        <div className="flex items-center gap-2">
          {onVerDetalle && (
            <button
              onClick={() => onVerDetalle(comision.vendedor)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Eye size={13} />Ver detalle
            </button>
          )}
          {esSupervisor && esPendiente && (
            <button
              onClick={() => onMarcarPagada(comision)}
              disabled={marcando}
              className="flex items-center gap-1.5 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-md"
              style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}
            >
              <CheckCircle size={13} />
              Marcar pagada
            </button>
          )}
        </div>
        {!esPendiente && !onVerDetalle && comision.estado === 'pagada' && comision.pagada_en && (
          <p className="text-xs text-slate-400">
            {new Date(comision.pagada_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Skeleton de comisiones ───────────────────────────────────────────────────
function SkeletonComisiones() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/3 rounded" />
              <Skeleton className="h-2.5 w-1/2 rounded" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <Skeleton className="h-6 w-1/3 rounded" />
            <Skeleton className="h-8 w-28 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Modal detalle de comisiones por vendedor ────────────────────────────────
function ModalDetalleVendedor({ vendedor, comisiones, onClose, esSupervisor, onMarcarPagada, marcando }) {
  if (!vendedor) return null

  const comisionesVendedor = comisiones.filter(c => c.vendedor_id === vendedor.id)
  const pendientes = comisionesVendedor.filter(c => c.estado === 'pendiente')
  const pagadas = comisionesVendedor.filter(c => c.estado === 'pagada')

  const totalPendiente = pendientes.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalPagado = pagadas.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalGeneral = totalPendiente + totalPagado

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="relative h-20 shrink-0 flex items-center gap-4 px-6"
          style={{ background: `linear-gradient(135deg, ${vendedor.color || '#1B365D'}ee, ${vendedor.color || '#1B365D'}99)` }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
          <div className="relative z-10 w-12 h-12 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white text-lg font-black backdrop-blur-sm">
            {(vendedor.nombre || '?')[0].toUpperCase()}
          </div>
          <div className="relative z-10 flex-1 min-w-0">
            <h3 className="text-lg font-black text-white truncate">{vendedor.nombre}</h3>
            <p className="text-xs text-white/60">{comisionesVendedor.length} comisión{comisionesVendedor.length !== 1 ? 'es' : ''}</p>
          </div>
          <button onClick={onClose}
            className="relative z-10 p-2 rounded-full bg-white/15 border border-white/25 text-white hover:bg-white/25 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Resumen del vendedor */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4 bg-slate-50 border-b border-slate-100">
          <div className="text-center">
            <p className="text-xs text-slate-400 font-medium">Total</p>
            <p className="text-lg font-black text-slate-800">{fmtUsd(totalGeneral)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-amber-500 font-medium">Pendiente</p>
            <p className="text-lg font-black text-amber-600">{fmtUsd(totalPendiente)}</p>
            <p className="text-[10px] text-slate-400">{pendientes.length} por pagar</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-emerald-500 font-medium">Pagado</p>
            <p className="text-lg font-black text-emerald-600">{fmtUsd(totalPagado)}</p>
            <p className="text-[10px] text-slate-400">{pagadas.length} pagada{pagadas.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Lista de comisiones */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {comisionesVendedor.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Sin comisiones registradas</p>
          ) : (
            comisionesVendedor.map(c => {
              const esPendiente = c.estado === 'pendiente'
              return (
                <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-3.5 hover:shadow-sm transition-all">
                  {/* Row 1: Despacho + estado + fecha */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={13} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-mono text-slate-500">
                        Despacho #{c.despacho?.numero ?? '—'} · Cot. #{c.cotizacion?.numero ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400">{fmtFecha(c.creado_en)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        esPendiente
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {esPendiente ? 'Pendiente' : 'Pagada'}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Desglose inline */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 text-xs mb-2">
                    <div className="flex-1 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                      <span className="text-slate-400">Cabilla ({c.pct_cabilla}%)</span>
                      <span className="ml-1.5 font-bold text-slate-600">{fmtUsd(c.monto_cabilla)}</span>
                      <span className="ml-1 font-black text-emerald-600">→ {fmtUsd(c.comision_cabilla)}</span>
                    </div>
                    <div className="flex-1 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                      <span className="text-slate-400">Otros ({c.pct_otros}%)</span>
                      <span className="ml-1.5 font-bold text-slate-600">{fmtUsd(c.monto_otros)}</span>
                      <span className="ml-1 font-black text-emerald-600">→ {fmtUsd(c.comision_otros)}</span>
                    </div>
                  </div>

                  {/* Row 3: Total + acción */}
                  <div className="flex items-center justify-between">
                    <span className="text-base font-black text-slate-800">{fmtUsd(c.total_comision)}</span>
                    <div className="flex items-center gap-2">
                      {c.estado === 'pagada' && c.pagada_en && (
                        <span className="text-[11px] text-slate-400">
                          Pagada {new Date(c.pagada_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {esSupervisor && esPendiente && (
                        <button
                          onClick={() => onMarcarPagada(c)}
                          disabled={marcando}
                          className="flex items-center gap-1 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}
                        >
                          <CheckCircle size={11} />Pagada
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function ComisionesView() {
  const navigate = useNavigate()
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  const [filtroEstado,   setFiltroEstado]   = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [comisionAPagar, setComisionAPagar] = useState(null)
  const [vendedorDetalle, setVendedorDetalle] = useState(null)

  const { data: comisiones = [], isLoading } = useComisiones({
    estado:     filtroEstado,
    vendedorId: esSupervisor ? filtroVendedor : '',
  })
  const { data: resumen,   isLoading: resumenLoading } = useComisionesResumen()
  const { data: vendedores = [] } = useVendedores()
  const marcar = useMarcarComisionPagada()

  const selectCls = 'text-sm font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary transition-colors'

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-5">

      <PageHeader
        icon={DollarSign}
        title="Comisiones"
        subtitle="Comisiones generadas por despachos entregados"
      />

      {/* Resumen */}
      {resumenLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
              <Skeleton className="h-7 w-1/2 rounded" />
              <Skeleton className="h-2.5 w-1/3 rounded" />
            </div>
          ))}
        </div>
      ) : resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ResumenCard
            icon={TrendingUp}
            label="Total acumulado"
            value={fmtUsd(resumen.total)}
            sub={`${resumen.countPendiente + resumen.countPagado} comisiones`}
            gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
            border="rgba(255,255,255,0.07)"
          />
          <ResumenCard
            icon={Clock}
            label="Pendiente de pago"
            value={fmtUsd(resumen.pendiente)}
            sub={`${resumen.countPendiente} por pagar`}
            gradient="linear-gradient(135deg, #92400e 0%, #B8860B 100%)"
            border="rgba(255,255,255,0.10)"
          />
          <ResumenCard
            icon={CheckCircle}
            label="Ya pagado"
            value={fmtUsd(resumen.pagado)}
            sub={`${resumen.countPagado} pagadas`}
            gradient="linear-gradient(135deg, #065f46 0%, #047857 100%)"
            border="rgba(255,255,255,0.10)"
          />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wide">
          <Filter size={12} />Filtros
        </div>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className={selectCls}>
          <option value="">Todas</option>
          <option value="pendiente">Pendientes</option>
          <option value="pagada">Pagadas</option>
        </select>
        {esSupervisor && (
          <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className={selectCls}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => (
              <option key={v.id} value={v.id}>{v.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <SkeletonComisiones />
      ) : comisiones.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="Sin comisiones"
          description="Las comisiones se generan automáticamente al marcar un despacho como entregado."
          actionLabel="Ir a despachos"
          onAction={() => navigate('/despachos')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {comisiones.map(c => (
            <ComisionCard
              key={c.id}
              comision={c}
              esSupervisor={esSupervisor}
              onMarcarPagada={(comision) => setComisionAPagar(comision)}
              marcando={marcar.isPending}
              onVerDetalle={(vendedor) => setVendedorDetalle(vendedor)}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!comisionAPagar}
        onConfirm={() => { marcar.mutate(comisionAPagar.id); setComisionAPagar(null) }}
        onClose={() => setComisionAPagar(null)}
        title="¿Marcar comisión como pagada?"
        message={comisionAPagar
          ? `Se registrará el pago de ${fmtUsd(comisionAPagar.total_comision)} a ${comisionAPagar.vendedor?.nombre ?? 'el vendedor'}. Esta acción no se puede deshacer.`
          : ''}
        confirmText="Sí, marcar como pagada"
        variant="success"
      />

      <ModalDetalleVendedor
        vendedor={vendedorDetalle}
        comisiones={comisiones}
        onClose={() => setVendedorDetalle(null)}
        esSupervisor={esSupervisor}
        onMarcarPagada={(comision) => { setVendedorDetalle(null); setComisionAPagar(comision) }}
        marcando={marcar.isPending}
      />
    </div>
  )
}
