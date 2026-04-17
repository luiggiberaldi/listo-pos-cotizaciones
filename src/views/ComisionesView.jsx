// src/views/ComisionesView.jsx
// Vista de comisiones por despacho entregado
import { useState } from 'react'
import { DollarSign, CheckCircle, Clock, Filter, User } from 'lucide-react'
import { useComisiones, useComisionesResumen, useMarcarComisionPagada } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd } from '../utils/format'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'

// ─── Tarjeta de comisión ─────────────────────────────────────────────────────
function ComisionCard({ comision, esSupervisor, onMarcarPagada, marcando }) {
  const esPendiente = comision.estado === 'pendiente'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 transition-shadow hover:shadow-md">
      {/* Header: vendedor + estado */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-black"
            style={{ background: comision.vendedor?.color || '#64748b' }}>
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
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
          esPendiente
            ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {esPendiente ? 'Pendiente' : 'Pagada'}
        </span>
      </div>

      {/* Desglose */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 rounded-xl p-2.5">
          <p className="text-slate-400 font-medium">Cabilla ({comision.pct_cabilla}%)</p>
          <p className="text-slate-700 font-bold mt-0.5">
            {fmtUsd(comision.monto_cabilla)} → <span className="text-emerald-600">{fmtUsd(comision.comision_cabilla)}</span>
          </p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5">
          <p className="text-slate-400 font-medium">Otros ({comision.pct_otros}%)</p>
          <p className="text-slate-700 font-bold mt-0.5">
            {fmtUsd(comision.monto_otros)} → <span className="text-emerald-600">{fmtUsd(comision.comision_otros)}</span>
          </p>
        </div>
      </div>

      {/* Total + acción */}
      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid #f1f5f9' }}>
        <div>
          <p className="text-xs text-slate-400">Total comisión</p>
          <p className="text-lg font-black text-slate-800">{fmtUsd(comision.total_comision)}</p>
        </div>
        {esSupervisor && esPendiente && (
          <button
            onClick={() => onMarcarPagada(comision.id)}
            disabled={marcando}
            className="flex items-center gap-1.5 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
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

// ─── Vista principal ─────────────────────────────────────────────────────────
export default function ComisionesView() {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'

  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')

  const { data: comisiones = [], isLoading } = useComisiones({
    estado: filtroEstado,
    vendedorId: esSupervisor ? filtroVendedor : '',
  })
  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen()
  const { data: vendedores = [] } = useVendedores()
  const marcar = useMarcarComisionPagada()

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-5">

      <PageHeader
        icon={DollarSign}
        title="Comisiones"
        subtitle="Comisiones por despachos entregados"
      />

      {/* Resumen */}
      {resumenLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4">
              <Skeleton className="h-3 w-1/2 rounded mb-2" />
              <Skeleton className="h-6 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative overflow-hidden rounded-2xl p-4"
            style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="absolute -bottom-3 -right-3 w-16 h-16 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
            <p className="text-xs font-medium text-white/50">Total acumulado</p>
            <p className="text-xl font-black text-white mt-0.5">{fmtUsd(resumen.total)}</p>
            <p className="text-xs text-white/40 mt-0.5">{resumen.countPendiente + resumen.countPagado} comisiones</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl p-4"
            style={{ background: 'linear-gradient(135deg, #92400e, #B8860B)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="absolute -bottom-3 -right-3 w-16 h-16 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
            <div className="flex items-center gap-1.5 mb-0.5">
              <Clock size={12} className="text-white/50" />
              <p className="text-xs font-medium text-white/50">Pendiente</p>
            </div>
            <p className="text-xl font-black text-white">{fmtUsd(resumen.pendiente)}</p>
            <p className="text-xs text-white/40 mt-0.5">{resumen.countPendiente} por pagar</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl p-4"
            style={{ background: 'linear-gradient(135deg, #065f46, #047857)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="absolute -bottom-3 -right-3 w-16 h-16 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
            <div className="flex items-center gap-1.5 mb-0.5">
              <CheckCircle size={12} className="text-white/50" />
              <p className="text-xs font-medium text-white/50">Pagado</p>
            </div>
            <p className="text-xl font-black text-white">{fmtUsd(resumen.pagado)}</p>
            <p className="text-xs text-white/40 mt-0.5">{resumen.countPagado} pagadas</p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wide">
          <Filter size={12} />Filtros
        </div>
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="text-sm font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value="">Todas</option>
          <option value="pendiente">Pendientes</option>
          <option value="pagada">Pagadas</option>
        </select>

        {esSupervisor && (
          <select
            value={filtroVendedor}
            onChange={e => setFiltroVendedor(e.target.value)}
            className="text-sm font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200"
          >
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => (
              <option key={v.id} value={v.id}>{v.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {/* Lista de comisiones */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-2/3 rounded mb-1" />
                  <Skeleton className="h-2.5 w-1/2 rounded" />
                </div>
              </div>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-6 w-1/3 rounded" />
            </div>
          ))}
        </div>
      ) : comisiones.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-slate-100">
            <DollarSign size={28} className="text-slate-300" />
          </div>
          <p className="text-sm font-bold text-slate-500">Sin comisiones</p>
          <p className="text-xs text-slate-400 mt-1">
            Las comisiones se generan automáticamente al marcar un despacho como entregado.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {comisiones.map(c => (
            <ComisionCard
              key={c.id}
              comision={c}
              esSupervisor={esSupervisor}
              onMarcarPagada={(id) => marcar.mutate(id)}
              marcando={marcar.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}
