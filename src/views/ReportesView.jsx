// src/views/ReportesView.jsx
// Vista profesional de reportes administrativos con tabs
import { useState, useMemo } from 'react'
import {
  BarChart3, CreditCard, RefreshCw, Download, Package,
  FileText, DollarSign, TrendingUp, AlertTriangle,
  Clock, Users, Percent, ArrowUpCircle,
} from 'lucide-react'
import { useReporteInventario } from '../hooks/useReporteInventario'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useComisiones, useReporteVentasComisiones, useComisionesResumen } from '../hooks/useComisiones'
import { useResumenCxC } from '../hooks/useCuentasCobrar'
import { getWeekRange } from '../utils/dateHelpers'
import { fmtUsd, fmtBs } from '../utils/format'
import useAuthStore from '../store/useAuthStore'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import supabase from '../services/supabase/client'

// ─── Tabs Definition ──────────────────────────────────────────────────────
const TABS = [
  { id: 'comisiones', label: 'Comisiones', short: 'Comis.', icon: Percent },
  { id: 'credito', label: 'Crédito', short: 'Créd.', icon: CreditCard },
  { id: 'inventario', label: 'Inventario', short: 'Invent.', icon: Package },
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
// ─── Tab Inventario ──────────────────────────────────────────────────────────
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
  if (!reporte) return null

  const { kpis, porCategoria } = reporte

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton onClick={exportarPDF} loading={exportando} disabled={!reporte} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Package} label="Total Productos" value={String(kpis.totalProductos)}
          gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
        <KpiCard icon={DollarSign} label="Valor Venta" value={fmtUsd(kpis.totalValorVenta)}
          gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
        {kpis.esPrivilegiado && (
          <KpiCard icon={TrendingUp} label="Valor Costo" value={fmtUsd(kpis.totalValorCosto)}
            gradient="linear-gradient(135deg, #1e3a8a, #172554)" border="rgba(255,255,255,0.05)" />
        )}
        <KpiCard icon={AlertTriangle} label="Bajo Stock" value={String(kpis.numBajoStock)}
          gradient="linear-gradient(135deg, #991b1b, #7f1d1d)" border="rgba(255,255,255,0.05)" />
      </div>

      <AdminTable
        icon={BarChart3} iconColor="text-emerald-500" title="Distribución por Categoría"
        headers={[
          { label: 'Categoría' }, { label: 'Items' }, { label: 'Stock Total', align: 'text-center' }, { label: 'Valor Venta', align: 'text-right' }
        ]}
        rows={porCategoria.map(c => [
          { content: c.categoria, className: 'font-bold text-slate-700' },
          { content: c.count },
          { content: c.stockTotal, className: 'text-center' },
          { content: fmtUsd(c.valorVenta), className: 'text-right font-bold' }
        ])}
      />
    </div>
  )
}

// ─── Modal Detalle Vendedor ──────────────────────────────────────────────────
function ModalDetalleVendedor({ vendedor, rango, isOpen, onClose }) {
  const { data: detalle = [], isLoading } = useReporteVentasComisiones({
    desde: rango?.from,
    hasta: rango?.to,
    vendedorId: vendedor?.id
  })

  // Calcular totales del detalle
  const totales = detalle.reduce((acc, item) => {
    acc.totalUsd += Number(item.total_com || 0)
    acc.comBs += Number(item.total_com || 0) * Number(item.tasa || 0)
    return acc
  }, { totalUsd: 0, comBs: 0 })

  async function exportarPDF() {
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')
      // Ya tenemos los datos detallados en 'detalle' gracias al hook useReporteVentasComisiones
      if (!detalle || detalle.length === 0) return

      await generarComisionesPDF({
        comisiones: detalle,
        vendedor: { nombre: vendedor?.nombre, color: vendedor?.color },
        config: {}
      })
    } catch (e) { console.error('Error generando PDF individual:', e) }
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
              className="ml-3 shrink-0 flex flex-col items-center justify-center gap-1 w-14 h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white transition-all shadow-lg border border-white/10 group"
              title="Descargar Reporte PDF"
            >
              <Download size={18} className="group-hover:scale-110 transition-transform" />
              <span className="text-[9px] font-black tracking-widest uppercase">PDF</span>
            </button>
          </div>

          <AdminTable
            icon={FileText} iconColor="text-indigo-500" title="Productos Vendidos"
            headers={[
              { label: 'Fecha' }, { label: 'Doc' }, { label: 'Producto' },
              { label: 'Valor ($)', align: 'text-right' },
              { label: '% Com.', align: 'text-right' },
              { label: 'Com. ($)', align: 'text-right' },
              { label: 'Tasa BCV', align: 'text-right' },
              { label: 'Com. (Bs)', align: 'text-right' },
              { label: 'Estado', align: 'text-center' }
            ]}
            rows={detalle.map((d, index) => {
              const comBs = Number(d.total_com || 0) * Number(d.tasa || 0)
              return [
                { content: new Date(d.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) },
                { content: <div className="text-[10px] leading-tight font-bold">D: #{d.despacho_numero}</div> },
                {
                  content: <div className="min-w-[150px] py-1">
                    <div className="flex flex-col gap-1">
                      <span className="w-fit px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono font-bold text-slate-500 uppercase tracking-tighter">
                        {d.codigo}
                      </span>
                      <div className="font-bold text-slate-800 text-[11px] leading-tight break-words">{d.descripcion}</div>
                    </div>
                  </div>
                },
                { content: fmtUsd(d.total), className: 'text-right font-medium text-slate-600' },
                { content: `${d.comisionpct}%`, className: 'text-right text-[10px] font-bold text-slate-400' },
                { content: fmtUsd(d.total_com), className: 'text-right font-bold text-slate-900' },
                { content: `Bs ${d.tasa}`, className: 'text-right text-[10px] text-slate-400 font-mono' },
                { content: fmtBs(comBs), className: 'text-right font-bold text-indigo-600' },
                {
                  content: <div className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${d.estado_comision !== 'pagada' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                    {d.estado_comision}
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
    const r = getWeekRange(0)
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
      const m = Number(c.total_comision || 0)
      const tasa = Number(c.despacho?.tasa_snapshot || c.cotizacion?.tasa_bcv_snapshot || 0)
      const mBs = m * tasa

      map[vId].totalUsd += m
      map[vId].totalBs += mBs
      map[vId].cantidad++
      if (['retenida', 'pago_parcial', 'liberada'].includes(c.estado)) map[vId].pendUsd += m
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

      // Corregimos nombres de parámetros y formateo de fechas
      const { data: detalleCompleto, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio: rango.from ? `${rango.from}T00:00:00` : null,
        p_fecha_fin: rango.to ? `${rango.to}T23:59:59` : null,
        p_vendedor_id: null
      })

      if (error) throw error

      await generarComisionesPDF({
        comisiones: detalleCompleto || [],
        config: configNeg ?? {}
      })
    } catch (e) {
      console.error('Error generando PDF general:', e)
      alert('Error al obtener datos detallados: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  async function exportarIndividualPDF(vendedor) {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      // Corregimos nombres de parámetros y formateo de fechas
      const { data: detalleVendedor, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio: rango.from ? `${rango.from}T00:00:00` : null,
        p_fecha_fin: rango.to ? `${rango.to}T23:59:59` : null,
        p_vendedor_id: vendedor.id
      })

      if (error) throw error

      await generarComisionesPDF({
        comisiones: detalleVendedor || [],
        vendedor: { nombre: vendedor.nombre, color: vendedor.color },
        config: configNeg ?? {}
      })
    } catch (e) {
      console.error('Error generando PDF individual:', e)
      alert('Error al obtener detalle del vendedor: ' + e.message)
    } finally {
      setExportando(false)
    }
  }


  // El bloque de KPIs ya no usa stats locales sino useComisionesResumen (resumen)

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex-1 min-w-0 overflow-x-auto pb-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Periodo</label>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>

          <div className="flex flex-wrap sm:flex-nowrap gap-3 shrink-0">
            {esAdmin && (
              <div className="w-full sm:w-48">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Vendedor</label>
                <select
                  value={filtroVendedor}
                  onChange={e => setFiltroVendedor(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 text-xs font-medium focus:ring-2 focus:ring-indigo-500/20 outline-none"
                >
                  <option value="">Todos</option>
                  {vendedoresDisponibles.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="w-full sm:w-56 min-w-[220px]">
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Estado</label>
              <div className="flex p-1 bg-slate-100 rounded-xl h-9">
                <button
                  onClick={() => setFiltroEstado('')}
                  className={`flex-1 text-[10px] font-bold rounded-lg transition-all ${!filtroEstado ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                >Todas</button>
                <button
                  onClick={() => setFiltroEstado('pendiente')}
                  className={`flex-1 text-[10px] font-bold rounded-lg transition-all ${filtroEstado === 'pendiente' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-500'}`}
                >Pend.</button>
                <button
                  onClick={() => setFiltroEstado('pagada')}
                  className={`flex-1 text-[10px] font-bold rounded-lg transition-all ${filtroEstado === 'pagada' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}
                >Pagadas</button>
              </div>
            </div>

            <div className="w-full sm:w-auto flex items-end">
              <ExportButton onClick={exportarPDF} loading={exportando} disabled={exportando || comisiones.length === 0} className="w-full sm:w-auto" />
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
      {activeTab === 'inventario' && <TabInventario configNeg={configNeg} />}
    </div>
  )
}
