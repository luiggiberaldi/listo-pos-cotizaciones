// src/views/ReportesView.jsx
// Vista profesional de reportes administrativos con tabs
import { useState, useMemo } from 'react'
import {
  BarChart3, CreditCard, RefreshCw, Download,
  FileText, DollarSign, AlertTriangle,
  Clock, Users, Percent, ArrowUpCircle, Loader2
} from 'lucide-react'
import { useReporteVentas } from '../hooks/useReporteVentas'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useComisiones, useComisionesResumen } from '../hooks/useComisiones'
import { useResumenCxC } from '../hooks/useCuentasCobrar'
import { getWeekRange, getMonthRange } from '../utils/dateHelpers'
import { fmtUsd, fmtBs } from '../utils/format'
import useAuthStore from '../store/useAuthStore'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import KpiCards from '../components/reportes/KpiCards'
import TablaVendedores from '../components/reportes/TablaVendedores'
import TablaProductos from '../components/reportes/TablaProductos'
import TablaClientes from '../components/reportes/TablaClientes'
import supabase from '../services/supabase/client'

// ─── Tabs Definition ──────────────────────────────────────────────────────
const TABS = [
  { id: 'comisiones', label: 'Comisiones', short: 'Comis.', icon: Percent },
  { id: 'credito', label: 'Crédito', short: 'Créd.', icon: CreditCard },
  { id: 'ventas', label: 'Ventas', short: 'Ventas', icon: BarChart3 },
]

// ─── Skeleton ──────────────────────────────────────────────────────────────
function SkeletonReporte() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
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
          <p className="text-[11px] sm:text-xs font-medium leading-tight truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
        </div>
      </div>
      <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-white relative z-10 truncate">{value}</p>
      {sub && <p className="text-[11px] sm:text-xs relative z-10 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</p>}
    </div>
  )
}

// ─── Forma de Pago Section ────────────────────────────────────────────────
function FormaPagoSection({ data = [] }) {
  if (data.length === 0) return null
  const total = data.reduce((s, fp) => s + fp.totalUsd, 0)
  const COLORS = { 'Efectivo': '#10b981', 'Zelle': '#3b82f6', 'Pago Móvil': '#8b5cf6', 'USDT': '#f59e0b', 'Punto de Venta': '#06b6d4', 'Sin especificar': '#94a3b8' }

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
  borrador: 'bg-slate-100 text-slate-600',
  enviada: 'bg-blue-100 text-blue-700',
  aceptada: 'bg-emerald-100 text-emerald-700',
  rechazada: 'bg-red-100 text-red-700',
  vencida: 'bg-amber-100 text-amber-700',
  anulada: 'bg-gray-100 text-gray-500',
  pendiente: 'bg-amber-100 text-amber-700',
  despachada: 'bg-blue-100 text-blue-700',
  entregada: 'bg-emerald-100 text-emerald-700',
  pagada: 'bg-emerald-100 text-emerald-700',
}

// ─── Tabla genérica admin ─────────────────────────────────────────────────
function AdminTable({ icon: Icon, iconColor, title, headers, rows, emptyText }) {
  if (rows.length === 0) return null
  const visibleHeaders = headers.filter(h => !h.hidden)
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
              {visibleHeaders.map((h, i) => (
                <th key={i} className={`px-2 sm:px-4 py-2 font-semibold ${h.align || 'text-left'}`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                {row.filter(cell => !cell.hidden).map((cell, j) => (
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
// ─── Tab Ventas ───────────────────────────────────────────────────────────────
function TabVentas({ configNeg }) {
  const [rango, setRango] = useState(() => {
    const actual = getWeekRange(0)
    const anterior = getWeekRange(-1)
    return { from: actual.from, to: actual.to, prevFrom: anterior.from, prevTo: anterior.to }
  })
  const [exportando, setExportando] = useState(false)

  const { data: reporte, isLoading, isError, refetch } = useReporteVentas({
    from: rango.from,
    to: rango.to,
    prevFrom: rango.prevFrom,
    prevTo: rango.prevTo,
  })

  async function exportarPDF() {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarReporteVentasPDF } = await import('../services/pdf/comisionesPDF')
      const reportePDF = {
        ...reporte,
        porVendedor: (reporte.porVendedor || []).map(v => ({
          ...v,
          vendedor: v.nombre,
          vendedorColor: v.color,
          count: v.despachos,
        })),
        porCliente: (reporte.porCliente || []).map(c => ({
          ...c,
          cliente: c.nombre,
          count: c.despachos,
        })),
      }
      await generarReporteVentasPDF({ reporte: reportePDF, rango, config: configNeg })
    } catch (e) {
      console.error('Error generando reporte de ventas:', e)
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte) return null

  const { kpis, porVendedor, porCliente, porProducto, porCategoria, porFormaPago, despachos } = reporte
  const rangoLabel = `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`
  const ventasNetas = despachos.slice(0, 12).map(d => {
    const neto = Number(d.total_usd || 0) - Number(d.flete_usd || 0) - Number(d.descuento_total_usd || 0)
    return [
      { content: <span className="font-mono font-bold text-slate-700">{d.numero || '—'}</span> },
      { content: d.cliente?.nombre || 'Sin cliente', className: 'font-semibold text-slate-700' },
      {
        content: (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.vendedor?.color || '#64748b' }} />
            <span>{d.vendedor?.nombre || 'Sin vendedor'}</span>
          </span>
        )
      },
      { content: d.entregada_en ? new Date(d.entregada_en).toLocaleDateString('es-VE') : '—', className: 'text-center text-slate-500' },
      { content: fmtUsd(neto), className: 'text-right font-black text-slate-800' },
    ]
  })

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-6">
          <div className="w-full">
            <div className="flex items-center gap-2 ml-1 mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Periodo de ventas</label>
              <span className="hidden sm:inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {rangoLabel}
              </span>
            </div>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>
          
          <div className="flex justify-end border-t border-slate-50 pt-4">
            <ExportButton onClick={exportarPDF} loading={exportando} disabled={exportando || !despachos.length} className="h-11 px-8" />
          </div>
        </div>
      </div>

      {despachos.length === 0 ? (
        <EmptyState icon={BarChart3} title="Sin ventas entregadas" description="No hay despachos entregados en el periodo seleccionado." />
      ) : (
        <>
          <KpiCards kpis={kpis} />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-4">
            <TablaVendedores data={porVendedor} />
            <FormaPagoSection data={porFormaPago} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <TablaProductos porProducto={porProducto} porCategoria={porCategoria} />
            <TablaClientes data={porCliente} />
          </div>

          <AdminTable
            icon={FileText}
            iconColor="text-slate-500"
            title="Últimas ventas entregadas"
            headers={[
              { label: 'Despacho' },
              { label: 'Cliente' },
              { label: 'Vendedor' },
              { label: 'Fecha', align: 'text-center' },
              { label: 'Venta neta', align: 'text-right' },
            ]}
            rows={ventasNetas}
          />
        </>
      )}
    </div>
  )
}

// ─── Modal Detalle Vendedor ──────────────────────────────────────────────────
function ModalDetalleVendedor({ vendedor, rango, isOpen, onClose, configNeg }) {
  const { data: comisionesRes, isLoading } = useComisiones({
    desde: rango?.from,
    hasta: rango?.to,
    vendedorId: vendedor?.id,
    pageSize: 1000
  })
  const detalle = comisionesRes?.data ?? []

  const tasaComision = (item) => Number(item.despacho?.tasa_snapshot || item.cotizacion?.tasa_bcv_snapshot || 0)

  // Calcular totales del detalle
  const totales = detalle.reduce((acc, item) => {
    const total = Number(item.totalcomision || 0)
    acc.totalUsd += total
    acc.comBs += total * tasaComision(item)
    return acc
  }, { totalUsd: 0, comBs: 0 })

  const [exportando, setExportando] = useState(false)

  async function exportarPDF() {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      // Obtener el reporte detallado desde la RPC para que calcule bien los montos
      let { data: detalleVendedor, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio: rango?.from ? `${rango.from}T00:00:00-04:00` : null,
        p_fecha_fin: rango?.to ? `${rango.to}T23:59:59-04:00` : null,
        p_vendedor_id: vendedor?.id
      })

      if (error) console.error('Error RPC:', error)

      // FALLBACK: Si la RPC no devuelve nada pero tenemos datos en la tabla local, usarlos.
      // Esto evita el error de "No hay datos" cuando el usuario sí los ve en pantalla.
      if ((!detalleVendedor || detalleVendedor.length === 0) && detalle.length > 0) {
        console.log('Usando datos locales para PDF (Fallback)');
        detalleVendedor = detalle;
      }

      if (!detalleVendedor || detalleVendedor.length === 0) {
        // Mensaje mejorado en lugar de alert simple
        const msg = `No se encontraron registros detallados para ${vendedor?.nombre || 'este vendedor'} entre ${rango?.from} y ${rango?.to}.`;
        alert(`🔍 SIN DATOS: ${msg}`);
        return
      }

      await generarComisionesPDF({
        comisiones: detalleVendedor,
        vendedor: { nombre: vendedor?.nombre, color: vendedor?.color },
        config: configNeg ?? {}
      })
    } catch (e) {
      console.error('Error generando PDF individual:', e)
      alert('❌ Error al generar el PDF: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Detalle de Comisiones - ${vendedor?.nombre || 'Vendedor'}`}
      className="max-w-6xl"
    >
      {isLoading ? <SkeletonReporte /> : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 grid grid-cols-2 gap-3">
              <KpiCard icon={DollarSign} label="Total Comisión USD" value={fmtUsd(totales.totalUsd)} gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
              <KpiCard icon={Percent} label="Total Comisión Bs" value={fmtBs(totales.comBs)} gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); exportarPDF(); }}
              disabled={exportando}
              className="ml-3 shrink-0 flex flex-col items-center justify-center gap-1 w-14 h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white transition-all shadow-lg border border-white/10 group disabled:opacity-50"
              title="Descargar Reporte PDF"
            >
              {exportando ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} className="group-hover:scale-110 transition-transform" />}
              <span className="text-[9px] font-black tracking-widest uppercase">PDF</span>
            </button>
          </div>

          <AdminTable
            icon={FileText} iconColor="text-indigo-500" title="Comisiones generadas"
            headers={[
              { label: 'Fecha' }, { label: 'Despacho' }, { label: 'Cotización' },
              { label: 'Venta ($)', align: 'text-right' },
              { label: 'Cabilla', align: 'text-right' },
              { label: 'Otros', align: 'text-right' },
              { label: 'Com. ($)', align: 'text-right' },
              { label: 'Tasa BCV', align: 'text-right' },
              { label: 'Com. (Bs)', align: 'text-right' },
              { label: 'Estado', align: 'text-center' }
            ]}
            rows={detalle.map((d) => {
              const total = Number(d.totalcomision || 0)
              const tasa = tasaComision(d)
              const comBs = total * tasa
              return [
                { content: new Date(d.creadoen).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) },
                { content: <div className="text-[10px] leading-tight font-bold">D: #{d.despacho?.numero || '—'}</div> },
                { content: <div className="text-[10px] leading-tight font-bold">C: #{d.cotizacion?.numero || '—'}</div> },
                { content: fmtUsd(d.despacho?.totalusd || 0), className: 'text-right font-medium text-slate-600' },
                { content: fmtUsd(d.comisioncabilla || 0), className: 'text-right font-semibold text-slate-700' },
                { content: fmtUsd(d.comisionotros || 0), className: 'text-right font-semibold text-slate-700' },
                { content: fmtUsd(total), className: 'text-right font-bold text-slate-900' },
                { content: tasa > 0 ? `Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '—', className: 'text-right text-[11px] text-slate-600 font-semibold' },
                { content: fmtBs(comBs), className: 'text-right font-bold text-indigo-600' },
                {
                  content: <div className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${d.estado !== 'pagada' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                    {d.estado === 'cta_cobrar' ? 'cta x cobrar' : d.estado}
                  </div>, className: 'text-center'
                }
              ]
            })}
          />
        </div>
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: COMISIONES
// ═══════════════════════════════════════════════════════════════════════════
function TabComisiones({ configNeg }) {
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion'

  const [rango, setRango] = useState(() => {
    const r = getMonthRange(0)
    return { from: r.from, to: r.to }
  })
  const [filtroEstado, setFiltroEstado] = useState('') // '', 'pendiente', 'pagada'
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [exportando, setExportando] = useState(false)

  const [vendedorSeleccionado, setVendedorSeleccionado] = useState(null)

  const { data: comisionesRes, isLoading: comisionesLoading, isError, refetch } = useComisiones({
    estado: filtroEstado,
    vendedorId: filtroVendedor,
    desde: rango.from,
    hasta: rango.to,
    pageSize: 1000 // Cargamos un lote amplio para el reporte de resumen
  })
  const comisiones = comisionesRes?.data ?? []

  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: filtroVendedor,
    desde: rango.from,
    hasta: rango.to,
    estado: filtroEstado
  })

  // Agrupar por vendedor para la vista Maestro (Resumen)
  const vendedoresAgrupados = useMemo(() => {
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisiones.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      if (!map[vId]) {
        map[vId] = {
          id: vId,
          nombre: c.vendedor?.nombre || 'Sin Asignar',
          color: c.vendedor?.color || '#cbd5e1',
          totalUsd: 0,
          totalBs: 0,
          pendUsd: 0,
          pagUsd: 0,
          cantidad: 0
        }
      }
      const m = Number(c.totalcomision || 0)
      const tasa = Number(c.despacho?.tasa_snapshot || c.cotizacion?.tasa_bcv_snapshot || 0)
      const mBs = m * tasa

      map[vId].totalUsd += m
      map[vId].totalBs += mBs
      map[vId].cantidad++
      if (['pendiente', 'cta_cobrar'].includes(c.estado)) map[vId].pendUsd += m
      else map[vId].pagUsd += m
    })
    return Object.values(map).sort((a, b) => b.totalUsd - a.totalUsd)
  }, [comisiones])

  // Obtener lista única de vendedores para el select
  const vendedoresDisponibles = useMemo(() => {
    if (!esAdmin) return []
    return vendedoresAgrupados.map(v => ({ id: v.id, nombre: v.nombre }))
  }, [vendedoresAgrupados, esAdmin])

  async function exportarPDF() {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      let { data: detalleCompleto, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio: rango.from ? `${rango.from}T00:00:00-04:00` : null,
        p_fecha_fin: rango.to ? `${rango.to}T23:59:59-04:00` : null,
        p_vendedor_id: null
      })

      if (error) console.error('Error RPC General:', error)

      // Fallback a datos cargados en el hook useComisiones
      if ((!detalleCompleto || detalleCompleto.length === 0) && comisiones.length > 0) {
        detalleCompleto = comisiones;
      }

      if (!detalleCompleto || detalleCompleto.length === 0) {
        alert(`🔍 SIN DATOS: No hay comisiones registradas entre ${rango.from} y ${rango.to}.`);
        return;
      }

      await generarComisionesPDF({
        comisiones: detalleCompleto || [],
        config: configNeg ?? {}
      })
    } catch (e) {
      console.error('Error generando PDF general:', e)
      alert('❌ Error al generar reporte general: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  async function exportarIndividualPDF(vendedor) {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      let { data: detalleVendedor, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio: rango.from ? `${rango.from}T00:00:00-04:00` : null,
        p_fecha_fin: rango.to ? `${rango.to}T23:59:59-04:00` : null,
        p_vendedor_id: vendedor.id
      })

      if (error) console.error('Error RPC Individual:', error)

      // Fallback filtrando de la lista general si la RPC falla
      if ((!detalleVendedor || detalleVendedor.length === 0) && comisiones.length > 0) {
        detalleVendedor = comisiones.filter(c => (c.vendedor?.id || c.vendedor_id) === vendedor.id);
      }

      if (!detalleVendedor || detalleVendedor.length === 0) {
        alert(`🔍 SIN DATOS: No hay registros para ${vendedor.nombre} en este rango.`);
        return;
      }

      await generarComisionesPDF({
        comisiones: detalleVendedor || [],
        vendedor: { nombre: vendedor.nombre, color: vendedor.color },
        config: configNeg ?? {}
      })
    } catch (e) {
      console.error('Error generando PDF individual:', e)
      alert('❌ Error al generar PDF de ' + vendedor.nombre + ': ' + e.message)
    } finally {
      setExportando(false)
    }
  }


  // El bloque de KPIs ya no usa stats locales sino useComisionesResumen (resumen)

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-6">
          {/* Fila Superior: Periodo (con mucho espacio) */}
          <div className="w-full">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-2 block tracking-wider">Rango de Periodo</label>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>

          {/* Fila Inferior: Otros Filtros y Acciones */}
          <div className="flex flex-wrap lg:flex-nowrap items-end gap-4 border-t border-slate-50 pt-4">
            {esAdmin && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Vendedor</label>
                <select
                  value={filtroVendedor}
                  onChange={e => setFiltroVendedor(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none bg-slate-50/50 appearance-none cursor-pointer hover:border-indigo-300 transition-all"
                >
                  <option value="">Todos los Asesores</option>
                  {vendedoresDisponibles.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-1 min-w-[240px]">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Estado de Comisión</label>
              <div className="flex p-1 bg-slate-100/80 rounded-xl h-11">
                <button
                  onClick={() => setFiltroEstado('')}
                  className={`flex-1 text-xs font-black rounded-lg transition-all ${!filtroEstado ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >Todas</button>
                <button
                  onClick={() => setFiltroEstado('pendiente')}
                  className={`flex-1 text-xs font-black rounded-lg transition-all ${filtroEstado === 'pendiente' ? 'bg-white shadow-md text-amber-600' : 'text-slate-500 hover:text-slate-700'}`}
                >Pendientes</button>
                <button
                  onClick={() => setFiltroEstado('pagada')}
                  className={`flex-1 text-xs font-black rounded-lg transition-all ${filtroEstado === 'pagada' ? 'bg-white shadow-md text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
                >Pagadas</button>
              </div>
            </div>

            <div className="w-full lg:w-auto shrink-0">
              <ExportButton onClick={exportarPDF} loading={exportando} disabled={exportando || comisiones.length === 0} className="w-full h-11" />
            </div>
          </div>
        </div>
      </div>

      {comisionesLoading || resumenLoading ? (
        <SkeletonReporte />
      ) : isError ? (
        <ErrorMsg onRetry={refetch} />
      ) : (
        <>
          {/* KPIs (Fuente de verdad SQL) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard icon={DollarSign} label="Total Periodo" value={fmtUsd(resumen?.total || 0)}
              sub="Bruto histórico"
              gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={Clock} label="Pendiente USD" value={fmtUsd(resumen?.pendiente || 0)}
              sub={`${resumen?.countPendiente || 0} comisiones`}
              gradient="linear-gradient(135deg, #92400e, #78350f)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={Percent} label="En Reserva" value={fmtUsd(resumen?.retenida || 0)}
              sub="Falta despachar"
              gradient="linear-gradient(135deg, #b45309, #92400e)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={ArrowUpCircle} label="Total Pagado" value={fmtUsd(resumen?.pagado || 0)}
              sub={`${resumen?.countPagado || 0} liquidadas`}
              gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
          </div>

          {/* Tarjetas de Vendedores (Resumen) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vendedoresAgrupados.map(v => (
              <div
                key={v.id}
                onClick={() => setVendedorSeleccionado(v)}
                className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all flex flex-col gap-3 group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner" style={{ backgroundColor: v.color }}>
                    {v.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">{v.nombre}</h4>
                    <p className="text-xs text-slate-500 font-medium">{v.cantidad} despachos procesados</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); exportarIndividualPDF(v); }}
                    title="Descargar reporte individual"
                    className="p-2 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all"
                  >
                    <Download size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
                    <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                  </div>
                  <div className="bg-amber-50/50 rounded-xl p-2.5 text-center border border-amber-100/50">
                    <p className="text-[10px] text-amber-600/70 font-bold uppercase mb-0.5">Pendiente</p>
                    <p className="font-bold text-amber-600">{fmtUsd(v.pendUsd)}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center px-1 pt-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
                  <span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                </div>
              </div>
            ))}
          </div>

          <ModalDetalleVendedor
            isOpen={!!vendedorSeleccionado}
            onClose={() => setVendedorSeleccionado(null)}
            vendedor={vendedorSeleccionado}
            rango={rango}
            configNeg={configNeg}
          />

          {comisiones.length === 0 && (
            <EmptyState icon={Percent} title="Sin comisiones" description="No hay comisiones en el periodo seleccionado." />
          )}
        </>
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

// Colores de riesgo por días sin pago
function riesgoCliente(dias) {
  if (dias <= 30) return { label: 'Al día', color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: '#10b981' }
  if (dias <= 60) return { label: 'Moderado', color: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', bar: '#f59e0b' }
  if (dias <= 90) return { label: 'Alto', color: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', bar: '#ef4444' }
  return { label: 'Crítico', color: '#7c3aed', bg: 'bg-purple-50', text: 'text-purple-700', bar: '#7c3aed' }
}

// Aging mejorado con barras visuales
function AgingBars({ aging }) {
  const maxUsd = Math.max(...aging.map(a => a.totalUsd), 1)
  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#7c3aed']
  const totalUsd = aging.reduce((s, a) => s + a.totalUsd, 0)

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-slate-500" />
          <h3 className="text-xs sm:text-sm font-black text-slate-800">Antigüedad de deuda</h3>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">Total: ${totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="p-4 space-y-4">
        {aging.map((a, i) => {
          const pct = maxUsd > 0 ? (a.totalUsd / maxUsd) * 100 : 0
          const pctTotal = totalUsd > 0 ? (a.totalUsd / totalUsd) * 100 : 0
          return (
            <div key={a.rango} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i] }} />
                  <span className="text-xs font-semibold text-slate-700">{a.rango}</span>
                  <span className="text-[10px] text-slate-400 font-medium">{a.count} cargo{a.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-400">{pctTotal.toFixed(0)}%</span>
                  <span className="text-xs font-bold text-slate-800">
                    ${a.totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: COLORS[i] }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TabCredito() {
  const { data, isLoading, isError, refetch } = useResumenCxC()
  const [sortBy, setSortBy] = useState('saldo') // 'saldo' | 'dias'
  const [sortDir, setSortDir] = useState('desc')
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

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

  const { kpis, clientesConDeuda, aging, alertasVencimiento } = data

  const clientesOrdenados = [...clientesConDeuda].sort((a, b) => {
    const va = sortBy === 'saldo' ? Number(a.saldo_pendiente) : (a.diasSinPago ?? 0)
    const vb = sortBy === 'saldo' ? Number(b.saldo_pendiente) : (b.diasSinPago ?? 0)
    return sortDir === 'desc' ? vb - va : va - vb
  })

  const maxSaldo = Math.max(...clientesConDeuda.map(c => Number(c.saldo_pendiente)), 1)

  function buildWA(telefono, nombre, saldo) {
    const clean = (telefono || '').replace(/\D/g, '')
    const num = clean.startsWith('58') ? clean : `58${clean.startsWith('0') ? clean.slice(1) : clean}`
    const msg = encodeURIComponent(`Estimado/a ${nombre}, le recordamos que tiene un saldo pendiente de $${Number(saldo).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} con nosotros. Agradecemos su pronta cancelación.`)
    return `https://wa.me/${num}?text=${msg}`
  }

  const SortBtn = ({ col, label }) => (
    <button
      onClick={() => toggleSort(col)}
      className={`flex items-center gap-0.5 hover:text-slate-700 transition-colors ${sortBy === col ? 'text-slate-800 font-black' : 'text-slate-400 font-semibold'}`}
    >
      {label}
      <span className="text-[9px] ml-0.5">{sortBy === col ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Alertas de Vencimiento para Admin */}
      {esAdmin && alertasVencimiento?.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-orange-600" size={18} />
            <h3 className="text-sm font-bold text-orange-900">Alertas de Vencimiento de Crédito</h3>
            <span className="bg-orange-200 text-orange-800 text-[10px] px-2 py-0.5 rounded-full font-bold">
              {alertasVencimiento.length}
            </span>
          </div>
          <div className="space-y-2">
            {alertasVencimiento.map(alerta => (
              <div key={alerta.id} className="flex items-center justify-between bg-white border border-orange-100 rounded-lg p-2.5">
                <div>
                  <div className="text-xs font-bold text-slate-800">{alerta.cliente_nombre}</div>
                  <div className="text-[10px] text-slate-500">
                    Cargo: {new Date(alerta.creado_en).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-orange-600">
                    ${Number(alerta.saldo_usd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] font-semibold text-orange-500">
                    {alerta.diasRestantes < 0 
                      ? `Vencido hace ${Math.abs(alerta.diasRestantes)} días` 
                      : alerta.diasRestantes === 0 
                        ? 'Vence hoy' 
                        : `Vence en ${alerta.diasRestantes} días`
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPIs — 5 tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={DollarSign} label="Total por cobrar"
          value={`$${Number(kpis.totalDeuda).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={Users} label="Clientes con deuda"
          value={String(kpis.numClientesConDeuda)}
          sub={kpis.promedioDeuda > 0 ? `Prom. $${Number(kpis.promedioDeuda).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined}
          gradient="linear-gradient(135deg, #92400e, #B8860B)" border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={Clock} label="Deuda más antigua"
          value={`${kpis.diasMasAntiguo}d`}
          sub="días sin pago"
          gradient={kpis.diasMasAntiguo > 60 ? "linear-gradient(135deg, #7c3aed, #6d28d9)" : "linear-gradient(135deg, #1e3a5f, #1B365D)"} border="rgba(255,255,255,0.07)"
        />
        <KpiCard
          icon={CreditCard} label="Total cargos"
          value={String(kpis.numCargos)}
          sub="órdenes a crédito"
          gradient="linear-gradient(135deg, #065f46, #047857)" border="rgba(255,255,255,0.10)"
        />
      </div>

      {/* Aging con barras */}
      <AgingBars aging={aging} />

      {/* Tabla de clientes mejorada */}
      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-red-500" />
            <h3 className="text-xs sm:text-sm font-black text-slate-800">Clientes con saldo pendiente</h3>
            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">{clientesConDeuda.length}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                <th className="px-3 py-2.5 text-left font-semibold">Vendedor</th>
                <th className="px-3 py-2.5 text-center font-semibold">Riesgo</th>
                <th className="px-3 py-2.5 text-center">
                  <SortBtn col="dias" label="Días" />
                </th>
                <th className="px-3 py-2.5 text-right">
                  <SortBtn col="saldo" label="Saldo USD" />
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">Contacto</th>
              </tr>
            </thead>
            <tbody>
              {clientesOrdenados.map((c, i) => {
                const saldo = Number(c.saldo_pendiente)
                const dias = c.diasSinPago ?? 0
                const riesgo = riesgoCliente(dias)
                const barPct = Math.min((saldo / maxSaldo) * 100, 100)

                return (
                  <tr key={c.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                    {/* Cliente */}
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800 leading-tight">{c.nombre}</p>
                      {c.rif_cedula && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{c.rif_cedula}</p>}
                      {/* Mini barra de saldo relativo */}
                      <div className="mt-1.5 h-1 rounded-full bg-slate-100 w-24 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: riesgo.bar }} />
                      </div>
                    </td>
                    {/* Vendedor */}
                    <td className="px-3 py-3">
                      {c.vendedor ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.vendedor.color || '#64748b' }} />
                          <span className="text-slate-600 font-medium">{c.vendedor.nombre}</span>
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Riesgo badge */}
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${riesgo.bg} ${riesgo.text}`}>
                        {riesgo.label}
                      </span>
                    </td>
                    {/* Días */}
                    <td className="px-3 py-3 text-center">
                      <span className={`font-black text-sm ${dias > 60 ? 'text-red-600' : dias > 30 ? 'text-amber-600' : 'text-slate-600'}`}>
                        {dias}d
                      </span>
                    </td>
                    {/* Saldo */}
                    <td className="px-3 py-3 text-right">
                      <span className="font-black text-red-600 text-sm">
                        ${saldo.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    {/* WhatsApp */}
                    <td className="px-3 py-3 text-center">
                      {c.telefono ? (
                        <a
                          href={buildWA(c.telefono, c.nombre, c.saldo_pendiente)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors font-semibold text-[10px]"
                          title={`Contactar a ${c.nombre}`}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.507 3.934 1.395 5.604L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.88 0-3.645-.5-5.17-1.37l-.37-.22-3.885.815.827-3.784-.24-.39A9.94 9.94 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                          </svg>
                          WA
                        </a>
                      ) : <span className="text-slate-300 text-[10px]">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer resumen */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">{clientesConDeuda.length} cliente{clientesConDeuda.length !== 1 ? 's' : ''} con deuda activa</span>
          <span className="text-xs font-black text-red-600">
            Total: ${Number(kpis.totalDeuda).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════
export default function ReportesView() {
  const [activeTab, setActiveTab] = useState('comisiones')
  const { data: configNeg = {} } = useConfigNegocio()

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

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
              Reportes Administrativos
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
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${isActive
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

      {/* Tab Content */}
      {activeTab === 'comisiones' && <TabComisiones configNeg={configNeg} />}
      {activeTab === 'credito' && <TabCredito />}
      {activeTab === 'ventas' && <TabVentas configNeg={configNeg} />}
    </div>
  )
}
