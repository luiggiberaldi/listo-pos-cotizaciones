// src/views/ReportesView.jsx
// Vista profesional de reportes de ventas
import { useState, useMemo } from 'react'
import { BarChart3, CreditCard, RefreshCw } from 'lucide-react'
import { useReporteVentas } from '../hooks/useReporteVentas'
import { getWeekRange } from '../utils/dateHelpers'
import { fmtUsd } from '../utils/format'
import PageHeader   from '../components/ui/PageHeader'
import Skeleton     from '../components/ui/Skeleton'
import EmptyState   from '../components/ui/EmptyState'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import KpiCards     from '../components/reportes/KpiCards'
import TablaVendedores from '../components/reportes/TablaVendedores'
import TablaClientes   from '../components/reportes/TablaClientes'
import TablaProductos  from '../components/reportes/TablaProductos'

// Forma de pago section
function FormaPagoSection({ data = [] }) {
  if (data.length === 0) return null
  const total = data.reduce((s, fp) => s + fp.totalUsd, 0)
  const COLORS = { 'Efectivo': '#10b981', 'Zelle': '#3b82f6', 'Pago Móvil': '#8b5cf6', 'USDT': '#f59e0b', 'Sin especificar': '#94a3b8' }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <CreditCard size={16} className="text-slate-500" />
        <h3 className="text-sm font-black text-slate-800">Formas de pago</h3>
      </div>
      <div className="p-4 space-y-3">
        {data.map(fp => {
          const pct = total > 0 ? (fp.totalUsd / total) * 100 : 0
          const color = COLORS[fp.formaPago] || '#64748b'
          return (
            <div key={fp.formaPago} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
                  <span className="font-semibold text-slate-700">{fp.formaPago}</span>
                  <span className="text-[10px] text-slate-400 font-bold">{fp.count} despacho{fp.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                  <span className="font-bold text-slate-800">{fmtUsd(fp.totalUsd)}</span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SkeletonReporte() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="rounded-2xl p-4 bg-slate-200/50 space-y-3">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-8 w-1/2 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}

export default function ReportesView() {
  // Default: esta semana con comparativo semana pasada
  const defaultRange = useMemo(() => {
    const curr = getWeekRange(0)
    const prev = getWeekRange(-1)
    return { from: curr.from, to: curr.to, prevFrom: prev.from, prevTo: prev.to }
  }, [])

  const [range, setRange] = useState(defaultRange)
  const { data: reporte, isLoading, isError, refetch } = useReporteVentas(range)

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-5">

      <PageHeader
        icon={BarChart3}
        title="Reporte de Ventas"
        subtitle={`${range.from} — ${range.to}`}
        action={
          <button onClick={() => refetch()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Selector de período */}
      <DateRangeSelector value={range} onChange={setRange} />

      {/* Contenido */}
      {isLoading ? (
        <SkeletonReporte />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar el reporte</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : !reporte || reporte.kpis.numDespachos === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Sin despachos entregados"
          description="No hay despachos entregados en el período seleccionado. Prueba con otro rango de fechas."
        />
      ) : (
        <div className="space-y-4">
          {/* KPIs */}
          <KpiCards kpis={reporte.kpis} />

          {/* Grid de tablas */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <TablaVendedores data={reporte.porVendedor} />
            <TablaClientes data={reporte.porCliente} />
          </div>

          <TablaProductos porProducto={reporte.porProducto} porCategoria={reporte.porCategoria} />

          <FormaPagoSection data={reporte.porFormaPago} />
        </div>
      )}
    </div>
  )
}
