// src/views/ReportesView.jsx
// Vista profesional de reportes administrativos con tabs
import { useState, useMemo } from 'react'
import {
  BarChart3, CreditCard, RefreshCw, Download, Package,
  FileText, Truck, DollarSign, TrendingUp, AlertTriangle,
  Clock, Users, Percent, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react'
import { useReporteVentas } from '../hooks/useReporteVentas'
import { useReporteInventario } from '../hooks/useReporteInventario'
import { useReportePipeline } from '../hooks/useReportePipeline'
import { useReporteDespachos } from '../hooks/useReporteDespachos'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useComisiones } from '../hooks/useComisiones'
import { useComisionesResumen } from '../hooks/useComisiones'
import { useResumenCxC } from '../hooks/useCuentasCobrar'
import { getWeekRange, getMonthRange } from '../utils/dateHelpers'
import { fmtUsd } from '../utils/format'
import useAuthStore from '../store/useAuthStore'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import KpiCards from '../components/reportes/KpiCards'
import TablaVendedores from '../components/reportes/TablaVendedores'
import TablaClientes from '../components/reportes/TablaClientes'
import TablaProductos from '../components/reportes/TablaProductos'

// ─── Tabs Definition ──────────────────────────────────────────────────────
const TABS = [
  { id: 'ventas',       label: 'Ventas',            short: 'Ventas',   icon: DollarSign },
  { id: 'inventario',   label: 'Inventario',        short: 'Invent.',  icon: Package },
  { id: 'cotizaciones', label: 'Cotizaciones',      short: 'Cotiz.',   icon: FileText },
  { id: 'despachos',    label: 'Despachos',         short: 'Desp.',    icon: Truck },
  { id: 'comisiones',   label: 'Comisiones',        short: 'Comis.',   icon: Percent },
  { id: 'credito',      label: 'Crédito',            short: 'Créd.',    icon: CreditCard },
]

// ─── Skeleton ──────────────────────────────────────────────────────────────
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

// ─── KPI Card (reusable) ──────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 flex flex-col gap-1 sm:gap-2 min-w-0"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div className="absolute -bottom-4 -right-4 w-16 sm:w-20 h-16 sm:h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-start gap-1.5 relative z-10 min-w-0">
        <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={12} className="text-white sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] sm:text-[10px] md:text-[11px] font-medium leading-tight truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
        </div>
      </div>
      <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-white relative z-10 truncate">{value}</p>
      {sub && <p className="text-[9px] sm:text-[10px] md:text-[11px] relative z-10 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</p>}
    </div>
  )
}

// ─── Forma de Pago Section ────────────────────────────────────────────────
function FormaPagoSection({ data = [] }) {
  if (data.length === 0) return null
  const total = data.reduce((s, fp) => s + fp.totalUsd, 0)
  const COLORS = { 'Efectivo': '#10b981', 'Zelle': '#3b82f6', 'Pago Móvil': '#8b5cf6', 'USDT': '#f59e0b', 'Sin especificar': '#94a3b8' }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <CreditCard size={14} className="text-slate-500 sm:w-4 sm:h-4" />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">Formas de pago</h3>
      </div>
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        {data.map(fp => {
          const pct = total > 0 ? (fp.totalUsd / total) * 100 : 0
          const color = COLORS[fp.formaPago] || '#64748b'
          return (
            <div key={fp.formaPago} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="font-semibold text-slate-700 truncate">{fp.formaPago}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold shrink-0">{fp.count}</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <span className="text-[10px] sm:text-xs text-slate-400">{pct.toFixed(0)}%</span>
                  <span className="font-bold text-slate-800 text-xs sm:text-sm">{fmtUsd(fp.totalUsd)}</span>
                </div>
              </div>
              <div className="h-2 sm:h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Estado Badge ─────────────────────────────────────────────────────────
const ESTADO_STYLES = {
  borrador:  'bg-slate-100 text-slate-600',
  enviada:   'bg-blue-100 text-blue-700',
  aceptada:  'bg-emerald-100 text-emerald-700',
  rechazada: 'bg-red-100 text-red-700',
  vencida:   'bg-amber-100 text-amber-700',
  anulada:   'bg-gray-100 text-gray-500',
  pendiente: 'bg-amber-100 text-amber-700',
  despachada:'bg-blue-100 text-blue-700',
  entregada: 'bg-emerald-100 text-emerald-700',
  pagada:    'bg-emerald-100 text-emerald-700',
}

// ─── Tabla genérica admin ─────────────────────────────────────────────────
function AdminTable({ icon: Icon, iconColor, title, headers, rows, emptyText }) {
  if (rows.length === 0) return null
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className={`${iconColor} sm:w-4 sm:h-4`} />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
              {headers.map((h, i) => (
                <th key={i} className={`px-2 sm:px-4 py-2 font-semibold ${h.align || 'text-left'}`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                {row.map((cell, j) => (
                  <td key={j} className={`px-2 sm:px-4 py-2 sm:py-2.5 ${cell.className || ''}`}>{cell.content}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Bar section ──────────────────────────────────────────────────────────
function BarSection({ icon: Icon, iconColor, title, data, labelKey, countKey, countSuffix, valueKey }) {
  if (!data || data.length === 0) return null
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0)

  const ESTADO_BAR_COLORS = {
    borrador: '#94a3b8', enviada: '#3b82f6', aceptada: '#10b981',
    rechazada: '#ef4444', vencida: '#f59e0b', anulada: '#6b7280',
    pendiente: '#f59e0b', despachada: '#3b82f6', entregada: '#10b981',
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className={`${iconColor} sm:w-4 sm:h-4`} />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        {data.filter(d => d[countKey] > 0).map((d, i) => {
          const pct = total > 0 ? (d[valueKey] / total) * 100 : 0
          const color = ESTADO_BAR_COLORS[d[labelKey]] || '#64748b'
          const label = d[labelKey].charAt(0).toUpperCase() + d[labelKey].slice(1)
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="font-semibold text-slate-700 truncate">{label}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold shrink-0">{d[countKey]} {countSuffix}</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <span className="text-[10px] sm:text-xs text-slate-400">{pct.toFixed(0)}%</span>
                  <span className="font-bold text-slate-800 text-xs sm:text-sm">{fmtUsd(d[valueKey])}</span>
                </div>
              </div>
              <div className="h-2 sm:h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Aging Table ──────────────────────────────────────────────────────────
function AgingSection({ title, data, countLabel }) {
  if (!data || data.every(a => a.count === 0)) return null
  const agingColors = ['text-emerald-600', 'text-amber-600', 'text-amber-600', 'text-red-600']
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Clock size={14} className="text-amber-500 sm:w-4 sm:h-4" />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-2 sm:px-4 py-2 font-semibold">Rango</th>
              <th className="text-center px-2 sm:px-4 py-2 font-semibold">{countLabel}</th>
              <th className="text-right px-2 sm:px-4 py-2 font-semibold">Monto USD</th>
            </tr>
          </thead>
          <tbody>
            {data.filter(a => a.count > 0).map((a, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-2 sm:px-4 py-2 font-medium text-slate-700">{a.rango}</td>
                <td className="px-2 sm:px-4 py-2 text-center text-slate-600">{a.count}</td>
                <td className={`px-2 sm:px-4 py-2 text-right font-bold ${agingColors[i] || 'text-slate-800'}`}>{fmtUsd(a.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: VENTAS
// ═══════════════════════════════════════════════════════════════════════════
function TabVentas({ range, configNeg }) {
  const { data: reporte, isLoading, isError, refetch } = useReporteVentas(range)
  const [exportando, setExportando] = useState(false)

  async function exportarPDF() {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarReporteVentasPDF } = await import('../services/pdf/comisionesPDF')
      await generarReporteVentasPDF({ reporte, rango: range, config: configNeg })
    } catch (e) { console.error('Error generando PDF:', e) }
    setExportando(false)
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte || reporte.kpis.numDespachos === 0) {
    return <EmptyState icon={BarChart3} title="Sin despachos entregados" description="No hay despachos entregados en el período seleccionado." />
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton onClick={exportarPDF} loading={exportando} />
      </div>
      <KpiCards kpis={reporte.kpis} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TablaVendedores data={reporte.porVendedor} />
        <TablaClientes data={reporte.porCliente} />
      </div>
      <TablaProductos porProducto={reporte.porProducto} porCategoria={reporte.porCategoria} />
      <FormaPagoSection data={reporte.porFormaPago} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: INVENTARIO
// ═══════════════════════════════════════════════════════════════════════════
function TabInventario({ configNeg }) {
  const { data: reporte, isLoading, isError, refetch } = useReporteInventario()
  const [exportando, setExportando] = useState(false)

  async function exportarPDF() {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarInventarioPDF } = await import('../services/pdf/inventarioPDF')
      await generarInventarioPDF({ reporte, config: configNeg })
    } catch (e) { console.error('Error generando PDF:', e) }
    setExportando(false)
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte) return <EmptyState icon={Package} title="Sin datos" description="No se pudo cargar el inventario." />

  const { kpis, productosBajoStock, productosSinMov90, porCategoria } = reporte

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton onClick={exportarPDF} loading={exportando} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Package} label="Total productos" value={String(kpis.totalProductos)}
          gradient="linear-gradient(135deg, #1B365D, #0d1f3c)" border="rgba(255,255,255,0.07)" />
        {kpis.esSupervisor && (
          <KpiCard icon={DollarSign} label="Valor a costo" value={fmtUsd(kpis.totalValorCosto)}
            gradient="linear-gradient(135deg, #065f46, #047857)" border="rgba(255,255,255,0.10)" />
        )}
        <KpiCard icon={TrendingUp} label="Valor a precio venta" value={fmtUsd(kpis.totalValorVenta)}
          gradient="linear-gradient(135deg, #92400e, #B8860B)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={AlertTriangle} label="Bajo stock" value={String(kpis.numBajoStock)}
          sub={`${kpis.numSinMov90} sin mov. 90+ días`}
          gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)" />
      </div>

      {/* Por Categoría */}
      <AdminTable
        icon={BarChart3} iconColor="text-primary" title="Resumen por Categoría"
        headers={[
          { label: 'Categoría' },
          { label: 'Productos', align: 'text-center' },
          { label: 'Stock total', align: 'text-center' },
          ...(kpis.esSupervisor ? [{ label: 'Valor costo', align: 'text-right' }] : []),
          { label: 'Valor venta', align: 'text-right' },
          ...(kpis.esSupervisor ? [{ label: 'Margen', align: 'text-right' }] : []),
        ]}
        rows={porCategoria.map(cat => {
          const margen = cat.valorVenta > 0 && cat.valorCosto > 0
            ? ((cat.valorVenta - cat.valorCosto) / cat.valorVenta * 100).toFixed(1)
            : null
          return [
            { content: cat.categoria, className: 'font-semibold text-slate-700' },
            { content: cat.count, className: 'text-center text-slate-600' },
            { content: Number(cat.stockTotal).toLocaleString(), className: 'text-center text-slate-600' },
            ...(kpis.esSupervisor ? [{ content: fmtUsd(cat.valorCosto), className: 'text-right text-slate-600' }] : []),
            { content: fmtUsd(cat.valorVenta), className: 'text-right font-bold text-slate-800' },
            ...(kpis.esSupervisor ? [{
              content: margen ? `${margen}%` : '—',
              className: `text-right font-bold ${margen && Number(margen) > 0 ? 'text-emerald-600' : 'text-slate-400'}`
            }] : []),
          ]
        })}
      />

      {/* Bajo Stock */}
      {productosBajoStock.length > 0 && (
        <AdminTable
          icon={AlertTriangle} iconColor="text-red-500"
          title={`Productos con Stock Bajo (${productosBajoStock.length})`}
          headers={[
            { label: 'Código' }, { label: 'Producto' }, { label: 'Categoría' },
            { label: 'Stock', align: 'text-center' }, { label: 'Mínimo', align: 'text-center' },
            { label: 'Déficit', align: 'text-right' },
          ]}
          rows={productosBajoStock.slice(0, 20).map(p => {
            const deficit = Math.max(0, Number(p.stock_minimo) - Number(p.stock_actual))
            return [
              { content: p.codigo || '—', className: 'text-slate-500 text-xs' },
              { content: p.nombre, className: 'font-semibold text-slate-700' },
              { content: p.categoria || '—', className: 'text-slate-500' },
              { content: Number(p.stock_actual).toLocaleString(), className: 'text-center' },
              { content: Number(p.stock_minimo).toLocaleString(), className: 'text-center text-slate-400' },
              { content: deficit.toLocaleString(), className: 'text-right font-bold text-red-600' },
            ]
          })}
        />
      )}

      {/* Sin Movimiento 90+ */}
      {productosSinMov90.length > 0 && (
        <AdminTable
          icon={Clock} iconColor="text-amber-500"
          title={`Productos sin Movimiento 90+ días (${productosSinMov90.length})`}
          headers={[
            { label: 'Código' }, { label: 'Producto' }, { label: 'Categoría' },
            { label: 'Stock', align: 'text-center' }, { label: 'Valor USD', align: 'text-right' },
            { label: 'Días', align: 'text-right' },
          ]}
          rows={productosSinMov90.sort((a, b) => b.valorVenta - a.valorVenta).slice(0, 20).map(p => [
            { content: p.codigo || '—', className: 'text-slate-500 text-xs' },
            { content: p.nombre, className: 'font-semibold text-slate-700' },
            { content: p.categoria || '—', className: 'text-slate-500' },
            { content: Number(p.stock_actual).toLocaleString(), className: 'text-center' },
            { content: fmtUsd(p.valorVenta), className: 'text-right font-bold' },
            { content: p.diasSinMov >= 999 ? '90+' : String(p.diasSinMov), className: 'text-right font-bold text-amber-600' },
          ])}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: COTIZACIONES (Pipeline)
// ═══════════════════════════════════════════════════════════════════════════
function TabCotizaciones({ range, configNeg }) {
  const { data: reporte, isLoading, isError, refetch } = useReportePipeline(range)
  const [exportando, setExportando] = useState(false)

  async function exportarPDF() {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarPipelinePDF } = await import('../services/pdf/pipelinePDF')
      await generarPipelinePDF({ reporte, rango: range, config: configNeg })
    } catch (e) { console.error('Error generando PDF:', e) }
    setExportando(false)
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte || reporte.kpis.totalCotizaciones === 0) {
    return <EmptyState icon={FileText} title="Sin cotizaciones" description="No hay cotizaciones en el período seleccionado." />
  }

  const { kpis, porEstado, aging, porVendedor, topPendientes } = reporte

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton onClick={exportarPDF} loading={exportando} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={FileText} label="Total cotizaciones" value={String(kpis.totalCotizaciones)}
          gradient="linear-gradient(135deg, #1B365D, #0d1f3c)" border="rgba(255,255,255,0.07)" />
        <KpiCard icon={DollarSign} label="Valor pipeline" value={fmtUsd(kpis.valorPipeline)}
          sub="Borradores + enviadas"
          gradient="linear-gradient(135deg, #92400e, #B8860B)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={TrendingUp} label="Tasa de conversión" value={`${kpis.tasaConversion.toFixed(1)}%`}
          sub="Aceptadas / (Env+Acep+Rech)"
          gradient="linear-gradient(135deg, #065f46, #047857)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={Clock} label="Enviadas pendientes" value={String(kpis.enviadasPendientes)}
          gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)" />
      </div>

      <BarSection icon={FileText} iconColor="text-blue-500" title="Cotizaciones por Estado"
        data={porEstado} labelKey="estado" countKey="count" countSuffix="cot." valueKey="totalUsd" />

      <AgingSection title="Antigüedad — Enviadas sin Respuesta" data={aging} countLabel="Cotizaciones" />

      {/* Por Vendedor */}
      {porVendedor.length > 0 && (
        <AdminTable
          icon={Users} iconColor="text-indigo-500" title="Pipeline por Vendedor"
          headers={[
            { label: 'Vendedor' }, { label: 'Borr.', align: 'text-center' },
            { label: 'Env.', align: 'text-center' }, { label: 'Acept.', align: 'text-center' },
            { label: 'Rech.', align: 'text-center' }, { label: 'Total USD', align: 'text-right' },
          ]}
          rows={porVendedor.map(v => [
            { content: <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full shrink-0" style={{ background: v.color || '#64748b' }} />
              <span className="font-semibold">{v.nombre}</span>
            </div> },
            { content: v.borrador || 0, className: 'text-center text-slate-500' },
            { content: v.enviada || 0, className: 'text-center text-blue-600 font-medium' },
            { content: v.aceptada || 0, className: 'text-center text-emerald-600 font-medium' },
            { content: v.rechazada || 0, className: 'text-center text-red-600 font-medium' },
            { content: fmtUsd(v.totalUsd), className: 'text-right font-bold text-slate-800' },
          ])}
        />
      )}

      {/* Top Pendientes */}
      {topPendientes.length > 0 && (
        <AdminTable
          icon={Clock} iconColor="text-amber-500" title="Cotizaciones más Antiguas sin Respuesta"
          headers={[
            { label: '#' }, { label: 'Cliente' }, { label: 'Vendedor' },
            { label: 'Total USD', align: 'text-right' }, { label: 'Días', align: 'text-right' },
          ]}
          rows={topPendientes.map(c => [
            { content: `${c.numero}${c.version > 1 ? ` v${c.version}` : ''}`, className: 'text-slate-500 font-medium' },
            { content: c.cliente, className: 'font-semibold text-slate-700' },
            { content: <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full shrink-0" style={{ background: c.vendedorColor || '#64748b' }} />
              <span>{c.vendedor}</span>
            </div>, className: 'text-slate-600' },
            { content: fmtUsd(c.totalUsd), className: 'text-right font-bold' },
            { content: c.dias, className: `text-right font-bold ${c.dias > 30 ? 'text-red-600' : c.dias > 15 ? 'text-amber-600' : 'text-emerald-600'}` },
          ])}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: DESPACHOS
// ═══════════════════════════════════════════════════════════════════════════
function TabDespachos({ range, configNeg }) {
  const { data: reporte, isLoading, isError, refetch } = useReporteDespachos(range)
  const [exportando, setExportando] = useState(false)

  async function exportarPDF() {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarDespachoReportePDF } = await import('../services/pdf/despachoReportePDF')
      await generarDespachoReportePDF({ reporte, rango: range, config: configNeg })
    } catch (e) { console.error('Error generando PDF:', e) }
    setExportando(false)
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte || reporte.kpis.totalDespachos === 0) {
    return <EmptyState icon={Truck} title="Sin despachos" description="No hay despachos en el período seleccionado." />
  }

  const { kpis, porEstado, porFormaPago, aging, porVendedor, topClientesPendientes } = reporte

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton onClick={exportarPDF} loading={exportando} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Truck} label="Total despachos" value={String(kpis.totalDespachos)}
          gradient="linear-gradient(135deg, #1B365D, #0d1f3c)" border="rgba(255,255,255,0.07)" />
        <KpiCard icon={Package} label="Entregados" value={String(kpis.numEntregados)}
          sub={fmtUsd(kpis.montoEntregado)}
          gradient="linear-gradient(135deg, #065f46, #047857)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={Clock} label="Pendientes" value={String(kpis.numPendientes)}
          sub={fmtUsd(kpis.montoPendiente)}
          gradient="linear-gradient(135deg, #92400e, #B8860B)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={AlertTriangle} label="Monto pendiente" value={fmtUsd(kpis.montoPendiente)}
          gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <BarSection icon={Truck} iconColor="text-blue-500" title="Despachos por Estado"
          data={porEstado} labelKey="estado" countKey="count" countSuffix="desp." valueKey="totalUsd" />
        <FormaPagoSection data={porFormaPago} />
      </div>

      <AgingSection title="Antigüedad — Despachos Pendientes" data={aging} countLabel="Despachos" />

      {/* Por Vendedor */}
      {porVendedor.length > 0 && (
        <AdminTable
          icon={Users} iconColor="text-indigo-500" title="Despachos por Vendedor"
          headers={[
            { label: 'Vendedor' }, { label: 'Total', align: 'text-center' },
            { label: 'Entregados', align: 'text-center' }, { label: 'Pendientes', align: 'text-center' },
            { label: 'Ventas USD', align: 'text-right' }, { label: 'Pend. USD', align: 'text-right' },
          ]}
          rows={porVendedor.map(v => [
            { content: <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full shrink-0" style={{ background: v.color || '#64748b' }} />
              <span className="font-semibold">{v.nombre}</span>
            </div> },
            { content: v.despachos, className: 'text-center font-medium' },
            { content: v.entregados, className: 'text-center text-emerald-600 font-medium' },
            { content: v.pendientes, className: 'text-center text-amber-600 font-medium' },
            { content: fmtUsd(v.totalUsd), className: 'text-right font-bold text-slate-800' },
            { content: fmtUsd(v.montoPendiente), className: 'text-right font-bold text-red-600' },
          ])}
        />
      )}

      {/* Top clientes con monto pendiente */}
      {topClientesPendientes.length > 0 && (
        <AdminTable
          icon={Users} iconColor="text-red-500" title="Clientes con Mayor Monto Pendiente"
          headers={[
            { label: 'Cliente' }, { label: 'Despachos pend.', align: 'text-center' },
            { label: 'Monto Pendiente', align: 'text-right' },
          ]}
          rows={topClientesPendientes.map(c => [
            { content: c.nombre, className: 'font-semibold text-slate-700' },
            { content: c.count, className: 'text-center text-slate-600' },
            { content: fmtUsd(c.totalUsd), className: 'text-right font-bold text-red-600' },
          ])}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: COMISIONES
// ═══════════════════════════════════════════════════════════════════════════
function TabComisiones({ configNeg }) {
  const { perfil } = useAuthStore()
  const esSupervisor = perfil?.rol === 'supervisor'
  const { data: comisiones = [], isLoading } = useComisiones({ estado: '' })
  const { data: resumen } = useComisionesResumen()
  const [exportando, setExportando] = useState(false)

  async function exportarPDF() {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')
      await generarComisionesPDF({ comisiones, config: configNeg })
    } catch (e) { console.error('Error generando PDF:', e) }
    setExportando(false)
  }

  if (isLoading) return <SkeletonReporte />

  const pendientes = comisiones.filter(c => c.estado === 'pendiente')
  const pagadas = comisiones.filter(c => c.estado === 'pagada')
  const totalPendiente = pendientes.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalPagado = pagadas.reduce((s, c) => s + Number(c.total_comision || 0), 0)
  const totalGeneral = totalPendiente + totalPagado

  // Por vendedor
  const porVendedor = {}
  comisiones.forEach(c => {
    const vid = c.vendedor_id
    if (!porVendedor[vid]) {
      porVendedor[vid] = {
        nombre: c.vendedor?.nombre || '—',
        color: c.vendedor?.color || '#64748b',
        total: 0, pendiente: 0, pagado: 0, count: 0,
      }
    }
    porVendedor[vid].total += Number(c.total_comision || 0)
    porVendedor[vid].count++
    if (c.estado === 'pendiente') porVendedor[vid].pendiente += Number(c.total_comision || 0)
    else porVendedor[vid].pagado += Number(c.total_comision || 0)
  })
  const vendedoresList = Object.values(porVendedor).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton onClick={exportarPDF} loading={exportando} disabled={comisiones.length === 0} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard icon={DollarSign} label="Total acumulado" value={fmtUsd(totalGeneral)}
          sub={`${comisiones.length} comisiones`}
          gradient="linear-gradient(135deg, #1B365D, #0d1f3c)" border="rgba(255,255,255,0.07)" />
        <KpiCard icon={Clock} label="Pendiente" value={fmtUsd(totalPendiente)}
          sub={`${pendientes.length} por pagar`}
          gradient="linear-gradient(135deg, #92400e, #B8860B)" border="rgba(255,255,255,0.10)" />
        <KpiCard icon={Percent} label="Pagado" value={fmtUsd(totalPagado)}
          sub={`${pagadas.length} pagadas`}
          gradient="linear-gradient(135deg, #065f46, #047857)" border="rgba(255,255,255,0.10)" />
      </div>

      {vendedoresList.length > 0 && (
        <AdminTable
          icon={Users} iconColor="text-indigo-500" title="Comisiones por Vendedor"
          headers={[
            { label: 'Vendedor' }, { label: 'Comisiones', align: 'text-center' },
            { label: 'Pendiente', align: 'text-right' }, { label: 'Pagado', align: 'text-right' },
            { label: 'Total', align: 'text-right' },
          ]}
          rows={vendedoresList.map(v => [
            { content: <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full shrink-0" style={{ background: v.color }} />
              <span className="font-semibold">{v.nombre}</span>
            </div> },
            { content: v.count, className: 'text-center text-slate-600' },
            { content: fmtUsd(v.pendiente), className: 'text-right text-amber-600 font-semibold' },
            { content: fmtUsd(v.pagado), className: 'text-right text-emerald-600 font-semibold' },
            { content: fmtUsd(v.total), className: 'text-right font-bold text-slate-800' },
          ])}
        />
      )}

      {comisiones.length === 0 && (
        <EmptyState icon={Percent} title="Sin comisiones" description="No hay comisiones registradas." />
      )}
    </div>
  )
}

// ─── Shared Components ────────────────────────────────────────────────────
function ExportButton({ onClick, loading, disabled }) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-sm font-bold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md"
      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}>
      <Download size={12} className="sm:w-3.5 sm:h-3.5" />
      {loading ? 'Generando...' : 'Exportar PDF'}
    </button>
  )
}

function ErrorMsg({ onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
      <p className="font-semibold">Error al cargar el reporte</p>
      <button onClick={onRetry} className="mt-3 text-sm underline">Intentar de nuevo</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: CRÉDITO
// ═══════════════════════════════════════════════════════════════════════════
function TabCredito() {
  const { data, isLoading, isError, refetch } = useResumenCxC()

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!data || data.kpis.numClientesConDeuda === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="Sin créditos pendientes"
        description="No hay clientes con saldo pendiente actualmente."
      />
    )
  }

  const { kpis, clientesConDeuda, aging } = data

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={DollarSign} label="Total por cobrar"
          value={`$${Number(kpis.totalDeuda).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={Users} label="Clientes con deuda"
          value={String(kpis.numClientesConDeuda)}
          gradient="linear-gradient(135deg, #92400e, #B8860B)" border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={Clock} label="Deuda más antigua"
          value={`${kpis.diasMasAntiguo}d`}
          sub="días sin pago"
          gradient="linear-gradient(135deg, #1e3a5f, #1B365D)" border="rgba(255,255,255,0.07)"
        />
        <KpiCard
          icon={CreditCard} label="Total cargos"
          value={String(kpis.numCargos)}
          sub="órdenes a crédito"
          gradient="linear-gradient(135deg, #065f46, #047857)" border="rgba(255,255,255,0.10)"
        />
      </div>

      {/* Aging */}
      <AgingSection title="Antigüedad de deuda" data={aging} countLabel="Cargos" />

      {/* Clientes con deuda */}
      <AdminTable
        icon={Users} iconColor="text-red-500" title="Clientes con saldo pendiente"
        headers={[
          { label: 'Cliente' },
          { label: 'Vendedor' },
          { label: 'Saldo pendiente', align: 'text-right' },
        ]}
        rows={clientesConDeuda.map(c => [
          {
            content: (
              <div>
                <p className="font-semibold text-slate-800 text-xs">{c.nombre}</p>
                {c.rif_cedula && <p className="text-[10px] text-slate-400 font-mono">{c.rif_cedula}</p>}
              </div>
            ),
          },
          {
            content: c.vendedor ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.vendedor.color || '#64748b' }} />
                {c.vendedor.nombre}
              </span>
            ) : '—',
          },
          {
            content: (
              <span className="font-black text-red-600 text-xs">
                ${Number(c.saldo_pendiente).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            ),
            className: 'text-right',
          },
        ])}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════
export default function ReportesView() {
  const [activeTab, setActiveTab] = useState('ventas')
  const defaultRange = useMemo(() => {
    const curr = getWeekRange(0)
    const prev = getWeekRange(-1)
    return { from: curr.from, to: curr.to, prevFrom: prev.from, prevTo: prev.to }
  }, [])

  const [range, setRange] = useState(defaultRange)
  const { data: configNeg = {} } = useConfigNegocio()

  const needsDateRange = activeTab !== 'inventario' && activeTab !== 'comisiones' && activeTab !== 'credito'

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-3 sm:space-y-4 md:space-y-5">

      {/* ── Header compacto mobile ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pb-2 sm:pb-4" style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="w-1 self-stretch rounded-full shrink-0 hidden sm:block"
            style={{ background: 'linear-gradient(180deg, #B8860B 0%, #1B365D 100%)', minHeight: '36px' }} />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08) 0%, rgba(184,134,11,0.08) 100%)', border: '1px solid rgba(27,54,93,0.12)' }}>
            <BarChart3 size={16} style={{ color: '#1B365D' }} className="sm:w-[18px] sm:h-[18px]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-black text-slate-800 leading-tight tracking-tight">Reportes</h1>
            <p className="text-[10px] sm:text-xs font-medium text-slate-400 mt-0.5 truncate">
              {needsDateRange ? `${range.from} — ${range.to}` : 'Datos actuales'}
            </p>
          </div>
        </div>
        <button onClick={() => window.location.reload()}
          className="p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg sm:rounded-xl transition-colors shrink-0">
          <RefreshCw size={14} className="sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* ── Tabs scrollable ────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-hide">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${
                isActive
                  ? 'bg-primary text-white border-primary shadow-md'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}>
              <Icon size={12} className="sm:w-3.5 sm:h-3.5" />
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Date Range (for time-based tabs) */}
      {needsDateRange && <DateRangeSelector value={range} onChange={setRange} />}

      {/* Tab Content */}
      {activeTab === 'ventas' && <TabVentas range={range} configNeg={configNeg} />}
      {activeTab === 'inventario' && <TabInventario configNeg={configNeg} />}
      {activeTab === 'cotizaciones' && <TabCotizaciones range={range} configNeg={configNeg} />}
      {activeTab === 'despachos' && <TabDespachos range={range} configNeg={configNeg} />}
      {activeTab === 'comisiones' && <TabComisiones configNeg={configNeg} />}
      {activeTab === 'credito' && <TabCredito />}
    </div>
  )
}
