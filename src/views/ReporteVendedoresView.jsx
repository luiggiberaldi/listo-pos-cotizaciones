// src/views/ReporteVendedoresView.jsx
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Users, Download, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, BarChart3, Award, Target, DollarSign, Package, ShoppingBag, Briefcase } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useReporteVendedores } from '../hooks/useReporteVendedores'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'
import { fmtUsdSimple as fmtUsd, fmtFecha } from '../utils/format'

// ─── Helpers de rango ─────────────────────────────────────────────────────────
function getRango(tipo) {
  const hoy = new Date()
  const iso = (d) => d.toISOString().split('T')[0]

  if (tipo === 'hoy') {
    const ayer = new Date(hoy)
    ayer.setDate(hoy.getDate() - 1)
    return { from: iso(hoy), to: iso(hoy), prevFrom: iso(ayer), prevTo: iso(ayer), label: 'Hoy' }
  }
  if (tipo === 'semana') {
    const dia = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - dia)
    const prevLunes = new Date(lunes); prevLunes.setDate(lunes.getDate() - 7)
    const prevDomingo = new Date(lunes); prevDomingo.setDate(lunes.getDate() - 1)
    return { from: iso(lunes), to: iso(hoy), prevFrom: iso(prevLunes), prevTo: iso(prevDomingo), label: 'Esta semana' }
  }
  if (tipo === 'mes') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const prevFin = new Date(ini); prevFin.setDate(0)
    const prevIni = new Date(prevFin.getFullYear(), prevFin.getMonth(), 1)
    return { from: iso(ini), to: iso(hoy), prevFrom: iso(prevIni), prevTo: iso(prevFin), label: 'Este mes' }
  }
  if (tipo === 'mes_anterior') {
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0)
    const ini = new Date(fin.getFullYear(), fin.getMonth(), 1)
    const prevFin2 = new Date(ini); prevFin2.setDate(0)
    const prevIni2 = new Date(prevFin2.getFullYear(), prevFin2.getMonth(), 1)
    return { from: iso(ini), to: iso(fin), prevFrom: iso(prevIni2), prevTo: iso(prevFin2), label: 'Mes anterior' }
  }
  if (tipo === 'trimestre') {
    const ini = new Date(hoy.getFullYear(), Math.floor(hoy.getMonth() / 3) * 3, 1)
    const prevFin = new Date(ini); prevFin.setDate(0)
    const prevIni = new Date(prevFin.getFullYear(), prevFin.getMonth() - 2, 1)
    return { from: iso(ini), to: iso(hoy), prevFrom: iso(prevIni), prevTo: iso(prevFin), label: 'Este trimestre' }
  }
  return getRango('hoy')
}

// ─── Utilidades UI ────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color = '#3B82F6', variacion }) {
  const trend = variacion !== null && variacion !== undefined
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-1 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: color + '18' }}>
          <Icon size={16} style={{ color }} />
        </div>
      </div>
      <p className="text-xl font-black text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
      {trend && (
        <p className={`text-[11px] font-semibold flex items-center gap-1 ${variacion >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {variacion >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(variacion).toFixed(1)}% vs período anterior
        </p>
      )}
    </div>
  )
}

function VendedorRow({ v, rank, isExpanded, onToggle, onExport, isExporting }) {
  const pctBar = v._maxVenta > 0 ? (v.totalUsd / v._maxVenta) * 100 : 0
  const tasaColor = v.tasaCierre >= 60 ? '#059669' : v.tasaCierre >= 35 ? '#D97706' : '#DC2626'
  const esExterno = !!v.es_externo || v.markup_pct > 0
  const colorVendedor = esExterno ? '#D97706' : v.color

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-100"
      >
        <td className="py-3 pl-4 pr-2 w-8">
          <span className="text-xs font-bold text-slate-400">#{rank}</span>
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ background: colorVendedor }} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-slate-800">
                  {v.nombre}
                  {esExterno && <span className="text-amber-600 font-extrabold ml-1">(E)</span>}
                </p>
                {v.markup_pct > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.2">
                    💼 +{v.markup_pct}%
                  </span>
                )}
              </div>
              <div className="w-32 h-1.5 bg-slate-100 rounded-full mt-1">
                <div className="h-1.5 rounded-full" style={{ width: `${pctBar}%`, background: colorVendedor }} />
              </div>
            </div>
          </div>
        </td>
        <td className="py-3 pr-4 text-right">
          <p className="text-sm font-black text-slate-800">{fmtUsd(v.totalUsd)}</p>
          {v.variacionUsd !== null && (
            <p className={`text-[10px] font-semibold ${v.variacionUsd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {v.variacionUsd >= 0 ? '▲' : '▼'} {Math.abs(v.variacionUsd).toFixed(1)}%
            </p>
          )}
        </td>
        <td className="py-3 pr-4 text-right text-sm text-slate-600">{v.numDespachos}</td>
        <td className="py-3 pr-4 text-right text-sm text-slate-600">{fmtUsd(v.ticketPromedio)}</td>
        <td className="py-3 pr-4 text-right">
          <span className="text-sm font-bold" style={{ color: tasaColor }}>{v.tasaCierre}%</span>
        </td>
        <td className="py-3 pr-4 text-right text-sm text-slate-600">{fmtUsd(v.comisionTotal)}</td>
        <td className="py-3 pr-2 text-slate-400">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="p-0 bg-slate-50 border-b border-slate-200">
            <VendedorDetalle v={v} onExport={() => onExport('individual', v.id)} isExporting={isExporting} />
          </td>
        </tr>
      )}
    </>
  )
}

function VendedorDetalle({ v, onExport, isExporting }) {
  const estados = [
    { key: 'enviada',   label: 'Enviadas',   color: '#3B82F6' },
    { key: 'aceptada',  label: 'Aceptadas',  color: '#059669' },
    { key: 'rechazada', label: 'Rechazadas', color: '#DC2626' },
    { key: 'anulada',   label: 'Anuladas',   color: '#94A3B8' },
  ]
  const totalCots = v.cotizaciones?.total || 0

  return (
    <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-4 relative">
      <div className="absolute top-4 right-6 z-10 md:static md:col-span-3 flex justify-end">
         <button onClick={onExport} disabled={isExporting} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 shadow-sm transition-all disabled:opacity-50">
            {isExporting ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
            Descargar Reporte Detallado
         </button>
      </div>

      {/* Cotizaciones */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Cotizaciones ({totalCots})</p>
        <div className="space-y-2">
          {estados.map(e => {
            const count = v.cotizaciones?.[e.key] || 0
            const pct = totalCots > 0 ? ((count / totalCots) * 100).toFixed(0) : 0
            return (
              <div key={e.key} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
                <span className="text-xs text-slate-600 w-20">{e.label}</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full">
                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: e.color }} />
                </div>
                <span className="text-xs font-bold text-slate-700 w-8 text-right">{count}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-400">Tasa de cierre</p>
          <p className="text-lg font-black" style={{ color: v.tasaCierre >= 60 ? '#059669' : v.tasaCierre >= 35 ? '#D97706' : '#DC2626' }}>
            {v.tasaCierre}%
          </p>
        </div>
      </div>

      {/* Top Clientes */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Top Clientes</p>
        {v.topClientes?.length > 0 ? (
          <div className="space-y-2">
            {v.topClientes.map((c, i) => (
              <div key={c.id || i} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">#{i + 1}</span>
                  <span className="text-xs text-slate-700 truncate">{c.nombre}</span>
                </div>
                <span className="text-xs font-bold text-slate-800 shrink-0">{fmtUsd(c.totalUsd)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-slate-400">Sin datos</p>}

        <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Comisión pagada</span>
            <span className="font-bold text-emerald-600">{fmtUsd(v.comisionPagada)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Comisión pendiente</span>
            <span className="font-bold text-amber-600">{fmtUsd(v.comisionPendiente)}</span>
          </div>
          <div className="flex justify-between text-[11px] pt-1 border-t border-dashed border-slate-100">
            <span className="text-slate-400">Cabillas al 2%</span>
            <span className="font-bold text-slate-700">{fmtUsd(v.comisionCabilla2 || 0)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Cabillas al 3%</span>
            <span className="font-bold text-slate-700">{fmtUsd(v.comisionCabilla3 || 0)}</span>
          </div>
        </div>
      </div>

      {/* Top Productos */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Top Productos</p>
        {v.topProductos?.length > 0 ? (
          <div className="space-y-2">
            {v.topProductos.map((p, i) => (
              <div key={p.id || i} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">#{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-700 truncate">{p.nombre}</p>
                    <p className="text-[10px] text-slate-400">{p.unidades} und</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-slate-800 shrink-0">{fmtUsd(p.totalUsd)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-slate-400">Sin datos</p>}

        {v.historial?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Último despacho</p>
            <p className="text-xs text-slate-600 truncate">{v.historial[0]?.cliente}</p>
            <p className="text-xs font-bold text-slate-800">{fmtUsd(v.historial[0]?.totalUsd)}</p>
            <p className="text-[10px] text-slate-400">{fmtFecha(v.historial[0]?.fecha)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Vista Principal ──────────────────────────────────────────────────────────
const PERIODOS = [
  { key: 'hoy',          label: 'Hoy' },
  { key: 'semana',       label: 'Esta semana' },
  { key: 'mes',          label: 'Este mes' },
  { key: 'mes_anterior', label: 'Mes anterior' },
  { key: 'trimestre',    label: 'Trimestre' },
]

export default function ReporteVendedoresView() {
  const { perfil } = useAuthStore()
  const [periodo, setPeriodo] = useState('hoy')
  const [expandedId, setExpandedId] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportDropdownRef = useRef(null)
  const { data: config = {} } = useConfigNegocio()

  const rango = useMemo(() => getRango(periodo), [periodo])

  useEffect(() => {
    function handleClickOutside(e) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportMenuOpen(false)
      }
    }
    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [exportMenuOpen])

  const { data, isLoading, isError, refetch } = useReporteVendedores({
    from: rango.from,
    to: rango.to,
    prevFrom: rango.prevFrom,
    prevTo: rango.prevTo,
  })

  const calcSubtotales = (lista) => {
    let totalUsd = 0
    let numDespachos = 0
    let comisionTotal = 0
    let aceptadas = 0
    let enviadas = 0
    let prevTotalUsd = 0

    lista.forEach(v => {
      totalUsd += v.totalUsd || 0
      numDespachos += v.numDespachos || 0
      comisionTotal += v.comisionTotal || 0
      prevTotalUsd += v.prevTotalUsd || 0

      const cots = v.cotizaciones || {}
      const env = (cots.enviada || 0) + (cots.aceptada || 0) + (cots.rechazada || 0)
      enviadas += env
      aceptadas += cots.aceptada || 0
    })

    const ticketPromedio = numDespachos > 0 ? totalUsd / numDespachos : 0
    const tasaCierre = enviadas > 0 ? Math.round((aceptadas / enviadas) * 100) : 0
    const variacionUsd = prevTotalUsd > 0 ? ((totalUsd - prevTotalUsd) / prevTotalUsd) * 100 : null

    return {
      totalUsd,
      numDespachos,
      ticketPromedio,
      tasaCierre,
      comisionTotal,
      variacionUsd,
    }
  }

  const { internos, externos, subInternos, subExternos, totalGlobal, hasData } = useMemo(() => {
    if (!data?.porVendedor || data.porVendedor.length === 0) {
      return { internos: [], externos: [], subInternos: {}, subExternos: {}, totalGlobal: {}, hasData: false }
    }
    const max = data.porVendedor[0]?.totalUsd ?? 1
    const mapped = data.porVendedor.map(v => ({ ...v, _maxVenta: max }))

    const intList = mapped.filter(v => !(v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)))
    const extList = mapped.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))

    return {
      internos: intList,
      externos: extList,
      subInternos: calcSubtotales(intList),
      subExternos: calcSubtotales(extList),
      totalGlobal: calcSubtotales(mapped),
      hasData: true
    }
  }, [data])

  const handleToggle = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  const handleExportPDF = async (tipo = 'general', vendedorId = null) => {
    if (!data) return
    setPdfLoading(vendedorId || tipo)
    try {
      const { generarReporteVendedoresPDF } = await import('../services/pdf/reporteVendedoresPDF')
      await generarReporteVendedoresPDF({
        data,
        config,
        periodo: { from: rango.from, to: rango.to },
        tipo,
        vendedorId
      })
    } catch (err) {
      console.error('Error PDF:', err)
    } finally {
      setPdfLoading(null)
    }
  }

  const kpis = data?.kpis
  const isGlobalLoading = pdfLoading === 'general' || pdfLoading === 'internos' || pdfLoading === 'externos'

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4">
      <PageHeader
        icon={BarChart3}
        title="Reporte de Vendedores"
        subtitle={`${rango.label} · ${rango.from} → ${rango.to}`}
        action={
          <div className="flex items-center gap-2">
            <div ref={exportDropdownRef} className="relative">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                disabled={pdfLoading !== null || isLoading || !data}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all hover:shadow-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,rgba(27,54,93,.07),rgba(184,134,11,.07))', border:'1px solid rgba(27,54,93,.2)', color:'#1B365D' }}
              >
                {isGlobalLoading
                  ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Download size={15} />}
                Exportar Reporte
                <ChevronDown size={14} className={`transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {exportMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 p-1.5 z-30 animate-in fade-in duration-100">
                  <button
                    onClick={() => { handleExportPDF('general'); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <Download size={14} className="text-slate-400" />
                    Reporte General (Todos)
                  </button>
                  <button
                    onClick={() => { handleExportPDF('internos'); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <Users size={14} className="text-slate-400" />
                    Vendedores Internos
                  </button>
                  <button
                    onClick={() => { handleExportPDF('externos'); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <Briefcase size={14} className="text-amber-500" />
                    Vendedores Externos
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => refetch()} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {/* Selector de período */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
        {PERIODOS.map(p => (
          <button
            key={p.key}
            onClick={() => { setPeriodo(p.key); setExpandedId(null) }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border ${
              periodo === p.key
                ? 'bg-indigo-500 text-white border-indigo-500'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs globales */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-6 w-32 rounded-lg" />
            </div>
          ))}
        </div>
      ) : kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Ventas del período" value={fmtUsd(kpis.totalVentas)} icon={DollarSign} color="#3B82F6" variacion={kpis.variacionGlobal} />
          <KpiCard label="Despachos entregados" value={String(kpis.totalDespachos)} icon={ShoppingBag} color="#059669" sub={`${kpis.numVendedores} vendedor${kpis.numVendedores !== 1 ? 'es' : ''}`} />
          <KpiCard label="Ticket promedio" value={fmtUsd(kpis.ticketPromedioGlobal)} icon={Target} color="#8B5CF6" />
          <KpiCard
            label="Comisiones generadas"
            value={fmtUsd(kpis.totalComision)}
            icon={Award}
            color="#D97706"
            sub={`Cabillas 2%: ${fmtUsd(kpis.totalComisionCabilla2 || 0)} | 3%: ${fmtUsd(kpis.totalComisionCabilla3 || 0)}`}
          />
        </div>
      )}

      {/* Tabla de vendedores */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar datos</p>
          <button onClick={() => refetch()} className="mt-2 text-sm underline">Reintentar</button>
        </div>
      ) : !hasData ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Users size={40} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-semibold">Sin ventas en este período</p>
          <p className="text-slate-400 text-sm mt-1">Cambia el período o verifica que haya despachos entregados</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-3 pl-4 pr-2 text-left text-xs font-bold text-slate-400">#</th>
                  <th className="py-3 pr-4 text-left text-xs font-bold text-slate-400">Vendedor</th>
                  <th className="py-3 pr-4 text-right text-xs font-bold text-slate-400">Ventas USD</th>
                  <th className="py-3 pr-4 text-right text-xs font-bold text-slate-400"># Desp.</th>
                  <th className="py-3 pr-4 text-right text-xs font-bold text-slate-400">Ticket Prom.</th>
                  <th className="py-3 pr-4 text-right text-xs font-bold text-slate-400">Tasa Cierre</th>
                  <th className="py-3 pr-4 text-right text-xs font-bold text-slate-400">Comisión</th>
                  <th className="py-3 pr-2 w-6" />
                </tr>
              </thead>
              <tbody>
                {/* 1. SECCIÓN VENDEDORES INTERNOS */}
                {internos.length > 0 && (
                  <>
                    <tr className="bg-slate-50 font-extrabold text-slate-500 text-[10px] tracking-wider border-b border-slate-100">
                      <td colSpan={8} className="px-4 py-2 uppercase">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-slate-400" />
                          Vendedores Internos ({internos.length})
                        </div>
                      </td>
                    </tr>
                    {internos.map((v, i) => (
                      <VendedorRow
                        key={v.id}
                        v={v}
                        rank={i + 1}
                        isExpanded={expandedId === v.id}
                        onToggle={() => handleToggle(v.id)}
                        onExport={handleExportPDF}
                        isExporting={pdfLoading === v.id}
                      />
                    ))}
                    {/* Subtotal Internos */}
                    <tr className="bg-slate-50/30 font-bold text-slate-600 border-b border-slate-200 text-xs">
                      <td className="py-2.5 pl-4"></td>
                      <td className="py-2.5 pr-4 uppercase text-[9px] font-black text-slate-400">Subtotal Internos</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className="font-extrabold text-slate-800">{fmtUsd(subInternos.totalUsd)}</span>
                        {subInternos.variacionUsd !== null && (
                          <span className={`text-[10px] font-semibold block ${subInternos.variacionUsd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {subInternos.variacionUsd >= 0 ? '▲' : '▼'} {Math.abs(subInternos.variacionUsd).toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-slate-600 font-semibold">{subInternos.numDespachos}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-500">{fmtUsd(subInternos.ticketPromedio)}</td>
                      <td className="py-2.5 pr-4 text-right font-bold text-slate-700">{subInternos.tasaCierre}%</td>
                      <td className="py-2.5 pr-4 text-right text-emerald-600 font-extrabold">{fmtUsd(subInternos.comisionTotal)}</td>
                      <td className="py-2.5 pr-2"></td>
                    </tr>
                  </>
                )}

                {/* 2. SECCIÓN VENDEDORES EXTERNOS (E) */}
                {externos.length > 0 && (
                  <>
                    <tr className="bg-amber-50/50 font-extrabold text-amber-700 text-[10px] tracking-wider border-b border-amber-100 border-t border-slate-100">
                      <td colSpan={8} className="px-4 py-2 uppercase">
                        <div className="flex items-center gap-1.5">
                          <Briefcase size={12} className="text-amber-600" />
                          Vendedores Externos ({externos.length})
                        </div>
                      </td>
                    </tr>
                    {externos.map((v, i) => (
                      <VendedorRow
                        key={v.id}
                        v={v}
                        rank={i + 1}
                        isExpanded={expandedId === v.id}
                        onToggle={() => handleToggle(v.id)}
                        onExport={handleExportPDF}
                        isExporting={pdfLoading === v.id}
                      />
                    ))}
                    {/* Subtotal Externos */}
                    <tr className="bg-amber-50/10 font-bold text-amber-800 border-b border-amber-200 text-xs">
                      <td className="py-2.5 pl-4"></td>
                      <td className="py-2.5 pr-4 uppercase text-[9px] font-black text-amber-600/70">Subtotal Externos</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className="font-extrabold text-amber-900">{fmtUsd(subExternos.totalUsd)}</span>
                        {subExternos.variacionUsd !== null && (
                          <span className={`text-[10px] font-semibold block ${subExternos.variacionUsd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {subExternos.variacionUsd >= 0 ? '▲' : '▼'} {Math.abs(subExternos.variacionUsd).toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-amber-700 font-semibold">{subExternos.numDespachos}</td>
                      <td className="py-2.5 pr-4 text-right text-amber-600/70">{fmtUsd(subExternos.ticketPromedio)}</td>
                      <td className="py-2.5 pr-4 text-right font-bold text-amber-700">{subExternos.tasaCierre}%</td>
                      <td className="py-2.5 pr-4 text-right text-emerald-600 font-extrabold">{fmtUsd(subExternos.comisionTotal)}</td>
                      <td className="py-2.5 pr-2"></td>
                    </tr>
                  </>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-100 font-black text-slate-800 text-sm">
                  <td className="py-3 pl-4"></td>
                  <td className="py-3 pr-4 uppercase">TOTAL GENERAL</td>
                  <td className="py-3 pr-4 text-right">
                    <span className="font-black text-slate-900">{fmtUsd(totalGlobal.totalUsd)}</span>
                    {totalGlobal.variacionUsd !== null && (
                      <span className={`text-[10px] font-bold block ${totalGlobal.variacionUsd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {totalGlobal.variacionUsd >= 0 ? '▲' : '▼'} {Math.abs(totalGlobal.variacionUsd).toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right font-bold text-slate-800">{totalGlobal.numDespachos}</td>
                  <td className="py-3 pr-4 text-right text-slate-600">{fmtUsd(totalGlobal.ticketPromedio)}</td>
                  <td className="py-3 pr-4 text-right font-black text-slate-800">{totalGlobal.tasaCierre}%</td>
                  <td className="py-3 pr-4 text-right text-emerald-700 font-black">{fmtUsd(totalGlobal.comisionTotal)}</td>
                  <td className="py-3 pr-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-400 flex items-center gap-1">
            <ChevronRight size={12} />
            Haz click en un vendedor para ver su perfil detallado
          </div>
        </div>
      )}
    </div>
  )
}
