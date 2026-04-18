// src/views/ComisionesView.jsx
// Vista de comisiones por despacho entregado
import { useState } from 'react'
import { DollarSign, CheckCircle, Clock, Filter, TrendingUp } from 'lucide-react'
import { useComisiones, useComisionesResumen, useMarcarComisionPagada } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd } from '../utils/format'
import PageHeader    from '../components/ui/PageHeader'
import Skeleton      from '../components/ui/Skeleton'
import EmptyState    from '../components/ui/EmptyState'
import ConfirmModal  from '../components/ui/ConfirmModal'

// ─── Tarjeta de resumen ───────────────────────────────────────────────────────
function ResumenCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
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
function ComisionCard({ comision, esSupervisor, onMarcarPagada, marcando }) {
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
        {comision.estado === 'pagada' && comision.pagada_en && (
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

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function ComisionesView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  const [filtroEstado,   setFiltroEstado]   = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [comisionAPagar, setComisionAPagar] = useState(null)

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
    </div>
  )
}
